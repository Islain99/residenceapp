import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import { mailerFromConfig, type Mailer } from './lib/mailer.js';
import { Notifier, webPushSender, type PushSender } from './lib/notifier.js';
import agendaRoutes from './routes/agenda.js';
import assistanceRoutes from './routes/assistance.js';
import auditRoutes from './routes/audit.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import followUpRoutes from './routes/follow-ups.js';
import handoverRoutes from './routes/handover.js';
import healthRoutes from './routes/health.js';
import messageRoutes from './routes/messages.js';
import noteRoutes from './routes/notes.js';
import passwordRoutes from './routes/password.js';
import profileRoutes from './routes/profile.js';
import platformRoutes from './routes/platform.js';
import pushRoutes from './routes/push.js';
import residentRoutes from './routes/residents.js';
import scheduleRoutes from './routes/schedule.js';
import staffRoutes from './routes/staff.js';
import statsRoutes from './routes/stats.js';
import userRoutes from './routes/users.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    config: Config;
    mailer: Mailer;
    notifier: Notifier;
  }
}

export async function buildApp(
  config: Config,
  db: Database,
  mailer: Mailer = mailerFromConfig(config),
  pushSender: PushSender | null = webPushSender(config),
) {
  const app = Fastify({
    // Les N proxys les plus proches sont de confiance (même règle que « trust proxy = N »)
    trustProxy: config.TRUST_PROXY > 0 ? (_address: string, hop: number) => hop < config.TRUST_PROXY : false,
    logger: config.NODE_ENV === 'test' ? false : {
      level: 'info',
      redact: ['req.headers.authorization'],
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('db', db);
  app.decorate('config', config);
  // Échec d'envoi : la route répond 502 ; la cause (fournisseur, clé, adresse) va au journal du serveur
  app.decorate('mailer', {
    async send(mail) {
      try {
        await mailer.send(mail);
      } catch (err) {
        app.log.error({ err, to: mail.to.replace(/^(.).*@/, '$1…@') }, 'envoi de courriel');
        throw err;
      }
    },
  } satisfies Mailer);
  app.decorate('notifier', new Notifier(db, pushSender, app.log));

  // Rappels d'échéance des suivis (pas pendant les tests : ils l'appellent eux-mêmes)
  let reminders: NodeJS.Timeout | undefined;
  if (pushSender && config.PUSH_REMINDER_INTERVAL_SECONDS > 0 && config.NODE_ENV !== 'test') {
    app.addHook('onReady', async () => {
      reminders = setInterval(() => {
        app.notifier.sendDueReminders().catch((err: unknown) => app.log.error({ err }, 'rappels de suivis'));
      }, config.PUSH_REMINDER_INTERVAL_SECONDS * 1000);
      reminders.unref();
    });
  }
  app.addHook('onClose', async () => {
    clearInterval(reminders);
    await app.notifier.flush();
    await db.destroy();
  });

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

  // Accès d'assistance (admin plateforme) : lecture seule. Refusé dès la
  // réception, avant même la validation du corps (auth.ts revérifie l'accès).
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    let payload: { asst?: string } | null = null;
    try {
      payload = app.jwt.verify<{ asst?: string }>(header.slice(7));
    } catch {
      return;   // jeton invalide : la route répondra 401
    }
    if (payload.asst) {
      return reply.code(403).send({ error: 'assistance_read_only', message: 'Accès d’assistance : consultation seulement.' });
    }
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(categoryRoutes);
  await app.register(noteRoutes);
  await app.register(followUpRoutes);
  await app.register(residentRoutes);
  await app.register(handoverRoutes);
  await app.register(staffRoutes);
  await app.register(messageRoutes);
  await app.register(userRoutes);
  await app.register(passwordRoutes);
  await app.register(profileRoutes);
  await app.register(auditRoutes);
  await app.register(agendaRoutes);
  await app.register(scheduleRoutes);
  await app.register(statsRoutes);
  await app.register(assistanceRoutes);
  await app.register(platformRoutes);
  await app.register(pushRoutes);

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
