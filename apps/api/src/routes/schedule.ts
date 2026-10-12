// Horaires du personnel.
//
//   Quarts types (Jour, Soir, Nuit…)
//     GET   /shift-types            tous : quarts actifs (?all=true, responsable : aussi les désactivés)
//     POST  /shift-types            responsable : { label, startTime, endTime, sortOrder? }
//     PATCH /shift-types/:id        responsable : { label?, startTime?, endTime?, sortOrder?, isActive? }
//   Horaire
//     GET   /shifts                 tous : quarts de la période [from, to] (dates locales), ?userId=
//     POST  /shifts                 responsable : { userId, workDate, shiftTypeId, startTime?, endTime?, notes? }
//     PATCH /shifts/:id             responsable : heures (exception), quart type, notes
//     POST  /shifts/:id/cancel      responsable : retirer de l'horaire (rien n'est supprimé)
//     POST  /shifts/copy-week       responsable : copier une semaine sur une autre
//
// Heures locales « HH:MM » ; fin ≤ début = le quart finit le lendemain.
// Toutes les écritures sont auditées.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql, type Updateable } from 'kysely';
import { authenticate, requireRole, residenceOf } from '../auth.js';
import type { Shifts } from '../db/types.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import type { Db } from '../lib/note-view.js';
import { DateOnly, IdParams, Nullable, optionalText, Text, Uuid } from '../lib/schemas.js';

const MAX_RANGE_DAYS = 62;
const Time = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });   // HH:MM
const hhmm = (value: string) => value.slice(0, 5);                      // « 07:00:00 » → « 07:00 »

const ShiftTypeBody = Type.Object({
  id: Type.String(),
  label: Type.String(),
  startTime: Type.String(),
  endTime: Type.String(),
  sortOrder: Type.Integer(),
  isActive: Type.Boolean(),
});

const ShiftBody = Type.Object({
  id: Type.String(),
  workDate: Type.String(),
  startTime: Type.String(),
  endTime: Type.String(),
  overnight: Type.Boolean(),              // finit le lendemain
  adjusted: Type.Boolean(),               // heures différentes du quart type
  notes: Nullable(Type.String()),
  shiftType: Type.Object({ id: Type.String(), label: Type.String() }),
  user: Type.Object({ id: Type.String(), firstName: Type.String(), lastName: Type.String(), role: Type.String() }),
});

const toShiftType = (r: { id: string; label: string; start_time: string; end_time: string; sort_order: number; is_active: boolean }) => ({
  id: r.id, label: r.label, startTime: hhmm(r.start_time), endTime: hhmm(r.end_time), sortOrder: r.sort_order, isActive: r.is_active,
});

function shiftQuery(db: Db, residenceId: string) {
  return db.selectFrom('shifts as s')
    .innerJoin('shift_types as t', 't.id', 's.shift_type_id')
    .innerJoin('users as u', 'u.id', 's.user_id')
    .where('s.residence_id', '=', residenceId)
    .where('s.cancelled_at', 'is', null)
    .select([
      's.id', 's.work_date', 's.start_time', 's.end_time', 's.notes',
      't.id as type_id', 't.label as type_label', 't.start_time as type_start', 't.end_time as type_end',
      'u.id as user_id', 'u.first_name', 'u.last_name', 'u.role',
    ]);
}

type ShiftRow = Awaited<ReturnType<ReturnType<typeof shiftQuery>['executeTakeFirstOrThrow']>>;

const toShift = (r: ShiftRow) => ({
  id: r.id,
  workDate: r.work_date,
  startTime: hhmm(r.start_time),
  endTime: hhmm(r.end_time),
  overnight: r.end_time <= r.start_time,
  adjusted: r.start_time !== r.type_start || r.end_time !== r.type_end,
  notes: r.notes,
  shiftType: { id: r.type_id, label: r.type_label },
  user: { id: r.user_id, firstName: r.first_name, lastName: r.last_name, role: r.role },
});

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';
const alreadyScheduled = () => new HttpError(409, 'already_scheduled', 'Cet employé a déjà ce quart ce jour-là.');

