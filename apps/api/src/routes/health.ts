import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';

// Sonde de santé : l'API répond ET la base répond.
const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/health', async (request, reply) => {
    try {
      await sql`SELECT 1`.execute(app.db);
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      request.log.error({ err }, 'base de données injoignable');
      return reply.code(503).send({ status: 'degraded', db: 'unreachable' });
    }
  });
};

export default healthRoutes;
