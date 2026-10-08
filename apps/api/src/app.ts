import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import { smtpMailer, type Mailer } from './lib/mailer.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import followUpRoutes from './routes/follow-ups.js';
import handoverRoutes from './routes/handover.js';
import healthRoutes from './routes/health.js';
import noteRoutes from './routes/notes.js';
import passwordRoutes from './routes/password.js';
import residentRoutes from './routes/residents.js';
import staffRoutes from './routes/staff.js';
import userRoutes from './routes/users.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    config: Config;
    mailer: Mailer;
  }
}

export async function buildApp(config: Config, db: Database, mailer: Mailer = smtpMailer(config.SMTP_URL, config.MAIL_FROM)) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : {
      level: 'info',
      redact: ['req.headers.authorization'],
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('mailer', mailer);
  app.addHook('onClose', async () => { await db.destroy(); });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { algorithm: 'HS256', expiresIn: `${config.ACCESS_TOKEN_TTL_MINUTES}m` },
    verify: { algorithms: ['HS256'] },
  });
  await app.register(cookie);   // jeton de rafraîchissement du navigateur (routes/auth.ts)
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
  await app.register(followUpRoutes);
  await app.register(residentRoutes);
  await app.register(handoverRoutes);
  await app.register(staffRoutes);
  await app.register(userRoutes);
  await app.register(passwordRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
