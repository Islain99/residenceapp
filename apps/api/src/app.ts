import Fastify, { type FastifyError } from 'fastify';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import healthRoutes from './routes/health.js';
import noteRoutes from './routes/notes.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    config: Config;
  }
}

export async function buildApp(config: Config, db: Database) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : {
      level: 'info',
      redact: ['req.headers.authorization'],
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('db', db);
  app.decorate('config', config);
  app.addHook('onClose', async () => { await db.destroy(); });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { algorithm: 'HS256', expiresIn: `${config.ACCESS_TOKEN_TTL_MINUTES}m` },
    verify: { algorithms: ['HS256'] },
  });
  // Pas de limite globale : seulement sur les routes qui la déclarent (login)
  await app.register(rateLimit, { global: false });

  // Erreurs serveur : détail dans les logs, jamais dans la réponse
  // (pas de message SQL ni de nom de table envoyé au client).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'erreur interne');
      return reply.code(500).send({ error: 'internal_error', message: 'Erreur interne.' });
    }
    if (error.validation) {
      return reply.code(400).send({ error: 'validation', message: error.message });
    }
    // Erreurs du module JWT (FST_JWT_*) : réponse uniforme, en français.
    // « token_expired » indique au client de passer par /auth/refresh.
    if (error.code?.startsWith('FST_JWT_')) {
      return error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED'
        ? reply.code(401).send({ error: 'token_expired', message: 'Session expirée : renouveler le jeton.' })
        : reply.code(401).send({ error: 'unauthorized', message: 'Connexion requise.' });
    }
    if (status === 429) {
      return reply.code(429).send({ error: 'too_many_requests', message: 'Trop de tentatives : réessayer dans une minute.' });
    }
    return reply.code(status).send({ error: error.code ?? 'error', message: error.message });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(categoryRoutes);
  await app.register(noteRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
