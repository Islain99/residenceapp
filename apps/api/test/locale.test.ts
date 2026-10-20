import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, loginAll, outbox, pushSender } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;

beforeAll(async () => {
  app = await buildTestApp();
  call = caller(app, await loginAll(app, ['prepose4', 'responsable']));
});

afterAll(async () => {
  await app.db.updateTable('users').set({ locale: 'fr' }).where('email', '=', 'prepose4@exemple.test').execute();
  await app.close();
});

const lastMailTo = (email: string) => [...outbox(app)].reverse().find((m) => m.to === email);

describe('langue du compte', () => {
  it('français par défaut ; chacun choisit l’anglais dans son profil ; langue inconnue refusée', async () => {
    expect((await call('prepose4', 'GET', '/auth/me')).json().locale).toBe('fr');
    expect((await call('prepose4', 'PATCH', '/auth/me', { locale: 'en' })).json().locale).toBe('en');
    expect((await call('prepose4', 'PATCH', '/auth/me', { locale: 'es' })).statusCode).toBe(400);
    expect((await call('prepose4', 'GET', '/auth/me')).json().locale).toBe('en');
  });

  it('mot de passe oublié : courriel dans la langue du compte', async () => {
    await app.inject({ method: 'POST', url: '/auth/password/forgot', payload: { email: 'prepose4@exemple.test' } });
    const mail = lastMailTo('prepose4@exemple.test');
    expect(mail?.subject).toBe('Reset your password — Logbook');
    expect(mail?.html).toContain('<html lang="en">');
    expect(mail?.text).toContain('Hello ');
  });

  it('invitation : langue choisie par la responsable, français par défaut', async () => {
    const english = `en.${Date.now()}@exemple.test`;
    const french = `fr.${Date.now()}@exemple.test`;
    const res = await call('responsable', 'POST', '/users', { email: english, firstName: 'Ann', lastName: 'Lee', role: 'prepose', locale: 'en' });
    expect(res.statusCode, res.body).toBe(201);
    expect(lastMailTo(english)?.subject).toMatch(/^Your logbook access — /);
    await call('responsable', 'POST', '/users', { email: french, firstName: 'Léa', lastName: 'Roy', role: 'prepose' });
    expect(lastMailTo(french)?.subject).toMatch(/^Votre accès au journal de bord — /);
  });

  it('notification : dans la langue de chaque appareil', async () => {
    const keys = { p256dh: 'BPcMbnWQL5GOYX-test-key-p256dh-000000000000', auth: 'auth-secret-01' };
    const device = `https://fcm.googleapis.com/fcm/send/locale-${Date.now()}`;
    await call('prepose4', 'POST', '/push/subscriptions', { endpoint: device, keys });
    await call('prepose4', 'POST', '/push/test');
    await app.notifier.flush();
    const sent = pushSender(app).sent.filter((s) => s.endpoint === device).map((s) => s.message.title);
    expect(sent).toEqual(['Notifications on']);
  });
});
