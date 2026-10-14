import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { currentStep, totp } from '../src/lib/mfa.js';
import {
  bearer, buildTestApp, caller, currentCode, loginAll, outbox, PASSWORD, passwordLogin, RESIDENCE_A,
  TEST_MFA_SECRET, tokenFromMail,
} from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;

beforeAll(async () => {
  app = await buildTestApp();
  call = caller(app, await loginAll(app, ['admin', 'responsable']));
});

afterAll(async () => { await app.close(); });

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const login = (email: string, password = PASSWORD) => post('/auth/login', { email, password });
const verify = (mfaToken: string, code: string) => post('/auth/mfa/verify', { mfaToken, code });

async function challenge(email: string) {
  const res = await login(email);
  expect(res.statusCode).toBe(200);
  return res.json() as { mfa: 'required' | 'setup'; mfaToken: string };
}

describe('connexion en deux étapes', () => {
  it('préposé : pas de deuxième étape', async () => {
    const body = (await login('prepose1@exemple.test')).json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body).not.toHaveProperty('mfa');
  });

  it('responsable : le mot de passe seul ne donne aucun accès', async () => {
    const c = await challenge('responsable@exemple.test');
    expect(c.mfa).toBe('required');
    expect(c).not.toHaveProperty('accessToken');
    // Le jeton de l'étape 2 n'ouvre aucune route
    expect((await app.inject({ method: 'GET', url: '/users', headers: bearer(c.mfaToken) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: bearer(c.mfaToken) })).statusCode).toBe(401);
  });

  it('bon code : session ; mauvais code : refusé et inscrit au journal ; un code ne sert qu’une fois', async () => {
    const c = await challenge('responsable@exemple.test');
    const bad = await verify(c.mfaToken, '000000');
    expect(bad.json().error).toBe('invalid_mfa_code');
    const log = await app.db.selectFrom('audit_log').select('details').where('action', '=', 'login_failed')
      .orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(log.details).toMatchObject({ reason: 'bad_mfa_code' });

    const code = await currentCode(app, 'responsable@exemple.test');
    const ok = await verify(c.mfaToken, code);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ user: { role: 'responsable' } });
    expect(ok.json().accessToken).toBeTypeOf('string');

    const again = await challenge('responsable@exemple.test');
    expect((await verify(again.mfaToken, code)).json().error).toBe('invalid_mfa_code');   // rejeu
  });

  it('trop de mauvais codes : compte bloqué', async () => {
    const c = await challenge('responsable2@exemple.test');
    let last;
    for (let i = 0; i < 5; i++) last = await verify(c.mfaToken, '123456');
    expect(last!.statusCode).toBe(429);
    expect((await login('responsable2@exemple.test')).statusCode).toBe(429);
    await app.db.updateTable('users').set({ locked_until: null, failed_login_count: 0 })
      .where('email', '=', 'responsable2@exemple.test').execute();
  });

  it('le secret est chiffré en base', async () => {
    const row = await app.db.selectFrom('users').select('mfa_secret').where('email', '=', 'responsable@exemple.test').executeTakeFirstOrThrow();
    expect(row.mfa_secret).toMatch(/^v1\./);
    expect(row.mfa_secret).not.toContain(TEST_MFA_SECRET);
  });
});

