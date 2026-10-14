import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { App } from '../src/app.js';
import { buildTestApp, caller, loginAll, pushSender, RESIDENCE_A, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;
let n = 0;

const endpoint = () => `https://fcm.googleapis.com/fcm/send/test-${Date.now()}-${++n}`;
const keys = { p256dh: 'BPcMbnWQL5GOYX-test-key-p256dh-000000000000', auth: 'auth-secret-01' };

beforeAll(async () => {
  app = await buildTestApp();
  call = caller(app, await loginAll(app, ['responsable', 'infirmiere', 'prepose1', 'prepose2']));
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

// Notifications reçues par un appareil depuis l'appel précédent
async function received(device: string) {
  await app.notifier.flush();
  const all = pushSender(app).sent.filter((s) => s.endpoint === device).map((s) => s.message);
  pushSender(app).sent.length = 0;
  return all;
}

async function subscribe(who: string) {
  const device = endpoint();
  const res = await call(who, 'POST', '/push/subscriptions', { endpoint: device, keys });
  expect(res.statusCode, res.body).toBe(201);
  return device;
}

describe('abonnement', () => {
  it('configuration : clé publique pour s’abonner', async () => {
    const res = await call('prepose1', 'GET', '/push/config');
    expect(res.json()).toMatchObject({ enabled: true });
    expect(res.json().publicKey).toBeTypeOf('string');
  });

  it('seuls les services de notification des navigateurs sont acceptés', async () => {
    for (const bad of ['https://evil.example.com/push', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x']) {
      const res = await call('prepose1', 'POST', '/push/subscriptions', { endpoint: bad, keys });
      expect(res.json().error, bad).toBe('invalid_endpoint');
    }
  });

  it('essai : notification sur mes appareils ; désabonnement', async () => {
    const device = await subscribe('prepose1');
    expect((await call('prepose1', 'POST', '/push/test')).json().sent).toBeGreaterThanOrEqual(1);
    expect((await received(device))[0]).toMatchObject({ title: 'Notifications activées' });
    await call('prepose1', 'POST', '/push/subscriptions/unsubscribe', { endpoint: device });
    await call('prepose1', 'POST', '/push/test');
    expect(await received(device)).toHaveLength(0);
  });
});

describe('messages et annonces', () => {
  it('message privé : avis au destinataire, sans le texte ; préférences respectées', async () => {
    const fatou = await subscribe('prepose2');
    const marc = await subscribe('prepose1');
    const conv = (await call('prepose1', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose2') })).json();
    await call('prepose1', 'POST', `/conversations/${conv.id}/messages`, { body: 'Secret : chambre 104, Mme Tremblay' });
    await app.notifier.flush();
    const toMarc = pushSender(app).sent.filter((s) => s.endpoint === marc);
    const [notice] = await received(fatou);
    expect(toMarc).toHaveLength(0);   // jamais à l'auteur
    expect(notice).toMatchObject({ title: 'Message de Marc T.', url: `/messages/${conv.id}` });
    expect(JSON.stringify(notice)).not.toContain('Tremblay');
    expect(JSON.stringify(notice)).not.toContain('104');

    await call('prepose2', 'PATCH', '/push/preferences', { messages: false });
    await call('prepose1', 'POST', `/conversations/${conv.id}/messages`, { body: 'Encore un' });
    expect(await received(fatou)).toHaveLength(0);
    expect((await call('prepose2', 'GET', '/push/preferences')).json()).toMatchObject({ messages: false, announcements: true });
    await call('prepose2', 'PATCH', '/push/preferences', { messages: true });
  });

  it('annonce : avis à toute l’équipe', async () => {
    const fatou = await subscribe('prepose2');
    const channel = (await call('responsable', 'GET', '/conversations')).json().find((c: { kind: string }) => c.kind === 'announcements');
    await call('responsable', 'POST', `/conversations/${channel.id}/messages`, { body: 'Réunion jeudi' });
    const [notice] = await received(fatou);
    expect(notice).toMatchObject({ title: 'Annonce de Sophie G.' });
  });
});

describe('consignes prioritaires et suivis', () => {
  it('consigne prioritaire : avis aux employés en quart, sans le nom du résident', async () => {
    const fatou = await subscribe('prepose2');
    // Fatou est en quart maintenant (une heure avant, une heure après)
    // Un quart type où Fatou n'a pas déjà de quart ce jour-là (un seul quart
    // par type et par jour ; l'horaire de démonstration lui donne « Jour »)
    const inserted = await sql`
      INSERT INTO shifts (residence_id, user_id, shift_type_id, work_date, start_time, end_time, created_by)
      SELECT r.id, ${ids.userId('prepose2')}::uuid, t.id, d.day,
             ((now() AT TIME ZONE r.timezone) - interval '1 hour')::time,
             ((now() AT TIME ZONE r.timezone) + interval '1 hour')::time,
             ${ids.userId('responsable')}::uuid
      FROM residences r
      CROSS JOIN LATERAL (SELECT ((now() AT TIME ZONE r.timezone) - interval '1 hour')::date AS day) d
      CROSS JOIN LATERAL (
        SELECT st.id FROM shift_types st
        WHERE st.residence_id = r.id AND NOT EXISTS (
          SELECT 1 FROM shifts s WHERE s.user_id = ${ids.userId('prepose2')}::uuid AND s.work_date = d.day
            AND s.shift_type_id = st.id AND s.cancelled_at IS NULL)
        ORDER BY st.sort_order LIMIT 1) t
      WHERE r.id = ${RESIDENCE_A}::uuid`.execute(app.db);
    expect(Number(inserted.numAffectedRows)).toBe(1);

    const res = await call('infirmiere', 'POST', '/notes', {
      occurredAt: new Date().toISOString(), categoryId: ids.categoryId, residentId: ids.residentId,
      description: 'Chute dans la salle de bain', isPriority: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const [notice] = await received(fatou);
    expect(notice).toMatchObject({ title: 'Consigne prioritaire', url: '/' });
    expect(JSON.stringify(notice)).not.toContain('Chute');
  });

  it('résidence sans horaire aujourd’hui : toute l’équipe est avisée', async () => {
    const manoir = '00000000-0000-4000-8000-000000000002';
    const staff = await app.notifier.onShiftNow(manoir);
    expect(staff).toHaveLength(2);
  });

  it('suivi confié à quelqu’un : avis ; rappel d’échéance une seule fois', async () => {
    const fatou = await subscribe('prepose2');
    const note = (await call('infirmiere', 'POST', '/notes', {
      occurredAt: new Date().toISOString(), categoryId: ids.categoryId, description: 'Note pour suivi',
    })).json();
    const fu = await call('infirmiere', 'POST', `/notes/${note.id}/follow-ups`, {
      description: 'Vérifier la pression', assignedTo: ids.userId('prepose2'),
      dueAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    expect(fu.statusCode, fu.body).toBe(201);
    expect((await received(fatou))[0]).toMatchObject({ title: 'Suivi assigné', url: '/suivis' });

    expect(await app.notifier.sendDueReminders()).toBeGreaterThanOrEqual(1);
    expect((await received(fatou)).map((x) => x.title)).toContain('Suivi à échéance');
    await app.notifier.sendDueReminders();
    expect(await received(fatou)).toHaveLength(0);

    // Nouvelle échéance : nouveau rappel
    await call('infirmiere', 'PATCH', `/follow-ups/${fu.json().id}`, { dueAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    await app.notifier.sendDueReminders();
    expect((await received(fatou)).map((x) => x.title)).toContain('Suivi à échéance');
  });
});

describe('appareils', () => {
  it('abonnement expiré : désactivé automatiquement', async () => {
    const device = await subscribe('prepose1');
    pushSender(app).gone.add(device);
    await call('prepose1', 'POST', '/push/test');
    await app.notifier.flush();
    const row = await app.db.selectFrom('push_subscriptions').select('disabled_at').where('endpoint', '=', device).executeTakeFirstOrThrow();
    expect(row.disabled_at).not.toBeNull();
  });

  it('appareil repris par une autre personne : l’ancienne ne reçoit plus rien', async () => {
    const device = await subscribe('prepose2');
    await call('prepose1', 'POST', '/push/subscriptions', { endpoint: device, keys });
    const row = await app.db.selectFrom('push_subscriptions').select('user_id').where('endpoint', '=', device).executeTakeFirstOrThrow();
    expect(row.user_id).toBe(ids.userId('prepose1'));
  });
});
