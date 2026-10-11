// Règles de sécurité et d'accès ajoutées après la revue de la V1 :
// consigne prioritaire réservée, blocage par compte, appareil partagé,
// durée de session, désactivation et changement de rôle immédiats.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { bearer, buildTestApp, loginAs, PASSWORD, seedIds } from './helpers.js';

let app: App;
let ids: Awaited<ReturnType<typeof seedIds>>;

beforeAll(async () => {
  app = await buildTestApp({ LOGIN_MAX_ATTEMPTS: 3, LOGIN_LOCK_MINUTES: 15 });
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

const login = (email: string, password = PASSWORD, extra: object = {}) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { email, password, ...extra } });

const newNote = (token: string, extra: object = {}) => app.inject({
  method: 'POST', url: '/notes', headers: bearer(token),
  payload: {
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    categoryId: ids.categoryId, residentId: ids.residentId,
    description: '[test] Règle de consigne prioritaire.', ...extra,
  },
});

const unlock = (email: string) => app.db.updateTable('users')
  .set({ failed_login_count: 0, locked_until: null }).where('email', '=', email).execute();

describe('consigne prioritaire', () => {
  it('un préposé ne peut pas créer de consigne prioritaire', async () => {
    const res = await newNote(await loginAs(app, 'prepose1@exemple.test'), { isPriority: true });
    expect(res.statusCode).toBe(403);
  });

  it('un préposé peut corriger sa note, mais pas la rendre prioritaire', async () => {
    const token = await loginAs(app, 'prepose1@exemple.test');
    const note = (await newNote(token)).json();
    const patch = (payload: object) =>
      app.inject({ method: 'PATCH', url: `/notes/${note.id}`, headers: bearer(token), payload });
    expect((await patch({ isPriority: true })).statusCode).toBe(403);
    // Valeur inchangée renvoyée par le formulaire : acceptée
    expect((await patch({ description: '[test] Corrigée.', isPriority: false })).statusCode).toBe(200);
  });

  it('infirmière et responsable peuvent marquer et retirer une consigne', async () => {
    for (const who of ['infirmiere', 'responsable']) {
      const token = await loginAs(app, `${who}@exemple.test`);
      const note = (await newNote(token, { isPriority: true })).json();
      expect(note.isPriority).toBe(true);
      const off = await app.inject({
        method: 'PATCH', url: `/notes/${note.id}`, headers: bearer(token), payload: { isPriority: false },
      });
      expect(off.json().isPriority).toBe(false);
    }
  });
});

describe('blocage par compte', () => {
  const email = 'prepose3@exemple.test';

  it('bloque après LOGIN_MAX_ATTEMPTS mauvais mots de passe, même avec le bon ensuite', async () => {
    await unlock(email);
    expect((await login(email, 'mauvais-1')).statusCode).toBe(401);
    expect((await login(email, 'mauvais-2')).statusCode).toBe(401);
    const third = await login(email, 'mauvais-3');
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toBe('account_locked');

    const good = await login(email);
    expect(good.statusCode).toBe(429);
    expect(good.json().error).toBe('account_locked');

    const audit = await app.db.selectFrom('audit_log').select('details')
      .where('action', '=', 'login_failed').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(audit.details).toMatchObject({ email, reason: 'locked' });
  });

  it('le blocage expire', async () => {
    await app.db.updateTable('users').set({ locked_until: new Date(Date.now() - 1000) })
      .where('email', '=', email).execute();
    expect((await login(email)).statusCode).toBe(200);
  });

  it('une connexion réussie remet le compteur à zéro', async () => {
    await unlock(email);
    await login(email, 'mauvais-1');
    await login(email, 'mauvais-2');
    expect((await login(email)).statusCode).toBe(200);
    await login(email, 'mauvais-3');
    await login(email, 'mauvais-4');
    expect((await login(email)).statusCode).toBe(200);   // pas bloqué : le compteur était revenu à 0
  });

  it('un courriel inconnu ne bloque rien et répond toujours 401', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await login('personne@exemple.test', 'x')).statusCode).toBe(401);
    }
  });
});

describe('session', () => {
  const cookieOf = (res: Awaited<ReturnType<typeof login>>) => {
    const header = res.headers['set-cookie'];
    return (Array.isArray(header) ? header : [header ?? '']).find((c) => c.startsWith('refresh_token='))!;
  };

  it('session normale : cookie de 12 h', async () => {
    const res = await login('prepose2@exemple.test', PASSWORD, { session: 'cookie' });
    expect(res.json().sharedDevice).toBe(false);
    expect(cookieOf(res)).toContain(`Max-Age=${12 * 60 * 60}`);
  });

  it('appareil partagé : cookie de session, aussi après rafraîchissement', async () => {
    const res = await login('prepose2@exemple.test', PASSWORD, { session: 'cookie', sharedDevice: true });
    expect(res.json().sharedDevice).toBe(true);
    const cookie = cookieOf(res);
    expect(cookie).not.toContain('Max-Age');
    expect(cookie).not.toContain('Expires');

    const value = cookie.split(';')[0]!;
    const refreshed = await app.inject({
      method: 'POST', url: '/auth/refresh', payload: {}, headers: { cookie: value },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().sharedDevice).toBe(true);
    expect(cookieOf(refreshed)).not.toContain('Max-Age');
  });

  it('le jeton de rafraîchissement expire après 12 h', async () => {
    const { refreshToken } = (await login('prepose2@exemple.test')).json();
    const row = await app.db.selectFrom('refresh_tokens').select(['created_at', 'expires_at'])
      .orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    const hours = (row.expires_at.getTime() - row.created_at.getTime()) / 3_600_000;
    expect(hours).toBeCloseTo(12, 1);
    expect(refreshToken).toBeTypeOf('string');
  });
});

describe('effet immédiat des changements de compte', () => {
  it('compte désactivé : le jeton d’accès encore valide est refusé tout de suite', async () => {
    const token = await loginAs(app, 'prepose4@exemple.test');
    expect((await app.inject({ method: 'GET', url: '/notes', headers: bearer(token) })).statusCode).toBe(200);

    await app.db.updateTable('users').set({ is_active: false }).where('email', '=', 'prepose4@exemple.test').execute();
    try {
      const res = await app.inject({ method: 'GET', url: '/notes', headers: bearer(token) });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('inactive_account');
    } finally {
      await app.db.updateTable('users').set({ is_active: true }).where('email', '=', 'prepose4@exemple.test').execute();
    }
  });

  it('changement de rôle : appliqué sans attendre un nouveau jeton', async () => {
    const email = 'prepose4@exemple.test';
    const token = await loginAs(app, email);
    await app.db.updateTable('users').set({ role: 'infirmiere' }).where('email', '=', email).execute();
    try {
      expect((await newNote(token, { isPriority: true })).statusCode).toBe(201);
    } finally {
      await app.db.updateTable('users').set({ role: 'prepose' }).where('email', '=', email).execute();
    }
  });
});
