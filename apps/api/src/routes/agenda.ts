// Agenda de la résidence : rendez-vous des résidents et de la résidence.
//
// Règles :
//   * Tout le personnel consulte et ajoute des rendez-vous.
//   * Modifier ou annuler : l'auteur, ou une infirmière / responsable.
//     Un rendez-vous annulé ne change plus. Aucune suppression.
//   * Création, modification et annulation sont auditées.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { Updateable } from 'kysely';
import { authenticate, isSupervisor, residenceOf, type AccessTokenPayload } from '../auth.js';
import type { Appointments } from '../db/types.js';
import { AppointmentBody, appointmentQuery, Kind, toAppointment } from '../lib/appointment-view.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import type { Db } from '../lib/note-view.js';
import { IdParams, Nullable, optionalText, Text, Uuid } from '../lib/schemas.js';

const MAX_RANGE_DAYS = 92;   // une liste couvre au plus un trimestre

const DateTime = Type.String({ format: 'date-time' });

async function assertResident(db: Db, residenceId: string, residentId: string): Promise<void> {
  const found = await db.selectFrom('residents').select('id')
    .where('id', '=', residentId).where('residence_id', '=', residenceId)
    .executeTakeFirst();
  if (!found) throw badRequest('invalid_resident', 'Résident introuvable.');
}

function requiredTitle(value: string): string {
  const title = value.trim();
  if (!title) throw badRequest('invalid_title', 'Le titre du rendez-vous est obligatoire.');
  return title;
}

function assertTimes(startsAt: Date, endsAt: Date | null): void {
  if (endsAt && endsAt <= startsAt) throw badRequest('invalid_end', 'La fin doit être après le début.');
}

function assertCanModify(user: AccessTokenPayload, row: { created_by: string; status: string }): void {
  if (row.status === 'annule') {
    throw new HttpError(409, 'appointment_cancelled', 'Rendez-vous annulé : il ne peut plus être modifié.');
  }
  if (!isSupervisor(user.role) && row.created_by !== user.sub) {
    throw forbidden("Seul l'auteur ou une infirmière / responsable peut modifier ce rendez-vous.");
  }
}

const agendaRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;
  app.addHook('preHandler', authenticate);

  async function findAppointment(residenceId: string, id: string) {
    const row = await appointmentQuery(db, residenceId).where('a.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Rendez-vous introuvable.');
    return toAppointment(row);
  }

  // Rendez-vous qui commencent dans la période [from, to[, du plus tôt au plus tard
  app.get('/appointments', {
    schema: {
      querystring: Type.Object({
        from: DateTime,
        to: DateTime,
        residentId: Type.Optional(Uuid),
        kind: Type.Optional(Kind),
        status: Type.Union([Type.Literal('prevu'), Type.Literal('annule'), Type.Literal('all')], { default: 'prevu' }),
      }),
      response: { 200: Type.Array(AppointmentBody) },
    },
  }, async (request) => {
    const f = request.query;
    const from = new Date(f.from);
    const to = new Date(f.to);
    if (to <= from) throw badRequest('invalid_range', 'La fin de la période doit être après le début.');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw badRequest('invalid_range', `Période de ${MAX_RANGE_DAYS} jours au plus.`);
    }

    let query = appointmentQuery(db, residenceOf(request))
      .where('a.starts_at', '>=', from).where('a.starts_at', '<', to);
    if (f.residentId) query = query.where('a.resident_id', '=', f.residentId);
    if (f.kind) query = query.where('a.kind', '=', f.kind);
    if (f.status !== 'all') query = query.where('a.status', '=', f.status);
    const rows = await query.orderBy('a.starts_at').orderBy('a.id').execute();
    return rows.map(toAppointment);
  });

  app.get('/appointments/:id', {
    schema: { params: IdParams, response: { 200: AppointmentBody } },
  }, async (request) => findAppointment(residenceOf(request), request.params.id));

  app.post('/appointments', {
    schema: {
      body: Type.Object({
        kind: Kind,
        title: Text(200),
        residentId: Type.Optional(Nullable(Uuid)),       // absent ou null : rendez-vous de la résidence
        location: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
        startsAt: DateTime,
        endsAt: Type.Optional(Nullable(DateTime)),
        details: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
      }),
      response: { 201: AppointmentBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const startsAt = new Date(b.startsAt);
    const endsAt = b.endsAt ? new Date(b.endsAt) : null;
    assertTimes(startsAt, endsAt);

    const id = await db.transaction().execute(async (trx) => {
      if (b.residentId) await assertResident(trx, residenceId, b.residentId);
      const { id } = await trx.insertInto('appointments').values({
        residence_id: residenceId,
        resident_id: b.residentId ?? null,
        kind: b.kind,
        title: requiredTitle(b.title),
        location: optionalText(b.location),
        starts_at: startsAt,
        ends_at: endsAt,
        details: optionalText(b.details),
        created_by: request.user.sub,
      }).returning('id').executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'appointment', entityId: id, userId: request.user.sub, residenceId,
        details: { kind: b.kind, resident_id: b.residentId ?? null }, ip: request.ip,
      });
      return id;
    });
    return reply.code(201).send(await findAppointment(residenceId, id));
  });

  app.patch('/appointments/:id', {
    schema: {
      params: IdParams,
      body: Type.Object({
        kind: Type.Optional(Kind),
        title: Type.Optional(Text(200)),
        residentId: Type.Optional(Nullable(Uuid)),
        location: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
        startsAt: Type.Optional(DateTime),
        endsAt: Type.Optional(Nullable(DateTime)),
        details: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
      }, { minProperties: 1 }),
      response: { 200: AppointmentBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('appointments').selectAll()
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate().executeTakeFirst();
      if (!current) throw notFound('Rendez-vous introuvable.');
      assertCanModify(request.user, current);

      const changes: Updateable<Appointments> = {};
      if (b.kind !== undefined) changes.kind = b.kind;
      if (b.title !== undefined) changes.title = requiredTitle(b.title);
      if (b.location !== undefined) changes.location = optionalText(b.location);
      if (b.details !== undefined) changes.details = optionalText(b.details);
      if (b.residentId !== undefined) {
        if (b.residentId) await assertResident(trx, residenceId, b.residentId);
        changes.resident_id = b.residentId;
      }
      if (b.startsAt !== undefined) changes.starts_at = new Date(b.startsAt);
      if (b.endsAt !== undefined) changes.ends_at = b.endsAt ? new Date(b.endsAt) : null;
      assertTimes(
        (changes.starts_at as Date | undefined) ?? current.starts_at,
        changes.ends_at !== undefined ? (changes.ends_at as Date | null) : current.ends_at,
      );

      await trx.updateTable('appointments').set(changes).where('id', '=', current.id).execute();
      await audit(trx, {
        action: 'update', entity: 'appointment', entityId: current.id, userId: request.user.sub, residenceId,
        details: { fields: Object.keys(b) }, ip: request.ip,
      });
    });
    return findAppointment(residenceId, request.params.id);
  });

  // Annulation avec motif (le rendez-vous reste visible, statut « annule »)
  app.post('/appointments/:id/cancel', {
    schema: {
      params: IdParams,
      body: Type.Object({ reason: Type.String({ minLength: 3, maxLength: 500 }) }),
      response: { 200: AppointmentBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const reason = request.body.reason.trim();
    if (reason.length < 3) throw badRequest('invalid_reason', "Le motif d'annulation est obligatoire.");

    await db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('appointments').select(['id', 'created_by', 'status'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate().executeTakeFirst();
      if (!current) throw notFound('Rendez-vous introuvable.');
      assertCanModify(request.user, current);

      await trx.updateTable('appointments').set({
        status: 'annule', cancel_reason: reason, cancelled_by: request.user.sub, cancelled_at: new Date(),
      }).where('id', '=', current.id).execute();
      await audit(trx, {
        action: 'cancel', entity: 'appointment', entityId: current.id, userId: request.user.sub, residenceId,
        details: { reason }, ip: request.ip,
      });
    });
    return findAppointment(residenceId, request.params.id);
  });
};

export default agendaRoutes;
