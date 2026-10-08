import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { authenticate, residenceOf } from '../auth.js';

// Catégories de notes actives de la résidence, dans l'ordre d'affichage.
const categoryRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/note-categories', {
    preHandler: authenticate,
    schema: {
      response: { 200: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })) },
    },
  }, async (request) => {
    return app.db.selectFrom('note_categories')
      .select(['id', 'label'])
      .where('residence_id', '=', residenceOf(request))
      .where('is_active', '=', true)
      .orderBy('sort_order').orderBy('label')
      .execute();
  });
};

export default categoryRoutes;
