// Suivis : actions à faire issues d'une note (« surveiller la mobilité 48 h »).
//
// Règles :
//   * Tous les rôles créent, modifient et ferment des suivis (travail d'équipe).
//   * Un suivi naît d'une note active de la résidence ; il peut être assigné
//     à un employé actif de la résidence, ou à toute l'équipe (sans assignation).
//   * Un suivi fermé ne change plus. Aucune suppression.
//   * Création, modification et fermeture sont auditées.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { authenticate, residenceOf } from '../auth.js';
import { audit } from '../lib/audit.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { FollowUpBody, followUpQuery, orderFollowUps, toFollowUp } from '../lib/follow-up-view.js';
import type { Db } from '../lib/note-view.js';
import { IdParams, Nullable, optionalText, Text, Uuid } from '../lib/schemas.js';

async function assertAssignee(db: Db, residenceId: string, userId: string): Promise<void> {
  const found = await db.selectFrom('users').select('id')
    .where('id', '=', userId).where('residence_id', '=', residenceId).where('is_active', '=', true)
    .executeTakeFirst();
  if (!found) throw badRequest('invalid_assignee', 'Employé introuvable ou inactif dans cette résidence.');
}

function requiredText(value: string): string {
  const text = value.trim();
  if (!text) throw badRequest('invalid_description', 'La description du suivi est obligatoire.');
  return text;
}

const followUpRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;
  app.addHook('preHandler', authenticate);

  async function findFollowUp(residenceId: string, id: string) {
    const row = await followUpQuery(db, residenceId).where('f.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Suivi introuvable.');
    return toFollowUp(row);
  }

  // Liste : ouverts par défaut, échéance la plus proche d'abord
  app.get('/follow-ups', {
    schema: {
      querystring: Type.Object({
        status: Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('all')], { default: 'open' }),
        // me : assignés à moi ; team : sans assignation ; ou l'identifiant d'un employé
        assignedTo: Type.Optional(Type.Union([Type.Literal('me'), Type.Literal('team'), Uuid])),
        residentId: Type.Optional(Uuid),
        limit: Type.Integer({ minimum: 1, maximum: 200, default: 100 }),
      }),
      response: { 200: Type.Array(FollowUpBody) },
    },
  }, async (request) => {
    const f = request.query;
    let query = followUpQuery(db, residenceOf(request));
    if (f.status === 'open') query = query.where('f.closed_at', 'is', null);
    if (f.status === 'closed') query = query.where('f.closed_at', 'is not', null);
    if (f.assignedTo === 'team') query = query.where('f.assigned_to', 'is', null);
    else if (f.assignedTo) query = query.where('f.assigned_to', '=', f.assignedTo === 'me' ? request.user.sub : f.assignedTo);
    if (f.residentId) query = query.where('n.resident_id', '=', f.residentId);
    const rows = await orderFollowUps(query).limit(f.limit).execute();
    const now = new Date();
    return rows.map((row) => toFollowUp(row, now));
  });

  app.get('/follow-ups/:id', {
    schema: { params: IdParams, response: { 200: FollowUpBody } },
  }, async (request) => findFollowUp(residenceOf(request), request.params.id));

  // Nouveau suivi rattaché à une note active
  app.post('/notes/:id/follow-ups', {
    schema: {
      params: IdParams,
      body: Type.Object({
        description: Text(1000),
        assignedTo: Type.Optional(Nullable(Uuid)),          // absent ou null : toute l'équipe
        dueAt: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
      }),
      response: { 201: FollowUpBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const id = await db.transaction().execute(async (trx) => {
      const note = await trx.selectFrom('notes').select(['id', 'status'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .executeTakeFirst();
      if (!note) throw notFound('Note introuvable.');
      if (note.status === 'annulee') {
        throw new HttpError(409, 'note_cancelled', 'Note annulée : on ne peut plus y ajouter de suivi.');
      }
      if (b.assignedTo) await assertAssignee(trx, residenceId, b.assignedTo);

      const { id } = await trx.insertInto('follow_ups').values({
        residence_id: residenceId,
        note_id: note.id,
        description: requiredText(b.description),
        assigned_to: b.assignedTo ?? null,
        due_at: b.dueAt ? new Date(b.dueAt) : null,
        created_by: request.user.sub,
      }).returning('id').executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'follow_up', entityId: id, userId: request.user.sub, residenceId,
        details: { note_id: note.id, assigned_to: b.assignedTo ?? null }, ip: request.ip,
      });
      return id;
    });
    return reply.code(201).send(await findFollowUp(residenceId, id));
  });

  // Modifier un suivi ouvert (description, assignation, échéance)
  app.patch('/follow-ups/:id', {
    schema: {
      params: IdParams,
      body: Type.Object({
        description: Type.Optional(Text(1000)),
        assignedTo: Type.Optional(Nullable(Uuid)),
        dueAt: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
      }, { minProperties: 1 }),
      response: { 200: FollowUpBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('follow_ups').select(['id', 'closed_at'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate().executeTakeFirst();
      if (!current) throw notFound('Suivi introuvable.');
      if (current.closed_at) throw new HttpError(409, 'follow_up_closed', 'Suivi fermé : il ne peut plus être modifié.');
      if (b.assignedTo) await assertAssignee(trx, residenceId, b.assignedTo);

      await trx.updateTable('follow_ups').set({
        ...(b.description !== undefined ? { description: requiredText(b.description) } : {}),
        ...(b.assignedTo !== undefined ? { assigned_to: b.assignedTo } : {}),
        ...(b.dueAt !== undefined ? { due_at: b.dueAt ? new Date(b.dueAt) : null } : {}),
      }).where('id', '=', current.id).execute();
      await audit(trx, {
        action: 'update', entity: 'follow_up', entityId: current.id, userId: request.user.sub, residenceId,
        details: { fields: Object.keys(b) }, ip: request.ip,
      });
    });
    return findFollowUp(residenceId, request.params.id);
  });

  // Fermer un suivi (note de clôture facultative)
  app.post('/follow-ups/:id/close', {
    schema: {
      params: IdParams,
      body: Type.Object({ closingNote: Type.Optional(Nullable(Type.String({ maxLength: 1000 }))) }),
      response: { 200: FollowUpBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('follow_ups').select(['id', 'closed_at'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate().executeTakeFirst();
      if (!current) throw notFound('Suivi introuvable.');
      if (current.closed_at) throw new HttpError(409, 'follow_up_closed', 'Suivi déjà fermé.');

      await trx.updateTable('follow_ups').set({
        closed_at: new Date(), closed_by: request.user.sub, closing_note: optionalText(request.body.closingNote),
      }).where('id', '=', current.id).execute();
      await audit(trx, {
        action: 'close', entity: 'follow_up', entityId: current.id, userId: request.user.sub, residenceId,
        ip: request.ip,
      });
    });
    return findFollowUp(residenceId, request.params.id);
  });
};

export default followUpRoutes;
