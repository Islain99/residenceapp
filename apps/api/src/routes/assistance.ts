// Accès d'assistance — côté résidence (responsable seulement).
//
//   GET  /assistance             accès accordés (en cours et passés), avec le
//                                nombre de pages consultées par l'administrateur
//   POST /assistance             accorder un accès : 1, 4, 24 ou 72 heures
//   POST /assistance/:id/revoke  retirer l'accès tout de suite
//
// Un seul accès ouvert à la fois. L'administrateur de la plateforme ne peut
// rien modifier pendant l'accès (lecture seule, messagerie exclue : auth.ts) ;
// chaque page consultée est inscrite au journal d'audit de la résidence.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { requireRole, residenceOf } from '../auth.js';
import { audit } from '../lib/audit.js';
import { HttpError, notFound } from '../lib/errors.js';
import type { Db } from '../lib/note-view.js';
import { IdParams, Nullable, Person } from '../lib/schemas.js';

export const ASSISTANCE_HOURS = [1, 4, 24, 72] as const;

export const AssistanceGrantBody = Type.Object({
  id: Type.String(),
  residenceId: Type.String(),
  status: Type.Union([Type.Literal('active'), Type.Literal('expired'), Type.Literal('revoked')]),
  reason: Nullable(Type.String()),
  grantedAt: Type.String(),
  expiresAt: Type.String(),
  revokedAt: Nullable(Type.String()),
  grantedBy: Person,
  revokedBy: Nullable(Person),
  views: Type.Integer(),          // pages consultées par l'administrateur
});

export function grantQuery(db: Db) {
  return db.selectFrom('assistance_grants as g')
    .innerJoin('users as gb', 'gb.id', 'g.granted_by')
    .leftJoin('users as rb', 'rb.id', 'g.revoked_by')
    .select((eb) => [
      'g.id', 'g.residence_id', 'g.reason', 'g.granted_at', 'g.expires_at', 'g.revoked_at',
      'gb.id as gb_id', 'gb.first_name as gb_first', 'gb.last_name as gb_last',
      'rb.id as rb_id', 'rb.first_name as rb_first', 'rb.last_name as rb_last',
      sql<boolean>`g.revoked_at IS NULL AND g.expires_at > now()`.as('is_active'),
      eb.selectFrom('audit_log as l')
        .where('l.residence_id', '=', eb.ref('g.residence_id'))
        .where('l.action', '=', 'assistance_view')
        .where(sql<boolean>`l.details->>'grant' = g.id::text`)
        .select((l) => l.fn.countAll<string>().as('n')).as('views'),
    ]);
}

type GrantRow = Awaited<ReturnType<ReturnType<typeof grantQuery>['executeTakeFirstOrThrow']>>;

export const toGrant = (r: GrantRow) => ({
  id: r.id,
  residenceId: r.residence_id,
  status: r.revoked_at ? 'revoked' as const : r.is_active ? 'active' as const : 'expired' as const,
  reason: r.reason,
  grantedAt: r.granted_at.toISOString(),
  expiresAt: r.expires_at.toISOString(),
  revokedAt: r.revoked_at?.toISOString() ?? null,
  grantedBy: { id: r.gb_id, firstName: r.gb_first, lastName: r.gb_last },
  revokedBy: r.rb_id ? { id: r.rb_id, firstName: r.rb_first ?? '', lastName: r.rb_last ?? '' } : null,
  views: Number(r.views ?? 0),
});

const assistanceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;
  app.addHook('preHandler', requireRole('responsable'));

  app.get('/assistance', {
    schema: { response: { 200: Type.Array(AssistanceGrantBody) } },
  }, async (request) => {
    const rows = await grantQuery(db).where('g.residence_id', '=', residenceOf(request))
      .orderBy('g.granted_at', 'desc').limit(20).execute();
    return rows.map(toGrant);
  });

  app.post('/assistance', {
    schema: {
      body: Type.Object({
        hours: Type.Union(ASSISTANCE_HOURS.map((h) => Type.Literal(h))),
        reason: Type.Optional(Type.String({ maxLength: 500 })),
      }),
      response: { 201: AssistanceGrantBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const id = await db.transaction().execute(async (trx) => {
      // Verrou de la résidence : deux demandes simultanées n'ouvrent pas deux accès
      await trx.selectFrom('residences').select('id').where('id', '=', residenceId).forUpdate().execute();
      const open = await trx.selectFrom('assistance_grants').select('id')
        .where('residence_id', '=', residenceId).where('revoked_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`).executeTakeFirst();
      if (open) throw new HttpError(409, 'assistance_active', 'Un accès d’assistance est déjà ouvert : le retirer d’abord.');
      const grant = await trx.insertInto('assistance_grants').values({
        residence_id: residenceId,
        granted_by: request.user.sub,
        reason: request.body.reason?.trim() || null,
        expires_at: sql<Date>`now() + make_interval(hours => ${request.body.hours})`,
      }).returning('id').executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'assistance_grant', entity: 'assistance', entityId: grant.id, userId: request.user.sub,
        residenceId, details: { hours: request.body.hours }, ip: request.ip,
      });
      return grant.id;
    });
    const row = await grantQuery(db).where('g.id', '=', id).executeTakeFirstOrThrow();
    return reply.code(201).send(toGrant(row));
  });

  app.post('/assistance/:id/revoke', {
    schema: { params: IdParams, response: { 200: AssistanceGrantBody } },
  }, async (request) => {
    const residenceId = residenceOf(request);
    await db.transaction().execute(async (trx) => {
      const grant = await trx.selectFrom('assistance_grants').select(['id', 'revoked_at', 'expires_at'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate().executeTakeFirst();
      if (!grant) throw notFound('Accès introuvable.');
      if (grant.revoked_at || grant.expires_at <= new Date()) {
        throw new HttpError(409, 'assistance_closed', 'Cet accès est déjà terminé.');
      }
      await trx.updateTable('assistance_grants').set({ revoked_at: sql<Date>`now()`, revoked_by: request.user.sub })
        .where('id', '=', grant.id).execute();
      await audit(trx, {
        action: 'assistance_revoke', entity: 'assistance', entityId: grant.id, userId: request.user.sub,
        residenceId, ip: request.ip,
      });
    });
    return toGrant(await grantQuery(db).where('g.id', '=', request.params.id).executeTakeFirstOrThrow());
  });
};

export default assistanceRoutes;