function cleanLabel(value: string) {
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label) throw badRequest('invalid_label', 'Nom du quart obligatoire.');
  return label;
}

function assertTimes(start: string, end: string) {
  if (hhmm(start) === hhmm(end)) throw badRequest('invalid_times', 'Le début et la fin du quart doivent être différents.');
}

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
const isMonday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

const scheduleRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;
  const typeColumns = ['id', 'label', 'start_time', 'end_time', 'sort_order', 'is_active'] as const;

  async function findShift(residenceId: string, id: string) {
    const row = await shiftQuery(db, residenceId).where('s.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Quart introuvable.');
    return toShift(row);
  }

  async function activeType(trx: Db, residenceId: string, id: string) {
    const type = await trx.selectFrom('shift_types').select(['id', 'start_time', 'end_time'])
      .where('id', '=', id).where('residence_id', '=', residenceId).where('is_active', '=', true)
      .executeTakeFirst();
    if (!type) throw badRequest('invalid_shift_type', 'Quart type inconnu ou désactivé.');
    return type;
  }

  async function assertEmployee(trx: Db, residenceId: string, userId: string) {
    const user = await trx.selectFrom('users').select('id')
      .where('id', '=', userId).where('residence_id', '=', residenceId).where('is_active', '=', true)
      .executeTakeFirst();
    if (!user) throw badRequest('invalid_user', 'Employé introuvable ou désactivé dans cette résidence.');
  }

  // -------------------------------------------------------------------
  // Quarts types
  // -------------------------------------------------------------------
  app.get('/shift-types', {
    preHandler: authenticate,
    schema: {
      querystring: Type.Object({ all: Type.Boolean({ default: false }) }),
      response: { 200: Type.Array(ShiftTypeBody) },
    },
  }, async (request) => {
    if (request.query.all && request.user.role !== 'responsable') {
      throw forbidden('Seule la responsable voit les quarts désactivés.');
    }
    let query = db.selectFrom('shift_types').select(typeColumns).where('residence_id', '=', residenceOf(request));
    if (!request.query.all) query = query.where('is_active', '=', true);
    return (await query.orderBy('sort_order').orderBy('start_time').execute()).map(toShiftType);
  });

  app.post('/shift-types', {
    preHandler: requireRole('responsable'),
    schema: {
      body: Type.Object({
        label: Text(50), startTime: Time, endTime: Time,
        sortOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
      }),
      response: { 201: ShiftTypeBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    assertTimes(b.startTime, b.endTime);
    try {
      const row = await db.transaction().execute(async (trx) => {
        const row = await trx.insertInto('shift_types').values({
          residence_id: residenceId, label: cleanLabel(b.label), start_time: b.startTime, end_time: b.endTime,
          sort_order: b.sortOrder ?? 0,
        }).returning(typeColumns).executeTakeFirstOrThrow();
        await audit(trx, {
          action: 'create', entity: 'shift_type', entityId: row.id, userId: request.user.sub, residenceId, ip: request.ip,
        });
        return row;
      });
      return reply.code(201).send(toShiftType(row));
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'duplicate_label', 'Un quart porte déjà ce nom.');
      throw err;
    }
  });

  // Changer les heures d'un quart type ne modifie pas les quarts déjà planifiés
  app.patch('/shift-types/:id', {
    preHandler: requireRole('responsable'),
    schema: {
      params: IdParams,
      body: Type.Object({
        label: Type.Optional(Text(50)), startTime: Type.Optional(Time), endTime: Type.Optional(Time),
        sortOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })), isActive: Type.Optional(Type.Boolean()),
      }, { minProperties: 1 }),
      response: { 200: ShiftTypeBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    try {
      const row = await db.transaction().execute(async (trx) => {
        const current = await trx.selectFrom('shift_types').select(typeColumns)
          .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
          .forUpdate().executeTakeFirst();
        if (!current) throw notFound('Quart type introuvable.');
        assertTimes(b.startTime ?? current.start_time, b.endTime ?? current.end_time);
        const row = await trx.updateTable('shift_types').set({
          ...(b.label !== undefined ? { label: cleanLabel(b.label) } : {}),
          ...(b.startTime !== undefined ? { start_time: b.startTime } : {}),
          ...(b.endTime !== undefined ? { end_time: b.endTime } : {}),
          ...(b.sortOrder !== undefined ? { sort_order: b.sortOrder } : {}),
          ...(b.isActive !== undefined ? { is_active: b.isActive } : {}),
        }).where('id', '=', current.id).returning(typeColumns).executeTakeFirstOrThrow();
        await audit(trx, {
          action: 'update', entity: 'shift_type', entityId: current.id, userId: request.user.sub, residenceId,
          details: { fields: Object.keys(b) }, ip: request.ip,
        });
        return row;
      });
      return toShiftType(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'duplicate_label', 'Un quart porte déjà ce nom.');
      throw err;
    }
  });

  // -------------------------------------------------------------------
  // Horaire
  // -------------------------------------------------------------------
  app.get('/shifts', {
    preHandler: authenticate,
    schema: {
      querystring: Type.Object({ from: DateOnly, to: DateOnly, userId: Type.Optional(Uuid) }),
      response: { 200: Type.Array(ShiftBody) },
    },
  }, async (request) => {
    const { from, to, userId } = request.query;
    const span = daysBetween(from, to);
    if (span < 0) throw badRequest('invalid_range', 'La fin de la période doit être après le début.');
    if (span > MAX_RANGE_DAYS) throw badRequest('invalid_range', `Période de ${MAX_RANGE_DAYS} jours au plus.`);

    let query = shiftQuery(db, residenceOf(request)).where('s.work_date', '>=', from).where('s.work_date', '<=', to);
    if (userId) query = query.where('s.user_id', '=', userId);
    const rows = await query
      .orderBy('s.work_date').orderBy('s.start_time')
      .orderBy(sql`u.last_name COLLATE "fr-CA-x-icu"`)
      .execute();
    return rows.map(toShift);
  });

  app.post('/shifts', {
    preHandler: requireRole('responsable'),
    schema: {
      body: Type.Object({
        userId: Uuid, workDate: DateOnly, shiftTypeId: Uuid,
        startTime: Type.Optional(Time), endTime: Type.Optional(Time),     // absents : heures du quart type
        notes: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
      }),
      response: { 201: ShiftBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    try {
      const id = await db.transaction().execute(async (trx) => {
        await assertEmployee(trx, residenceId, b.userId);
        const type = await activeType(trx, residenceId, b.shiftTypeId);
        const start = b.startTime ?? type.start_time;
        const end = b.endTime ?? type.end_time;
        assertTimes(start, end);
        const { id } = await trx.insertInto('shifts').values({
          residence_id: residenceId, user_id: b.userId, shift_type_id: type.id, work_date: b.workDate,
          start_time: start, end_time: end, notes: optionalText(b.notes), created_by: request.user.sub,
        }).returning('id').executeTakeFirstOrThrow();
        await audit(trx, {
          action: 'create', entity: 'shift', entityId: id, userId: request.user.sub, residenceId,
          details: { user_id: b.userId, work_date: b.workDate }, ip: request.ip,
        });
        return id;
      });
      return reply.code(201).send(await findShift(residenceId, id));
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyScheduled();
      throw err;
    }
  });

  app.patch('/shifts/:id', {
    preHandler: requireRole('responsable'),
    schema: {
      params: IdParams,
      body: Type.Object({
        shiftTypeId: Type.Optional(Uuid),
        startTime: Type.Optional(Time), endTime: Type.Optional(Time),
        notes: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
      }, { minProperties: 1 }),
      response: { 200: ShiftBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    try {
      await db.transaction().execute(async (trx) => {
        const current = await trx.selectFrom('shifts').selectAll()
          .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
          .where('cancelled_at', 'is', null).forUpdate().executeTakeFirst();
        if (!current) throw notFound('Quart introuvable.');

        const changes: Updateable<Shifts> = {};
        if (b.shiftTypeId !== undefined && b.shiftTypeId !== current.shift_type_id) {
          const type = await activeType(trx, residenceId, b.shiftTypeId);
          changes.shift_type_id = type.id;
          // Nouveau quart type : ses heures, sauf si d'autres heures sont envoyées
          changes.start_time = type.start_time;
          changes.end_time = type.end_time;
        }
        if (b.startTime !== undefined) changes.start_time = b.startTime;
        if (b.endTime !== undefined) changes.end_time = b.endTime;
        if (b.notes !== undefined) changes.notes = optionalText(b.notes);
        assertTimes(String(changes.start_time ?? current.start_time), String(changes.end_time ?? current.end_time));

        await trx.updateTable('shifts').set(changes).where('id', '=', current.id).execute();
        await audit(trx, {
          action: 'update', entity: 'shift', entityId: current.id, userId: request.user.sub, residenceId,
          details: { fields: Object.keys(b) }, ip: request.ip,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyScheduled();
      throw err;
    }
    return findShift(residenceId, request.params.id);
  });

  app.post('/shifts/:id/cancel', {
    preHandler: requireRole('responsable'),
    schema: { params: IdParams },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    await db.transaction().execute(async (trx) => {
      const current = await trx.updateTable('shifts')
        .set({ cancelled_at: new Date(), cancelled_by: request.user.sub })
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .where('cancelled_at', 'is', null)
        .returning(['id', 'user_id', 'work_date']).executeTakeFirst();
      if (!current) throw notFound('Quart introuvable.');
      await audit(trx, {
        action: 'cancel', entity: 'shift', entityId: current.id, userId: request.user.sub, residenceId,
        details: { user_id: current.user_id, work_date: current.work_date }, ip: request.ip,
      });
    });
    return reply.code(204).send();
  });

  // Copie une semaine (lundi → dimanche) sur une autre. Les quarts déjà
  // présents dans la semaine cible sont gardés ; les doublons sont ignorés.
  // Employés ou quarts types désactivés depuis : non copiés.
  app.post('/shifts/copy-week', {
    preHandler: requireRole('responsable'),
    schema: {
      body: Type.Object({ fromWeek: DateOnly, toWeek: DateOnly }),
      response: { 200: Type.Object({ created: Type.Integer(), skipped: Type.Integer() }) },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const { fromWeek, toWeek } = request.body;
    if (!isMonday(fromWeek) || !isMonday(toWeek)) throw badRequest('invalid_week', 'Les semaines commencent un lundi.');
    if (fromWeek === toWeek) throw badRequest('invalid_week', 'Choisir deux semaines différentes.');
    const offset = daysBetween(fromWeek, toWeek);

    return db.transaction().execute(async (trx) => {
      const source = await trx.selectFrom('shifts as s')
        .innerJoin('users as u', 'u.id', 's.user_id')
        .innerJoin('shift_types as t', 't.id', 's.shift_type_id')
        .select(['s.user_id', 's.shift_type_id', 's.work_date', 's.start_time', 's.end_time', 's.notes'])
        .where('s.residence_id', '=', residenceId).where('s.cancelled_at', 'is', null)
        .where('s.work_date', '>=', fromWeek)
        .where('s.work_date', '<=', sql<string>`${fromWeek}::date + 6`)
        .where('u.is_active', '=', true).where('t.is_active', '=', true)
        .execute();
      if (source.length === 0) return { created: 0, skipped: 0 };

      const inserted = await trx.insertInto('shifts')
        .values(source.map((s) => ({
          residence_id: residenceId, user_id: s.user_id, shift_type_id: s.shift_type_id,
          work_date: sql<string>`${s.work_date}::date + ${offset}::int`,
          start_time: s.start_time, end_time: s.end_time, notes: s.notes, created_by: request.user.sub,
        })))
        .onConflict((oc) => oc.columns(['user_id', 'work_date', 'shift_type_id']).where('cancelled_at', 'is', null).doNothing())
        .returning('id')
        .execute();
      await audit(trx, {
        action: 'copy_week', entity: 'shift', userId: request.user.sub, residenceId,
        details: { from_week: fromWeek, to_week: toWeek, created: inserted.length }, ip: request.ip,
      });
      return { created: inserted.length, skipped: source.length - inserted.length };
    });
  });
};

export default scheduleRoutes;
