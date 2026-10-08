import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { bearer, buildTestApp, caller, loginAll, outbox, PASSWORD, tokenFromMail } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let counter = 0;

beforeAll(async () => {
  app = await buildTestApp();
  call = caller(app, await loginAll(app, ['responsable', 'infirmiere', 'prepose1']));
});

afterAll(async () => { await app.close(); });

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const login = (email: string, password: string) => post('/auth/login', { email, password });
const lastMail = () => outbox(app).at(-1)!;
const NEW_PASSWORD = 'Un-nouveau-mot-de-passe-2026';

async function invite(extra: object = {}) {
  const email = `employe${++counter}-${Date.now()}@exemple.test`;
  const res = await call('responsable', 'POST', '/users', { email, firstName: 'Léa', lastName: 'Nouvelle', role: 'prepose', ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return { account: res.json(), email, token: tokenFromMail(lastMail().text) };
}

describe('invitation d’un employé', () => {
  it('la responsable invite : compte « invité », courriel avec lien, aucune connexion possible avant activation', async () => {
    const { account, email, token } = await invite();
    expect(account).toMatchObject({ email, role: 'prepose', status: 'invited', isActive: true });
    expect(account.invitationExpiresAt).toBeTypeOf('string');

    const mail = lastMail();
    expect(mail.to).toBe(email);
    expect(mail.subject).toContain('Résidence des Érables');
    expect(mail.text).toContain('Sophie Gagnon vous a créé un accès');
    expect(mail.html).toContain(`mot-de-passe#${token}`);

    expect((await login(email, 'nimporte-quoi-123')).statusCode).toBe(401);
  });

  it('l’employé vérifie le lien, choisit son mot de passe, puis se connecte', async () => {
    const { email, token } = await invite();
    const check = await post('/auth/password/check', { token });
    expect(check.json()).toEqual({ purpose: 'invite', email, firstName: 'Léa' });

    expect((await post('/auth/password/reset', { token, password: NEW_PASSWORD })).statusCode).toBe(204);
    const res = await login(email, NEW_PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('prepose');

    // Le lien ne sert qu'une fois
    expect((await post('/auth/password/reset', { token, password: 'Encore-un-autre-2026' })).json().error).toBe('invalid_token');
    const list = (await call('responsable', 'GET', '/users')).json();
    expect(list.find((u: { email: string }) => u.email === email).status).toBe('active');
  });

  it('mot de passe trop court ou égal au courriel : refusé', async () => {
    const { email, token } = await invite();
    expect((await post('/auth/password/reset', { token, password: 'court' })).statusCode).toBe(400);
    expect((await post('/auth/password/reset', { token, password: email })).json().error).toBe('weak_password');
  });

  it('renvoyer l’invitation : l’ancien lien ne vaut plus rien', async () => {
    const { account, token: first } = await invite();
    const res = await call('responsable', 'POST', `/users/${account.id}/invite`);
    expect(res.statusCode).toBe(200);
    const second = tokenFromMail(lastMail().text);
    expect(second).not.toBe(first);
    expect((await post('/auth/password/check', { token: first })).statusCode).toBe(400);
    expect((await post('/auth/password/check', { token: second })).statusCode).toBe(200);
  });

  it('courriel déjà utilisé : 409', async () => {
    const res = await call('responsable', 'POST', '/users',
      { email: 'Prepose1@Exemple.test', firstName: 'X', lastName: 'Y', role: 'prepose' });
    expect(res.statusCode).toBe(409);
  });

  it('réservé à la responsable', async () => {
    const body = { email: 'x@exemple.test', firstName: 'X', lastName: 'Y', role: 'prepose' };
    expect((await call('infirmiere', 'POST', '/users', body)).statusCode).toBe(403);
    expect((await call('prepose1', 'GET', '/users')).statusCode).toBe(403);
  });

  it('pas d’invitation pour un rôle admin', async () => {
    const res = await call('responsable', 'POST', '/users', { email: 'a@exemple.test', firstName: 'A', lastName: 'B', role: 'admin' });
    expect(res.statusCode).toBe(400);
  });
});

describe('gestion des comptes', () => {
  it('désactiver : connexion refusée et sessions fermées ; réactiver : à nouveau possible', async () => {
    const { account, email, token } = await invite();
    await post('/auth/password/reset', { token, password: NEW_PASSWORD });
    const session = (await login(email, NEW_PASSWORD)).json();

    const off = await call('responsable', 'PATCH', `/users/${account.id}`, { isActive: false });
    expect(off.json().status).toBe('inactive');
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: session.refreshToken })).statusCode).toBe(401);

    await call('responsable', 'PATCH', `/users/${account.id}`, { isActive: true });
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('changer le rôle ; la responsable ne peut pas changer le sien ni se désactiver', async () => {
    const { account } = await invite();
    const res = await call('responsable', 'PATCH', `/users/${account.id}`, { role: 'infirmiere' });
    expect(res.json().role).toBe('infirmiere');

    const me = (await call('responsable', 'GET', '/users')).json().find((u: { email: string }) => u.email === 'responsable@exemple.test');
    expect((await call('responsable', 'PATCH', `/users/${me.id}`, { isActive: false })).json().error).toBe('cannot_modify_self');
    expect((await call('responsable', 'PATCH', `/users/${me.id}`, { role: 'prepose' })).json().error).toBe('cannot_modify_self');
  });

  it('audit : création, invitation, activation, désactivation', async () => {
    const { account } = await invite();
    await call('responsable', 'POST', `/users/${account.id}/invite`);
    await post('/auth/password/reset', { token: tokenFromMail(lastMail().text), password: NEW_PASSWORD });
    await call('responsable', 'PATCH', `/users/${account.id}`, { isActive: false });
    const actions = await app.db.selectFrom('audit_log').select('action')
      .where('entity', '=', 'user').where('entity_id', '=', account.id).orderBy('id').execute();
    expect(actions.map((a) => a.action)).toEqual(['create', 'invite', 'account_activated', 'deactivate']);
  });
});

describe('mot de passe oublié', () => {
  it('courriel connu : lien reçu ; nouveau mot de passe ; anciennes sessions fermées', async () => {
    const { email, token } = await invite();
    await post('/auth/password/reset', { token, password: NEW_PASSWORD });
    const oldSession = (await login(email, NEW_PASSWORD)).json();

    const before = outbox(app).length;
    expect((await post('/auth/password/forgot', { email: email.toUpperCase() })).statusCode).toBe(204);
    expect(outbox(app)).toHaveLength(before + 1);
    expect(lastMail().subject).toContain('Réinitialiser');
    const reset = tokenFromMail(lastMail().text);
    expect((await post('/auth/password/check', { token: reset })).json().purpose).toBe('reset');

    expect((await post('/auth/password/reset', { token: reset, password: 'Tout-nouveau-2026!' })).statusCode).toBe(204);
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await login(email, 'Tout-nouveau-2026!')).statusCode).toBe(200);
    expect((await post('/auth/refresh', { refreshToken: oldSession.refreshToken })).statusCode).toBe(401);
  });

  it('courriel inconnu : même réponse, aucun courriel envoyé', async () => {
    const before = outbox(app).length;
    expect((await post('/auth/password/forgot', { email: 'personne@exemple.test' })).statusCode).toBe(204);
    expect(outbox(app)).toHaveLength(before);
  });

  it('lien expiré : refusé', async () => {
    const { account, token } = await invite();
    await app.db.updateTable('account_tokens').set({ expires_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', account.id).execute();
    expect((await post('/auth/password/check', { token })).json().error).toBe('invalid_token');
  });

  it('compte de démonstration : toujours utilisable', async () => {
    expect((await login('prepose1@exemple.test', PASSWORD)).statusCode).toBe(200);
  });
});

describe('autre résidence', () => {
  it('la responsable ne voit que les comptes de sa résidence', async () => {
    const list = (await app.inject({ method: 'GET', url: '/users', headers: bearer(
      (await login('responsable@exemple.test', PASSWORD)).json().accessToken) })).json();
    expect(list.some((u: { email: string }) => u.email === 'prepose-b@exemple.test')).toBe(false);
    expect(list.some((u: { email: string }) => u.email === 'admin@exemple.test')).toBe(false);
  });
});