describe('première configuration et codes de secours', () => {
  let email: string;
  let secret: string;

  it('nouvelle responsable : code QR, confirmation, 10 codes de secours, puis code demandé', async () => {
    email = `mfa-${Date.now()}@exemple.test`;
    const res = await call('admin', 'POST', '/platform/residences', {
      name: 'Résidence MFA', type: 'RPA', responsable: { email, firstName: 'Mia', lastName: 'Code' },
    });
    expect(res.statusCode).toBe(201);
    const token = tokenFromMail(outbox(app).at(-1)!.text);
    await post('/auth/password/reset', { token, password: PASSWORD });

    const c = await challenge(email);
    expect(c.mfa).toBe('setup');
    expect((await verify(c.mfaToken, '123456')).json().error).toBe('mfa_not_enabled');

    const setup = (await post('/auth/mfa/setup', { mfaToken: c.mfaToken })).json();
    secret = setup.secret;
    expect(setup.qrSvg).toMatch(/^<svg/);
    expect(setup.otpauthUrl).toContain('otpauth://totp/');
    expect(setup.otpauthUrl).toContain(encodeURIComponent(email));

    expect((await post('/auth/mfa/enable', { mfaToken: c.mfaToken, code: '000000' })).statusCode).toBe(401);
    const enabled = await post('/auth/mfa/enable', { mfaToken: c.mfaToken, code: totp(setup.secret, currentStep()) });
    expect(enabled.statusCode, enabled.body).toBe(200);
    expect(enabled.json().backupCodes).toHaveLength(10);
    expect(enabled.json().accessToken).toBeTypeOf('string');

    expect((await challenge(email)).mfa).toBe('required');
    const status = await app.inject({ method: 'GET', url: '/auth/mfa', headers: bearer(enabled.json().accessToken) });
    expect(status.json()).toMatchObject({ required: true, enabled: true, backupCodesRemaining: 10 });

    // Code de secours : une seule fois, tirets et majuscules ignorés
    const backup = enabled.json().backupCodes[0] as string;
    const c2 = await challenge(email);
    const viaBackup = await verify(c2.mfaToken, backup.toUpperCase());
    expect(viaBackup.statusCode).toBe(200);
    expect(viaBackup.json().backupCodesRemaining).toBe(9);
    const c3 = await challenge(email);
    expect((await verify(c3.mfaToken, backup)).json().error).toBe('invalid_mfa_code');
  });

  it('nouvelle série de codes : l’ancienne ne vaut plus rien', async () => {
    const session = (await passwordLogin(app, 'responsable@exemple.test', PASSWORD)).json();
    const first = await app.inject({
      method: 'POST', url: '/auth/mfa/backup-codes', headers: bearer(session.accessToken),
      payload: { code: await currentCode(app, 'responsable@exemple.test') },
    });
    expect(first.json().backupCodes).toHaveLength(10);
    const second = await app.inject({
      method: 'POST', url: '/auth/mfa/backup-codes', headers: bearer(session.accessToken),
      payload: { code: await currentCode(app, 'responsable@exemple.test') },
    });
    const c = await challenge('responsable@exemple.test');
    expect((await verify(c.mfaToken, first.json().backupCodes[0])).statusCode).toBe(401);
    const c2 = await challenge('responsable@exemple.test');
    expect((await verify(c2.mfaToken, second.json().backupCodes[0])).statusCode).toBe(200);
  });

  it('l’admin réinitialise la double authentification : sessions fermées, à reconfigurer', async () => {
    await app.db.updateTable('users').set({ mfa_last_step: null }).where('email', '=', email).execute();
    const session = (await verify((await challenge(email)).mfaToken, totp(secret, currentStep()))).json();
    expect(session.refreshToken).toBeTypeOf('string');
    const target = await app.db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    const reset = await call('admin', 'POST', `/platform/users/${target.id}/reset-mfa`);
    expect(reset.json()).toMatchObject({ mfaEnabled: false });
    expect((await post('/auth/refresh', { refreshToken: session.refreshToken })).statusCode).toBe(401);
    expect((await challenge(email)).mfa).toBe('setup');
  });

  it('employé nommé responsable : nouvelle connexion, avec double authentification', async () => {
    const prepose = await login('prepose3@exemple.test');
    const marc = await app.db.selectFrom('users').select('id').where('email', '=', 'prepose3@exemple.test').executeTakeFirstOrThrow();
    const promoted = await call('admin', 'POST', `/platform/residences/${RESIDENCE_A}/responsables`, { userId: marc.id });
    expect(promoted.statusCode).toBe(201);
    expect((await post('/auth/refresh', { refreshToken: prepose.json().refreshToken })).statusCode).toBe(401);
    expect((await challenge('prepose3@exemple.test')).mfa).toBe('setup');
    // Remis préposé pour les autres tests
    await call('responsable', 'PATCH', `/users/${marc.id}`, { role: 'prepose' });
  });
});
