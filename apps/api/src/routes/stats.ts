// Statistiques d'un résident sur un mois ou une année, comparées à la
// période précédente : notes par catégorie, évolution dans le temps,
// moments de la journée, suivis et rendez-vous.
//
//   GET /residents/:id/stats?period=month|year&date=AAAA-MM-JJ
//     date : un jour de la période voulue (défaut : aujourd'hui)
//
// Infirmière et responsable seulement (synthèse de données de santé).
// Les notes annulées ne comptent pas. Les périodes et les heures suivent
// le fuseau de la résidence (une note de 23 h reste sur son jour).
// Chaque consultation est inscrite dans audit_log.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { requireRole, residenceOf, SUPERVISOR_ROLES } from '../auth.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { DateOnly, IdParams } from '../lib/schemas.js';

const SLOTS = ['nuit', 'matin', 'apres_midi', 'soir'] as const;   // 0-6 h, 6-12 h, 12-18 h, 18-24 h

const Count = Type.Integer({ minimum: 0 });

const StatsBody = Type.Object({
  resident: Type.Object({ id: Type.String(), firstName: Type.String(), lastName: Type.String() }),
  period: Type.Object({
    unit: Type.Union([Type.Literal('month'), Type.Literal('year')]),
    start: Type.String(),            // premier jour (AAAA-MM-JJ)
    end: Type.String(),              // premier jour de la période suivante (exclu)
    previousStart: Type.String(),    // premier jour de la période précédente
  }),
  totals: Type.Object({
    notes: Count, positive: Count, priority: Count,
    previousNotes: Count, previousPositive: Count, previousPriority: Count,
  }),
  categories: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), count: Count, previousCount: Count })),
  // Mois : un point par jour ; année : un point par mois
  timeline: Type.Array(Type.Object({ bucket: Type.String(), total: Count, byCategory: Type.Record(Type.String(), Count) })),
  timeOfDay: Type.Array(Type.Object({ slot: Type.String(), count: Count })),
  followUps: Type.Object({ opened: Count, closed: Count, openNow: Count }),
  appointments: Count,
});

const statsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;

  app.get('/residents/:id/stats', {
    preHandler: requireRole(...SUPERVISOR_ROLES),
    schema: {
      params: IdParams,
      querystring: Type.Object({
        period: Type.Union([Type.Literal('month'), Type.Literal('year')], { default: 'month' }),
        date: Type.Optional(DateOnly),
      }),
      response: { 200: StatsBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const unit = request.query.period;
    const step = unit === 'month' ? '1 month' : '1 year';
    const bucketUnit = unit === 'month' ? 'day' : 'month';
    const bucketStep = unit === 'month' ? '1 day' : '1 month';

    const resident = await db.selectFrom('residents as r')
      .innerJoin('residences as h', 'h.id', 'r.residence_id')
      .select(['r.id', 'r.first_name', 'r.last_name', 'h.timezone'])
      .where('r.id', '=', request.params.id).where('r.residence_id', '=', residenceId)
      .executeTakeFirst();
    if (!resident) throw notFound('Résident introuvable.');
    const tz = resident.timezone;

    // Bornes de la période, en dates locales puis en instants (fuseau de la résidence)
    const { rows: [b] } = await sql<{
      start_date: string; end_date: string; prev_date: string; cur_from: Date; cur_to: Date; prev_from: Date;
    }>`
      WITH base AS (
        SELECT date_trunc(${unit}, coalesce(${request.query.date ?? null}::date, (now() AT TIME ZONE ${tz})::date)::timestamp) AS s
      )
      SELECT s::date AS start_date,
             (s + ${step}::interval)::date AS end_date,
             (s - ${step}::interval)::date AS prev_date,
             s AT TIME ZONE ${tz} AS cur_from,
             (s + ${step}::interval) AT TIME ZONE ${tz} AS cur_to,
             (s - ${step}::interval) AT TIME ZONE ${tz} AS prev_from
      FROM base`.execute(db);
    const p = b!;

    // Notes du résident sur la période et la précédente (annulées exclues)
    const notes = () => db.selectFrom('notes as n')
      .where('n.residence_id', '=', residenceId)
      .where('n.resident_id', '=', resident.id)
      .where('n.status', '=', 'active');

    const [totals, categories, timelineRows, buckets, slots, followUps, appointments] = await Promise.all([
      notes()
        .where('n.occurred_at', '>=', p.prev_from).where('n.occurred_at', '<', p.cur_to)
        .select([
          sql<number>`count(*) FILTER (WHERE n.occurred_at >= ${p.cur_from})::int`.as('notes'),
          sql<number>`count(*) FILTER (WHERE n.occurred_at >= ${p.cur_from} AND n.is_positive)::int`.as('positive'),
          sql<number>`count(*) FILTER (WHERE n.occurred_at >= ${p.cur_from} AND n.is_priority)::int`.as('priority'),
          sql<number>`count(*) FILTER (WHERE n.occurred_at < ${p.cur_from})::int`.as('previous_notes'),
          sql<number>`count(*) FILTER (WHERE n.occurred_at < ${p.cur_from} AND n.is_positive)::int`.as('previous_positive'),
          sql<number>`count(*) FILTER (WHERE n.occurred_at < ${p.cur_from} AND n.is_priority)::int`.as('previous_priority'),
        ])
        .executeTakeFirstOrThrow(),

      // Toutes les catégories actives (même à zéro), plus les désactivées qui ont des notes
      db.selectFrom('note_categories as c')
        .leftJoin('notes as n', (join) => join
          .onRef('n.category_id', '=', 'c.id')
          .on('n.resident_id', '=', resident.id)
          .on('n.status', '=', 'active')
          .on('n.occurred_at', '>=', p.prev_from)
          .on('n.occurred_at', '<', p.cur_to))
        .where('c.residence_id', '=', residenceId)
        .groupBy(['c.id', 'c.label', 'c.sort_order', 'c.is_active'])
        .having((eb) => eb.or([eb('c.is_active', '=', true), eb(eb.fn.count('n.id'), '>', 0)]))
        .select([
          'c.id', 'c.label',
          sql<number>`count(n.id) FILTER (WHERE n.occurred_at >= ${p.cur_from})::int`.as('count'),
          sql<number>`count(n.id) FILTER (WHERE n.occurred_at < ${p.cur_from})::int`.as('previous_count'),
        ])
        .orderBy('c.sort_order').orderBy('c.label')
        .execute(),

      notes()
        .where('n.occurred_at', '>=', p.cur_from).where('n.occurred_at', '<', p.cur_to)
        .select([
          sql<string>`date_trunc(${bucketUnit}, n.occurred_at AT TIME ZONE ${tz})::date`.as('bucket'),
          'n.category_id',
          sql<number>`count(*)::int`.as('n'),
        ])
        .groupBy([sql`1`, 'n.category_id'])
        .execute(),

      sql<{ bucket: string }>`
        SELECT g::date AS bucket
        FROM generate_series(${p.start_date}::timestamp, ${p.end_date}::timestamp - ${bucketStep}::interval, ${bucketStep}::interval) g
        ORDER BY 1`.execute(db),

      notes()
        .where('n.occurred_at', '>=', p.cur_from).where('n.occurred_at', '<', p.cur_to)
        .select([
          sql<string>`CASE WHEN extract(hour FROM n.occurred_at AT TIME ZONE ${tz}) < 6 THEN 'nuit'
                           WHEN extract(hour FROM n.occurred_at AT TIME ZONE ${tz}) < 12 THEN 'matin'
                           WHEN extract(hour FROM n.occurred_at AT TIME ZONE ${tz}) < 18 THEN 'apres_midi'
                           ELSE 'soir' END`.as('slot'),
          sql<number>`count(*)::int`.as('count'),
        ])
        .groupBy(sql`1`)
        .execute(),

      db.selectFrom('follow_ups as f')
        .innerJoin('notes as n', 'n.id', 'f.note_id')
        .where('f.residence_id', '=', residenceId).where('n.resident_id', '=', resident.id)
        .select([
          sql<number>`count(*) FILTER (WHERE f.created_at >= ${p.cur_from} AND f.created_at < ${p.cur_to})::int`.as('opened'),
          sql<number>`count(*) FILTER (WHERE f.closed_at >= ${p.cur_from} AND f.closed_at < ${p.cur_to})::int`.as('closed'),
          sql<number>`count(*) FILTER (WHERE f.closed_at IS NULL)::int`.as('open_now'),
        ])
        .executeTakeFirstOrThrow(),

      db.selectFrom('appointments')
        .where('residence_id', '=', residenceId).where('resident_id', '=', resident.id)
        .where('status', '=', 'prevu')
        .where('starts_at', '>=', p.cur_from).where('starts_at', '<', p.cur_to)
        .select(sql<number>`count(*)::int`.as('n'))
        .executeTakeFirstOrThrow(),
    ]);

    const timeline = buckets.rows.map(({ bucket }) => {
      const rows = timelineRows.filter((r) => r.bucket === bucket);
      return {
        bucket,
        total: rows.reduce((sum, r) => sum + r.n, 0),
        byCategory: Object.fromEntries(rows.map((r) => [r.category_id, r.n])),
      };
    });

    await audit(db, {
      action: 'view_stats', entity: 'resident', entityId: resident.id, userId: request.user.sub, residenceId,
      details: { period: unit, start: p.start_date }, ip: request.ip,
    });

    return {
      resident: { id: resident.id, firstName: resident.first_name, lastName: resident.last_name },
      period: { unit, start: p.start_date, end: p.end_date, previousStart: p.prev_date },
      totals: {
        notes: totals.notes, positive: totals.positive, priority: totals.priority,
        previousNotes: totals.previous_notes, previousPositive: totals.previous_positive, previousPriority: totals.previous_priority,
      },
      categories: categories.map((c) => ({ id: c.id, label: c.label, count: c.count, previousCount: c.previous_count })),
      timeline,
      timeOfDay: SLOTS.map((slot) => ({ slot, count: slots.find((s) => s.slot === slot)?.count ?? 0 })),
      followUps: { opened: followUps.opened, closed: followUps.closed, openNow: followUps.open_now },
      appointments: appointments.n,
    };
  });
};

export default statsRoutes;
