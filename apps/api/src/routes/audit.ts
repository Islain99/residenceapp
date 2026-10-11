// Journal d'audit de la résidence : qui a fait quoi, et quand.
//
//   GET /audit — responsable seulement. Plus récent d'abord, filtres et
//   pagination par curseur (identifiant de la dernière ligne reçue).
//
// Sert notamment à répondre à la Loi 25 : « qui a consulté ce dossier ? »
// (filtres entity=resident & entityId=<id>). La table est en ajout seul.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { requireRole, residenceOf } from '../auth.js';
import { Nullable, Person, Uuid } from '../lib/schemas.js';

export const AuditEntryBody = Type.Object({
  id: Type.String(),
  at: Type.String(),
  action: Type.String(),
  entity: Type.String(),
  entityId: Nullable(Type.String()),
  user: Nullable(Person),       // qui a agi ; null : pas connecté (ex. connexion refusée)
  target: Nullable(Person),     // compte visé, quand l'élément est un compte (entity = user)
  details: Nullable(Type.Unknown()),
  ip: Nullable(Type.String()),
});

const auditRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;

  app.get('/audit', {
    preHandler: requireRole('responsable'),
    schema: {
      querystring: Type.Object({
        from: Type.Optional(Type.String({ format: 'date-time' })),
        to: Type.Optional(Type.String({ format: 'date-time' })),
        userId: Type.Optional(Uuid),
        action: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
        entity: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
        entityId: Type.Optional(Uuid),
        limit: Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
        cursor: Type.Optional(Type.String({ pattern: '^[0-9]{1,18}$' })),
      }),
      response: {
        200: Type.Object({ items: Type.Array(AuditEntryBody), nextCursor: Nullable(Type.String()) }),
      },
    },
  }, async (request) => {
    const q = request.query;
    let query = db.selectFrom('audit_log as l')
      .leftJoin('users as u', 'u.id', 'l.user_id')
      .leftJoin('users as t', (join) => join.onRef('t.id', '=', 'l.entity_id').on('l.entity', '=', 'user'))
      .select(['l.id', 'l.at', 'l.action', 'l.entity', 'l.entity_id', 'l.details', 'l.ip',
               'u.id as user_id', 'u.first_name', 'u.last_name',
               't.id as target_id', 't.first_name as target_first_name', 't.last_name as target_last_name'])
      .where('l.residence_id', '=', residenceOf(request));
    if (q.from) query = query.where('l.at', '>=', new Date(q.from));
    if (q.to) query = query.where('l.at', '<', new Date(q.to));
    if (q.userId) query = query.where('l.user_id', '=', q.userId);
    if (q.action) query = query.where('l.action', '=', q.action);
    if (q.entity) query = query.where('l.entity', '=', q.entity);
    if (q.entityId) query = query.where('l.entity_id', '=', q.entityId);
    if (q.cursor) query = query.where('l.id', '<', q.cursor);

    const rows = await query.orderBy('l.id', 'desc').limit(q.limit + 1).execute();
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: String(r.id),
        at: r.at.toISOString(),
        action: r.action,
        entity: r.entity,
        entityId: r.entity_id,
        user: r.user_id ? { id: r.user_id, firstName: r.first_name ?? '', lastName: r.last_name ?? '' } : null,
        target: r.target_id
          ? { id: r.target_id, firstName: r.target_first_name ?? '', lastName: r.target_last_name ?? '' }
          : null,
        details: r.details ?? null,
        ip: r.ip,
      })),
      nextCursor: rows.length > q.limit ? String(page.at(-1)!.id) : null,
    };
  });
};

export default auditRoutes;
