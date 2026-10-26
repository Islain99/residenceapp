// Relève de quart : « quoi de neuf depuis ma dernière relève ».
//
//   GET  /handover      notes écrites depuis la dernière relève confirmée
//                       (prioritaires d'abord) + suivis ouverts qui me
//                       concernent (assignés à moi ou à toute l'équipe)
//                       + rendez-vous de l'agenda des prochaines 24 h.
//                       Suivis ou Agenda masqués pour la personne
//                       (fonctionnalités activables) : section vide.
//   POST /handover/ack  « j'ai pris connaissance » : enregistre l'instant
//                       generatedAt reçu du GET, pour qu'une note écrite
//                       entre la lecture et la confirmation ne soit pas perdue.
//
// Lectures :
//   * Les consignes prioritaires se confirment une à une (POST /notes/:id/read).
//     Tant qu'il en reste une non lue dans la relève : 409 priority_unread.
//   * « J'ai pris connaissance » confirme la lecture de toutes les notes
//     ordinaires de la relève.
//   * Une consigne prioritaire corrigée depuis la dernière relève y réapparaît,
//     même si elle avait été écrite avant.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { authenticate, residenceOf } from '../auth.js';
import type { Database } from '../db/index.js';
import { AppointmentBody, appointmentQuery, toAppointment } from '../lib/appointment-view.js';
import { audit } from '../lib/audit.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { featureLevels } from '../lib/feature-routes.js';
import { atLeast } from '../lib/features.js';
import { FollowUpBody, followUpQuery, orderFollowUps, toFollowUp } from '../lib/follow-up-view.js';
import { NoteBody, noteQuery, toNote, validReadSql } from '../lib/note-view.js';
import { Nullable } from '../lib/schemas.js';

const FIRST_HANDOVER_LOOKBACK_MS = 24 * 60 * 60 * 1000;   // aucune relève encore : dernières 24 h
const MAX_NOTES = 200;
const APPOINTMENTS_AHEAD_MS = 24 * 60 * 60 * 1000;      // rendez-vous des prochaines 24 h
const APPOINTMENTS_BEHIND_MS = 60 * 60 * 1000;          // … et ceux commencés depuis moins d'une heure

// Heure de la base : notes.created_at vient de son horloge. Comparer avec
// l'horloge de l'API (autre machine, autre conteneur) pourrait perdre une note.
async function dbNow(db: Database): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db);
  return rows[0]!.now;
}

// Dernière relève confirmée, sinon les 24 dernières heures
async function lastHandover(db: Database, userId: string, residenceId: string) {
  return db.selectFrom('handovers').select('acknowledged_at')
    .where('user_id', '=', userId).where('residence_id', '=', residenceId)
    .orderBy('acknowledged_at', 'desc').limit(1).executeTakeFirst();
}

// Notes actives de la relève entre since (exclu) et until (inclus) : écrites
// dans l'intervalle, ou consignes prioritaires corrigées dans l'intervalle.
function inWindow(since: Date, until: Date) {
  return sql<boolean>`n.status = 'active' AND (
    (n.created_at > ${since} AND n.created_at <= ${until})
    OR (n.is_priority AND n.content_edited_at > ${since} AND n.content_edited_at <= ${until}))`;
}

const handoverRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;
  app.addHook('preHandler', authenticate);

  app.get('/handover', {
    schema: {
      response: {
        200: Type.Object({
          generatedAt: Type.String(),           // à renvoyer à POST /handover/ack
          since: Type.String(),
          lastHandoverAt: Nullable(Type.String()),
          notes: Type.Array(NoteBody),
          truncated: Type.Boolean(),            // plus de 200 notes : voir le journal
          counts: Type.Object({ notes: Type.Integer(), priority: Type.Integer(), unread: Type.Integer() }),
          followUps: Type.Array(FollowUpBody),
          appointments: Type.Array(AppointmentBody),
        }),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const userId = request.user.sub;
    const generatedAt = await dbNow(db);

    const last = await lastHandover(db, userId, residenceId);
    const since = last?.acknowledged_at ?? new Date(generatedAt.getTime() - FIRST_HANDOVER_LOOKBACK_MS);

    // Sections des modules masqués pour cette personne : vides
    const levels = await featureLevels(request);
    const [rows, followUps, appointments] = await Promise.all([
      noteQuery(db, residenceId, userId)
        .where(inWindow(since, generatedAt))
        .orderBy('n.is_priority', 'desc').orderBy('n.occurred_at', 'desc')
        .limit(MAX_NOTES + 1)
        .execute(),
      !atLeast(levels.followUps, 'read') ? [] : orderFollowUps(followUpQuery(db, residenceId)
        .where('f.closed_at', 'is', null)
        .where((eb) => eb.or([eb('f.assigned_to', '=', userId), eb('f.assigned_to', 'is', null)])))
        .execute(),
      !atLeast(levels.agenda, 'read') ? [] : appointmentQuery(db, residenceId)
        .where('a.status', '=', 'prevu')
        .where('a.starts_at', '>=', new Date(generatedAt.getTime() - APPOINTMENTS_BEHIND_MS))
        .where('a.starts_at', '<', new Date(generatedAt.getTime() + APPOINTMENTS_AHEAD_MS))
        .orderBy('a.starts_at')
        .execute(),
    ]);

    const notes = rows.slice(0, MAX_NOTES).map(toNote);
    return {
      generatedAt: generatedAt.toISOString(),
      since: since.toISOString(),
      lastHandoverAt: last?.acknowledged_at.toISOString() ?? null,
      notes,
      truncated: rows.length > MAX_NOTES,
      counts: {
        notes: notes.length,
        priority: notes.filter((n) => n.isPriority).length,
        unread: notes.filter((n) => !n.readByMe).length,
      },
      followUps: followUps.map((f) => toFollowUp(f, generatedAt)),
      appointments: appointments.map(toAppointment),
    };
  });

  app.post('/handover/ack', {
    schema: {
      body: Type.Object({ seenUntil: Type.Optional(Type.String({ format: 'date-time' })) }),
      response: { 201: Type.Object({ acknowledgedAt: Type.String() }) },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const userId = request.user.sub;
    const now = await dbNow(db);
    const seenUntil = request.body.seenUntil ? new Date(request.body.seenUntil) : now;
    if (seenUntil > now) throw badRequest('invalid_seen_until', 'seenUntil ne peut pas être dans le futur.');
    const last = await lastHandover(db, userId, residenceId);
    const since = last?.acknowledged_at ?? new Date(now.getTime() - FIRST_HANDOVER_LOOKBACK_MS);

    const row = await db.transaction().execute(async (trx) => {
      // Consignes prioritaires de la relève pas encore lues : à confirmer une à une d'abord
      const pending = await trx.selectFrom('notes as n').select((eb) => eb.fn.countAll<string>().as('count'))
        .where('n.residence_id', '=', residenceId)
        .where('n.is_priority', '=', true)
        .where(inWindow(since, seenUntil))
        .where(sql<boolean>`NOT ${validReadSql(userId)}`)
        .executeTakeFirstOrThrow();
      const count = Number(pending.count);
      if (count > 0) {
        throw new HttpError(409, 'priority_unread', count === 1
          ? 'Confirmez d\'abord la lecture de la consigne prioritaire.'
          : `Confirmez d'abord la lecture des ${count} consignes prioritaires.`);
      }

      // Les notes ordinaires de la relève sont lues
      await trx.insertInto('note_reads')
        .columns(['residence_id', 'note_id', 'user_id'])
        .expression(trx.selectFrom('notes as n')
          .select((eb) => ['n.residence_id', 'n.id', eb.val(userId).as('user_id')])
          .where('n.residence_id', '=', residenceId)
          .where('n.is_priority', '=', false)
          .where(inWindow(since, seenUntil)))
        .onConflict((oc) => oc.columns(['note_id', 'user_id']).doNothing())
        .execute();

      const row = await trx.insertInto('handovers')
        .values({ residence_id: residenceId, user_id: request.user.sub, acknowledged_at: seenUntil })
        .returning('acknowledged_at').executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'handover', entity: 'user', entityId: request.user.sub, userId: request.user.sub,
        residenceId, ip: request.ip,
      });
      return row;
    });
    return reply.code(201).send({ acknowledgedAt: row.acknowledged_at.toISOString() });
  });
};

export default handoverRoutes;
