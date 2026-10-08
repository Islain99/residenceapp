// Relève de quart : « quoi de neuf depuis ma dernière relève ».
//
//   GET  /handover      notes écrites depuis la dernière relève confirmée
//                       (prioritaires d'abord) + suivis ouverts qui me
//                       concernent (assignés à moi ou à toute l'équipe).
//   POST /handover/ack  « j'ai pris connaissance » : enregistre l'instant
//                       generatedAt reçu du GET, pour qu'une note écrite
//                       entre la lecture et la confirmation ne soit pas perdue.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { authenticate, residenceOf } from '../auth.js';
import type { Database } from '../db/index.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { FollowUpBody, followUpQuery, orderFollowUps, toFollowUp } from '../lib/follow-up-view.js';
import { NoteBody, noteQuery, toNote } from '../lib/note-view.js';
import { Nullable } from '../lib/schemas.js';

const FIRST_HANDOVER_LOOKBACK_MS = 24 * 60 * 60 * 1000;   // aucune relève encore : dernières 24 h
const MAX_NOTES = 200;

// Heure de la base : notes.created_at vient de son horloge. Comparer avec
// l'horloge de l'API (autre machine, autre conteneur) pourrait perdre une note.
async function dbNow(db: Database): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(db);
  return rows[0]!.now;
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
        }),
      },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const userId = request.user.sub;
    const generatedAt = await dbNow(db);

    const last = await db.selectFrom('handovers').select('acknowledged_at')
      .where('user_id', '=', userId).where('residence_id', '=', residenceId)
      .orderBy('acknowledged_at', 'desc').limit(1).executeTakeFirst();
    const since = last?.acknowledged_at ?? new Date(generatedAt.getTime() - FIRST_HANDOVER_LOOKBACK_MS);

    const [rows, followUps] = await Promise.all([
      noteQuery(db, residenceId, userId)
        .where('n.status', '=', 'active')
        .where('n.created_at', '>', since)
        .where('n.created_at', '<=', generatedAt)
        .orderBy('n.is_priority', 'desc').orderBy('n.occurred_at', 'desc')
        .limit(MAX_NOTES + 1)
        .execute(),
      orderFollowUps(followUpQuery(db, residenceId)
        .where('f.closed_at', 'is', null)
        .where((eb) => eb.or([eb('f.assigned_to', '=', userId), eb('f.assigned_to', 'is', null)])))
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
    };
  });

  app.post('/handover/ack', {
    schema: {
      body: Type.Object({ seenUntil: Type.Optional(Type.String({ format: 'date-time' })) }),
      response: { 201: Type.Object({ acknowledgedAt: Type.String() }) },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const now = await dbNow(db);
    const seenUntil = request.body.seenUntil ? new Date(request.body.seenUntil) : now;
    if (seenUntil > now) throw badRequest('invalid_seen_until', 'seenUntil ne peut pas être dans le futur.');

    const row = await db.transaction().execute(async (trx) => {
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
