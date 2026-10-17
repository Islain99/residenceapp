import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { hashPassword } from '../src/lib/passwords.js';
import { bearer, buildTestApp, caller, loginAll, loginAs, outbox, PASSWORD, passwordLogin } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;

beforeAll(async () => {
  app = await buildTestApp();
  call = caller(app, await loginAll(app, ['prepose3', 'responsable']));
});

afterAll(async () => { await app.close(); });

describe('coordonnées', () => {
  it('chacun modifie son nom, son téléphone et sa couleur ; renvoyés par /auth/me et à la connexion', async () => {
    const res = await call('prepose3', 'PATCH', '/auth/me', { phone: ' 514 555-0199 ', avatarColor: 'violet', firstName: ' Julie ' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ firstName: 'Julie', phone: '514 555-0199', avatarColor: 'violet', email: 'prepose3@exemple.test' });
    expect((await call('prepose3', 'GET', '/auth/me')).json()).toMatchObject({ phone: '514 555-0199', avatarColor: 'violet' });
    const login = await passwordLogin(app, 'prepose3@exemple.test', PASSWORD);
    expect(login.json().user).toMatchObject({ phone: '514 555-0199', avatarColor: 'violet' });
    const audited = await app.db.selectFrom('audit_log').select(['action', 'details'])
      .where('action', '=', 'profile_update').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(audited.details).toEqual({ fields: ['phone', 'avatarColor', 'firstName'] });
  });

  it('la responsable voit le téléphone dans l’équipe', async () => {
    const team = (await call('responsable', 'GET', '/users')).json() as { email: string; phone: string | null }[];
    expect(team.find((u) => u.email === 'prepose3@exemple.test')?.phone).toBe('514 555-0199');
  });

  it('téléphone retiré avec une chaîne vide ; couleur par défaut avec null', async () => {
    const res = await call('prepose3', 'PATCH', '/auth/me', { phone: '', avatarColor: null });
    expect(res.json()).toMatchObject({ phone: null, avatarColor: null });
  });

  it('refuse un téléphone invalide, un nom vide, une couleur inconnue, le courriel ou le rôle', async () => {
    const errors = await Promise.all([
      call('prepose3', 'PATCH', '/auth/me', { phone: 'appelez-moi' }),
      call('prepose3', 'PATCH', '/auth/me', { lastName: '   ' }),
      call('prepose3', 'PATCH', '/auth/me', { avatarColor: 'fuchsia' }),
      call('prepose3', 'PATCH', '/auth/me', { role: 'responsable' }),
    ]);
    expect(errors.map((r) => r.statusCode)).toEqual([400, 400, 400, 400]);
    expect(errors.slice(0, 2).map((r) => r.json().error)).toEqual(['invalid_phone', 'invalid_name']);
    expect((await call('prepose3', 'GET', '/auth/me')).json().role).toBe('prepose');
  });
});

describe('mot de passe', () => {
  // Compte jetable : le mot de passe des comptes fictifs ne change pas pour les autres tests
  async function freshAccount() {
    const email = `profil.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@exemple.test`;
    await app.db.insertInto('users').values({
      residence_id: '00000000-0000-4000-8000-000000000001', email, password_hash: await hashPassword(PASSWORD),
      first_name: 'Essai', last_name: 'Profil', role: 'prepose',
    }).execute();
    return email;
  }

  it('change avec le bon mot de passe actuel ; les autres sessions sont fermées, celle-ci gardée ; avis par courriel', async () => {
    const email = await freshAccount();
    const other = (await passwordLogin(app, email, PASSWORD)).json();          // autre appareil
    const here = (await passwordLogin(app, email, PASSWORD)).json();
    const res = await app.inject({
      method: 'POST', url: '/auth/password/change', headers: bearer(here.accessToken),
      payload: { currentPassword: PASSWORD, newPassword: 'Nouveau-mot-de-passe-2026', refreshToken: here.refreshToken },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().otherSessionsClosed).toBe(1);

    const refresh = (token: string) => app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: token } });
    expect((await refresh(other.refreshToken)).statusCode).toBe(401);
    expect((await refresh(here.refreshToken)).statusCode).toBe(200);
    expect((await passwordLogin(app, email, PASSWORD)).statusCode).toBe(401);
    expect((await passwordLogin(app, email, 'Nouveau-mot-de-passe-2026')).statusCode).toBe(200);
    expect(outbox(app).at(-1)).toMatchObject({ to: email, subject: 'Votre mot de passe a été changé' });
  });

  it('mauvais mot de passe actuel : refusé, et compte bloqué après 5 essais', async () => {
    const email = await freshAccount();
    const token = await loginAs(app, email);
    const attempt = () => app.inject({
      method: 'POST', url: '/auth/password/change', headers: bearer(token),
      payload: { currentPassword: 'pas-le-bon-mot-de-passe', newPassword: 'Nouveau-mot-de-passe-2026' },
    });
    expect((await attempt()).json().error).toBe('invalid_current_password');
    for (let i = 0; i < 3; i++) await attempt();
    expect((await attempt()).json().error).toBe('account_locked');
    expect((await passwordLogin(app, email, PASSWORD)).json().error).toBe('account_locked');
  });

  it('refuse un mot de passe trop court, identique à l’actuel, ou égal au courriel', async () => {
    const email = await freshAccount();
    const token = await loginAs(app, email);
    const change = (newPassword: string) => app.inject({
      method: 'POST', url: '/auth/password/change', headers: bearer(token), payload: { currentPassword: PASSWORD, newPassword },
    });
    expect((await change('court')).statusCode).toBe(400);
    expect((await change(PASSWORD)).json().error).toBe('same_password');
    expect((await change(email)).json().error).toBe('weak_password');
  });
});
