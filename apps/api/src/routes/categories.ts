// Catégories de notes de la résidence.
//
//   GET   /note-categories        tous les rôles : catégories actives, dans l'ordre d'affichage.
//                                 ?all=true (responsable) : aussi les désactivées.
//   POST  /note-categories        responsable : { label, sortOrder? }
//   PATCH /note-categories/:id    responsable : { label?, sortOrder?, isActive? }
//
// Jamais supprimées : des notes y sont rattachées. Une catégorie désactivée
// n'est plus proposée pour les nouvelles notes, mais reste affichée sur les anciennes.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { authenticate, requireRole, residenceOf } from '../auth.js';
import { audit } from '../lib/audit.js';
import { forbidden, HttpError, notFound } from '../lib/errors.js';
import { IdParams, Text } from '../lib/schemas.js';

const CategoryBody = Type.Object({
  id: Type.String(),
  label: Type.String(),
  sortOrder: Type.Integer(),
  isActive: Type.Boolean(),
});

const SortOrder = Type.Integer({ minimum: 0, maximum: 10_000 });

const toCategory = (r: { id: string; label: string; sort_order: number; is_active: boolean }) =>
  ({ id: r.id, label: r.label, sortOrder: r.sort_order, isActive: r.is_active });

const duplicate = () => new HttpError(409, 'duplicate_label', 'Une catégorie porte déjà ce nom.');
const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

function cleanLabel(value: string) {
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label) throw new HttpError(400, 'invalid_label', 'Nom de catégorie obligatoire.');
  return label;
}

const categoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app;
  const columns = ['id', 'label', 'sort_order', 'is_active'] as const;

  app.get('/note-categories', {
    preHandler: authenticate,
    schema: {
      querystring: Type.Object({ all: Type.Boolean({ default: false }) }),
      response: { 200: Type.Array(CategoryBody) },
    },
  }, async (request) => {
    if (request.query.all && request.user.role !== 'responsable') {
      throw forbidden('Seule la responsable voit les catégories désactivées.');
    }
    let query = db.selectFrom('note_categories').select(columns)
      .where('residence_id', '=', residenceOf(request));
    if (!request.query.all) query = query.where('is_active', '=', true);
    const rows = await query.orderBy('sort_order').orderBy('label').execute();
    return rows.map(toCategory);
  });

  app.post('/note-categories', {
    preHandler: requireRole('responsable'),
    schema: {
      body: Type.Object({ label: Text(60), sortOrder: Type.Optional(SortOrder) }),
      response: { 201: CategoryBody },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const label = cleanLabel(request.body.label);
    try {
      const row = await db.transaction().execute(async (trx) => {
        // Par défaut : à la fin de la liste
        const sortOrder = request.body.sortOrder ?? (await trx.selectFrom('note_categories')
          .select((eb) => eb.fn.coalesce(eb.fn.max('sort_order'), eb.val(0)).as('max'))
          .where('residence_id', '=', residenceId).executeTakeFirstOrThrow()).max + 10;
        const row = await trx.insertInto('note_categories')
          .values({ residence_id: residenceId, label, sort_order: sortOrder })
          .returning(columns).executeTakeFirstOrThrow();
        await audit(trx, {
          action: 'create', entity: 'note_category', entityId: row.id, userId: request.user.sub,
          residenceId, details: { label }, ip: request.ip,
        });
        return row;
      });
      return reply.code(201).send(toCategory(row));
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate();
      throw err;
    }
  });

  app.patch('/note-categories/:id', {
    preHandler: requireRole('responsable'),
    schema: {
      params: IdParams,
      body: Type.Object({
        label: Type.Optional(Text(60)),
        sortOrder: Type.Optional(SortOrder),
        isActive: Type.Optional(Type.Boolean()),
      }, { minProperties: 1 }),
      response: { 200: CategoryBody },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const changes = {
      ...(b.label !== undefined ? { label: cleanLabel(b.label) } : {}),
      ...(b.sortOrder !== undefined ? { sort_order: b.sortOrder } : {}),
      ...(b.isActive !== undefined ? { is_active: b.isActive } : {}),
    };
    try {
      return await db.transaction().execute(async (trx) => {
        const row = await trx.updateTable('note_categories').set(changes)
          .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
          .returning(columns).executeTakeFirst();
        if (!row) throw notFound('Catégorie introuvable.');
        const action = b.isActive === false ? 'deactivate' : b.isActive === true ? 'reactivate' : 'update';
        await audit(trx, {
          action, entity: 'note_category', entityId: row.id, userId: request.user.sub,
          residenceId, details: { fields: Object.keys(b) }, ip: request.ip,
        });
        return toCategory(row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicate();
      throw err;
    }
  });
};

export default categoryRoutes;
