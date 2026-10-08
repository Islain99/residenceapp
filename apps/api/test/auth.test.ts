import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { requireRole } from '../src/auth.js';
import { buildTestApp, PASSWORD } from './helpers.js';

let app: App;

beforeAll(async () => {
  app = await buildTestApp();

  // Routes de test pour le contrôle des rôles
  app.get('/test/responsable', { preHandler: requireRole('responsable', 'admin') }, async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => { await app.close(); });

const login = (email: string, password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
const refresh = (refreshToken: string) =>
  app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });

describe('santé', () => {
  it('GET /health : API et base OK', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });
});

describe('connexion', () => {
  it('renvoie les jetons et le profil', async () => {
    const res = await login('responsable@exemple.test');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');
    expect(body.expiresIn).toBe(15 * 60);
    expect(body.user).toMatchObject({ email: 'responsable@exemple.test', role: 'responsable', firstName: 'Sophie' });
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('courriel insensible à la casse et aux espaces', async () => {
    expect((await login('  Responsable@Exemple.TEST ')).statusCode).toBe(200);
  });

  it('même réponse pour un mauvais mot de passe et un courriel inconnu', async () => {
    const bad = await login('responsable@exemple.test', 'mauvais');
    const unknown = await login('personne@exemple.test');
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json()).toEqual(unknown.json());
  });

  it('échec enregistré dans le journal d’audit', async () => {
    await login('prepose2@exemple.test', 'mauvais');
    const row = await app.db.selectFrom('audit_log').select(['action', 'details'])
      .where('action', '=', 'login_failed').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(row.details).toMatchObject({ email: 'prepose2@exemple.test', reason: 'bad_password' });
  });

  it('compte désactivé refusé', async () => {
    const where = ['email', '=', 'prepose4@exemple.test'] as const;
    await app.db.updateTable('users').set({ is_active: false }).where(...where).execute();
    try {
      expect((await login('prepose4@exemple.test')).statusCode).toBe(401);
    } finally {
      await app.db.updateTable('users').set({ is_active: true }).where(...where).execute();
    }
  });

  it('trop de tentatives → 429', async () => {
    const limited = await buildTestApp({ LOGIN_RATE_LIMIT_MAX: 2 });
    try {
      const attempt = () => limited.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x@exemple.test', password: 'y' } });
      await attempt();
      await attempt();
      const res = await attempt();
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('too_many_requests');
    } finally {
      await limited.close();
    }
  });

  it('corps invalide → 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
  });
});

describe('jeton d’accès et rôles', () => {
  it('/auth/me exige un jeton valide', async () => {
    const none = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(none.statusCode).toBe(401);
    expect(none.json()).toEqual({ error: 'unauthorized', message: 'Connexion requise.' });
    const bad = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Bearer abc.def.ghi' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('unauthorized');

    const expired = app.jwt.sign({ sub: crypto.randomUUID(), rid: null, role: 'prepose' }, { expiresIn: -10 });
    const res401 = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${expired}` } });
    expect(res401.statusCode).toBe(401);
    expect(res401.json().error).toBe('token_expired');

    const { accessToken } = (await login('infirmiere@exemple.test')).json();
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: 'infirmiere@exemple.test', role: 'infirmiere' });
  });

  it('requireRole : 403 pour un préposé, 200 pour une responsable', async () => {
    const prepose = (await login('prepose1@exemple.test')).json().accessToken;
    const responsable = (await login('responsable@exemple.test')).json().accessToken;
    const call = (t: string) => app.inject({ method: 'GET', url: '/test/responsable', headers: { authorization: `Bearer ${t}` } });
    expect((await call(prepose)).statusCode).toBe(403);
    expect((await call(responsable)).statusCode).toBe(200);
  });
});

describe('rafraîchissement et déconnexion', () => {
  it('rotation : nouveau jeton à chaque rafraîchissement', async () => {
    const first = (await login('prepose3@exemple.test')).json().refreshToken;
    const res = await refresh(first);
    expect(res.statusCode).toBe(200);
    expect(res.json().refreshToken).not.toBe(first);
    expect(res.json().accessToken).toBeTypeOf('string');
  });

  it('réutilisation d’un ancien jeton : toutes les sessions sont révoquées', async () => {
    const stolen = (await login('prepose3@exemple.test')).json().refreshToken;
    const current = (await refresh(stolen)).json().refreshToken;

    expect((await refresh(stolen)).statusCode).toBe(401);   // réutilisation détectée
    expect((await refresh(current)).statusCode).toBe(401);  // session légitime coupée aussi
  });

  it('jeton inconnu → 401', async () => {
    expect((await refresh('inconnu')).statusCode).toBe(401);
  });

  it('déconnexion : le jeton ne fonctionne plus', async () => {
    const token = (await login('prepose1@exemple.test')).json().refreshToken;
    const out = await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken: token } });
    expect(out.statusCode).toBe(204);
    expect((await refresh(token)).statusCode).toBe(401);
  });
});
