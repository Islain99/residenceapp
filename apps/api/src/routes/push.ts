// Notifications push — abonnements de l'appareil et préférences.
//
//   GET   /push/config                         notifications disponibles ? clé publique (VAPID)
//   POST  /push/subscriptions                  abonner cet appareil { endpoint, keys: { p256dh, auth } }
//   POST  /push/subscriptions/unsubscribe      désabonner cet appareil { endpoint } (aussi à la déconnexion)
//   GET   /push/preferences                    ce que je reçois + nombre d'appareils abonnés
//   PATCH /push/preferences                    { messages?, announcements?, priorityNotes?, followUps? }
//   POST  /push/test                           notification d'essai sur mes appareils
//
// Un appareil (endpoint) appartient à une seule personne : s'abonner depuis un
// appareil déjà abonné pour quelqu'un d'autre le lui retire.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { authenticate } from '../auth.js';
import { badRequest, HttpError } from '../lib/errors.js';
import { isAllowedEndpoint } from '../lib/notifier.js';

const Preferences = Type.Object({
  messages: Type.Boolean(),
  announcements: Type.Boolean(),
  priorityNotes: Type.Boolean(),
  followUps: Type.Boolean(),
  devices: Type.Integer(),          // appareils abonnés (actifs)
});

const pushRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, notifier } = app;
  app.addHook('preHandler', authenticate);

  function requireEnabled() {
    if (!notifier.enabled) throw new HttpError(503, 'push_disabled', 'Notifications non configurées sur ce serveur.');
  }

  app.get('/push/config', {
    schema: { response: { 200: Type.Object({ enabled: Type.Boolean(), publicKey: Type.Union([Type.String(), Type.Null()]) }) } },
  }, async () => ({ enabled: notifier.enabled, publicKey: notifier.sender?.publicKey ?? null }));

  app.post('/push/subscriptions', {
    schema: {
      body: Type.Object({
        endpoint: Type.String({ minLength: 10, maxLength: 1000 }),
        keys: Type.Object({
          p256dh: Type.String({ minLength: 10, maxLength: 200 }),
          auth: Type.String({ minLength: 4, maxLength: 100 }),
        }),
      }),
      response: { 201: Type.Object({ ok: Type.Boolean() }) },
    },
  }, async (request, reply) => {
    requireEnabled();
    const { endpoint, keys } = request.body;
    if (!isAllowedEndpoint(endpoint)) throw badRequest('invalid_endpoint', 'Service de notification non reconnu.');
    await db.insertInto('push_subscriptions')
      .values({
        user_id: request.user.sub, endpoint, p256dh: keys.p256dh, auth: keys.auth,
        user_agent: request.headers['user-agent']?.slice(0, 256) ?? null,
      })
      .onConflict((oc) => oc.column('endpoint').doUpdateSet({
        user_id: request.user.sub, p256dh: keys.p256dh, auth: keys.auth, failures: 0,
        disabled_at: null, created_at: sql<Date>`now()`,
      }))
      .execute();
    return reply.code(201).send({ ok: true });
  });

  app.post('/push/subscriptions/unsubscribe', {
    schema: { body: Type.Object({ endpoint: Type.String({ minLength: 10, maxLength: 1000 }) }) },
  }, async (request, reply) => {
    await db.updateTable('push_subscriptions').set({ disabled_at: sql<Date>`now()` })
      .where('endpoint', '=', request.body.endpoint).where('user_id', '=', request.user.sub)
      .where('disabled_at', 'is', null).execute();
    return reply.code(204).send();
  });

  async function preferences(userId: string) {
    const [prefs, devices] = await Promise.all([
      db.selectFrom('notification_preferences').selectAll().where('user_id', '=', userId).executeTakeFirst(),
      db.selectFrom('push_subscriptions').select((c) => c.fn.countAll<string>().as('n'))
        .where('user_id', '=', userId).where('disabled_at', 'is', null).executeTakeFirstOrThrow(),
    ]);
    return {
      messages: prefs?.messages ?? true,
      announcements: prefs?.announcements ?? true,
      priorityNotes: prefs?.priority_notes ?? true,
      followUps: prefs?.follow_ups ?? true,
      devices: Number(devices.n),
    };
  }

  app.get('/push/preferences', { schema: { response: { 200: Preferences } } },
    async (request) => preferences(request.user.sub));

  app.patch('/push/preferences', {
    schema: {
      body: Type.Object({
        messages: Type.Optional(Type.Boolean()),
        announcements: Type.Optional(Type.Boolean()),
        priorityNotes: Type.Optional(Type.Boolean()),
        followUps: Type.Optional(Type.Boolean()),
      }, { minProperties: 1 }),
      response: { 200: Preferences },
    },
  }, async (request) => {
    const b = request.body;
    const changes = {
      ...(b.messages !== undefined ? { messages: b.messages } : {}),
      ...(b.announcements !== undefined ? { announcements: b.announcements } : {}),
      ...(b.priorityNotes !== undefined ? { priority_notes: b.priorityNotes } : {}),
      ...(b.followUps !== undefined ? { follow_ups: b.followUps } : {}),
    };
    await db.insertInto('notification_preferences')
      .values({ user_id: request.user.sub, ...changes })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({ ...changes, updated_at: sql<Date>`now()` }))
      .execute();
    return preferences(request.user.sub);
  });

  app.post('/push/test', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { response: { 200: Type.Object({ sent: Type.Integer() }) } },
  }, async (request) => {
    requireEnabled();
    const sent = await notifier.sendNow(request.user.sub, {
      title: 'Notifications activées', body: 'Vous recevrez ici les avis du journal de bord.', url: '/', tag: 'test',
    });
    return { sent };
  });
};

export default pushRoutes;
