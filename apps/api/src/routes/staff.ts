import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { authenticate, residenceOf } from '../auth.js';

// Employés actifs de la résidence (assignation des suivis). Ni courriel ni
// date de connexion : seulement ce qu'il faut pour choisir quelqu'un.
const staffRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/staff', {
    preHandler: authenticate,
    schema: {
      response: {
        200: Type.Array(Type.Object({
          id: Type.String(), firstName: Type.String(), lastName: Type.String(), role: Type.String(),
        })),
      },
    },
  }, async (request) => {
    const rows = await app.db.selectFrom('users')
      .select(['id', 'first_name', 'last_name', 'role'])
      .where('residence_id', '=', residenceOf(request))
      .where('is_active', '=', true)
      .orderBy(sql`last_name COLLATE "fr-CA-x-icu"`)
      .orderBy(sql`first_name COLLATE "fr-CA-x-icu"`)
      .execute();
    return rows.map((u) => ({ id: u.id, firstName: u.first_name, lastName: u.last_name, role: u.role }));
  });
};

export default staffRoutes;
