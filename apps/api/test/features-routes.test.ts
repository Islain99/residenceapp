// Fonctionnalités activables : chaque route applique le niveau du module
// (masqué, consultation, complet), par rôle et par personne.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { ROUTE_FEATURES } from '../src/lib/feature-routes.js';
import type { Level } from '../src/lib/features.js';
import {
  bearer, buildTestApp, caller, ensureResidenceB, loginAll, loginAs, pushSender, RESIDENCE_A, seedIds,
} from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['responsable', 'infirmiere', 'prepose1', 'prepose2', 'prepose-b']));
  ids = await seedIds(app);
});

// Chaque test part de la résidence sans réglage
afterEach(async () => {
  await app.db.updateTable('residence_features').set({ level: null }).execute();
  await app.db.updateTable('user_features').set({ revoked_at: new Date(), revoke_reason: 'removed' })
    .where('revoked_at', 'is', null).execute();
  app.features.invalidate(RESIDENCE_A);
});

afterAll(async () => { await app.close(); });

async function setRole(feature: string, role: string, level: Level) {
  await app.db.insertInto('residence_features').values({ residence_id: RESIDENCE_A, feature, role, level })
    .onConflict((oc) => oc.columns(['residence_id', 'feature', 'role']).doUpdateSet({ level })).execute();
  app.features.invalidate(RESIDENCE_A);
}

async function setPerson(who: string, feature: string, level: Level) {
  await app.db.insertInto('user_features').values({ residence_id: RESIDENCE_A, user_id: ids.userId(who), feature, level }).execute();
  app.features.invalidate(RESIDENCE_A);
}

const newNote = (extra: object = {}) => ({
  occurredAt: new Date().toISOString(), categoryId: ids.categoryId, residentId: ids.residentId,
  description: 'Note de test des fonctionnalités', ...extra,
});

describe('chaque route est rattachée à un module', () => {
  it('toutes les routes de l’API ont une règle (sinon l’API ne démarre pas)', () => {
    expect(app.routeKeys.size).toBeGreaterThan(80);
  });

  it('aucune règle pour une route qui n’existe plus', () => {
    const stale = Object.keys(ROUTE_FEATURES).filter((key) => !app.routeKeys.has(key));
    expect(stale).toEqual([]);
  });
});

describe('Journal', () => {
  it('masqué pour les préposés de A : refusé pour eux seulement', async () => {
    await setRole('journal', 'prepose', 'off');
    const res = await call('prepose1', 'GET', '/notes');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'feature_disabled', feature: 'journal' });
    expect((await call('prepose-b', 'GET', '/notes')).statusCode).toBe(200);
    expect((await call('infirmiere', 'GET', '/notes')).statusCode).toBe(200);
    // La relève dépend du journal
    expect((await call('prepose1', 'GET', '/handover')).json()).toMatchObject({ error: 'feature_disabled', feature: 'handover' });
  });

  it('en consultation : lire oui, écrire non', async () => {
    await setRole('journal', 'prepose', 'read');
    expect((await call('prepose1', 'GET', '/notes')).statusCode).toBe(200);
    expect((await call('prepose1', 'GET', '/handover')).statusCode).toBe(200);
    const res = await call('prepose1', 'POST', '/notes', newNote());
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'feature_read_only', feature: 'journal' });
  });

  it('exception : un préposé écrit au journal, les autres le consultent', async () => {
    await setRole('journal', 'prepose', 'read');
    await setPerson('prepose1', 'journal', 'full');
    expect((await call('prepose1', 'POST', '/notes', newNote())).statusCode).toBe(201);
    expect((await call('prepose2', 'POST', '/notes', newNote())).statusCode).toBe(403);
  });

  it('exception à la baisse : une seule personne sans journal', async () => {
    await setPerson('prepose2', 'journal', 'off');
    expect((await call('prepose2', 'GET', '/notes')).statusCode).toBe(403);
    expect((await call('prepose1', 'GET', '/notes')).statusCode).toBe(200);
  });

  it('Consignes prioritaires désactivées : note ordinaire oui, prioritaire non', async () => {
    await setRole('priority', 'infirmiere', 'off');
    expect((await call('infirmiere', 'POST', '/notes', newNote())).statusCode).toBe(201);
    const res = await call('infirmiere', 'POST', '/notes', newNote({ isPriority: true }));
    expect(res.json()).toMatchObject({ error: 'feature_disabled', feature: 'priority' });
    expect((await call('responsable', 'POST', '/notes', newNote({ isPriority: true }))).statusCode).toBe(201);
  });
});

describe('le réglage ne donne jamais plus que le rôle', () => {
  it('préposé : créer une fiche reste refusé par son rôle, comme avant', async () => {
    const res = await call('prepose1', 'POST', '/residents', { firstName: 'Test', lastName: 'Rôle' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden');
  });

  it('préposé : statistiques refusées par le rôle même avec une exception', async () => {
    await setPerson('prepose1', 'stats', 'read');
    const res = await call('prepose1', 'GET', `/residents/${ids.residentId}/stats`);
    expect(res.json().error).toBe('forbidden');
  });
});

describe('Résidents', () => {
  it('masqués : la fiche est refusée, la liste reste pour choisir un résident dans une note', async () => {
    await setRole('residents', 'prepose', 'off');
    expect((await call('prepose1', 'GET', `/residents/${ids.residentId}`)).json()).toMatchObject({ error: 'feature_disabled', feature: 'residents' });
    expect((await call('prepose1', 'GET', '/residents')).statusCode).toBe(200);
  });

  it('liste refusée sans aucun module qui l’utilise', async () => {
    for (const f of ['residents', 'journal', 'agenda', 'followUps']) await setRole(f, 'prepose', 'off');
    expect((await call('prepose1', 'GET', '/residents')).statusCode).toBe(403);
  });

  it('infirmière en consultation : modifier une fiche refusé', async () => {
    await setRole('residents', 'infirmiere', 'read');
    expect((await call('infirmiere', 'GET', `/residents/${ids.residentId}`)).statusCode).toBe(200);
    const res = await call('infirmiere', 'PATCH', `/residents/${ids.residentId}`, { room: '101' });
    expect(res.json()).toMatchObject({ error: 'feature_read_only', feature: 'residents' });
  });

  it('Résidents masqués → statistiques masquées', async () => {
    await setRole('residents', 'infirmiere', 'off');
    expect((await call('infirmiere', 'GET', `/residents/${ids.residentId}/stats`)).json().feature).toBe('stats');
  });
});

describe('Suivis, Agenda, Horaires', () => {
  it('créer un suivi exige le journal en Complet', async () => {
    const note = (await call('infirmiere', 'POST', '/notes', newNote())).json();
    await setRole('journal', 'prepose', 'read');
    const res = await call('prepose1', 'POST', `/notes/${note.id}/follow-ups`, { description: 'À vérifier' });
    expect(res.json()).toMatchObject({ error: 'feature_read_only', feature: 'journal' });
    expect((await call('prepose1', 'GET', '/follow-ups')).statusCode).toBe(200);
  });

  it('suivis et agenda masqués : sections vides dans la relève et la note', async () => {
    const note = (await call('infirmiere', 'POST', '/notes', newNote())).json();
    expect((await call('infirmiere', 'POST', `/notes/${note.id}/follow-ups`, { description: 'Suivi visible' })).statusCode).toBe(201);
    await setRole('followUps', 'prepose', 'off');
    await setRole('agenda', 'prepose', 'off');
    expect((await call('prepose1', 'GET', '/follow-ups')).statusCode).toBe(403);
    expect((await call('prepose1', 'GET', '/appointments?from=2030-01-01T00:00:00Z&to=2030-01-07T00:00:00Z')).statusCode).toBe(403);
    const handover = (await call('prepose1', 'GET', '/handover')).json();
    expect(handover.followUps).toEqual([]);
    expect(handover.appointments).toEqual([]);
    expect((await call('prepose1', 'GET', `/notes/${note.id}`)).json().followUps).toEqual([]);
    expect((await call('infirmiere', 'GET', `/notes/${note.id}`)).json().followUps).toHaveLength(1);
  });

  it('horaires masqués pour les préposés', async () => {
    await setRole('schedule', 'prepose', 'off');
    expect((await call('prepose1', 'GET', '/shifts?from=2030-01-01&to=2030-01-07')).statusCode).toBe(403);
    expect((await call('infirmiere', 'GET', '/shifts?from=2030-01-01&to=2030-01-07')).statusCode).toBe(200);
  });
});

describe('Messagerie et annonces', () => {
  const team = async (who: string) => {
    const list = (await call(who, 'GET', '/conversations')).json() as { id: string; kind: string }[];
    return list;
  };

  it('Messagerie masquée : seules les annonces restent', async () => {
    const teamId = (await team('infirmiere')).find((c) => c.kind === 'team')!.id;
    await setRole('messaging', 'prepose', 'off');
    expect((await team('prepose1')).map((c) => c.kind)).toEqual(['announcements']);
    expect((await call('prepose1', 'GET', `/conversations/${teamId}`)).statusCode).toBe(404);
    expect((await call('prepose1', 'GET', '/messaging/summary')).statusCode).toBe(200);
    const res = await call('prepose1', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose2') });
    expect(res.json()).toMatchObject({ error: 'feature_disabled', feature: 'messaging' });
  });

  it('Annonces en consultation pour l’infirmière : elle ne publie plus', async () => {
    const channel = (await team('infirmiere')).find((c) => c.kind === 'announcements')!;
    await setRole('announcements', 'infirmiere', 'read');
    const conv = (await call('infirmiere', 'GET', `/conversations/${channel.id}`)).json();
    expect(conv.canPost).toBe(false);
    const res = await call('infirmiere', 'POST', `/conversations/${channel.id}/messages`, { body: 'Annonce' });
    expect(res.statusCode).toBe(403);
    // Les messages d'équipe restent permis
    const teamId = (await team('infirmiere')).find((c) => c.kind === 'team')!.id;
    expect((await call('infirmiere', 'POST', `/conversations/${teamId}/messages`, { body: 'Bonjour' })).statusCode).toBe(201);
  });

  it('pas de notification d’un module masqué', async () => {
    const devices: Record<string, string> = {};
    for (const who of ['prepose1', 'prepose2']) {
      devices[who] = `https://fcm.googleapis.com/fcm/send/features-${who}-${Date.now()}`;
      await call(who, 'POST', '/push/subscriptions', { endpoint: devices[who], keys: { p256dh: 'BPcMbnWQL5GOYX-test-key-p256dh-000000000000', auth: 'auth-secret-01' } });
    }
    await setPerson('prepose1', 'messaging', 'off');
    await app.notifier.flush();
    pushSender(app).sent.length = 0;
    const teamId = (await team('infirmiere')).find((c) => c.kind === 'team')!.id;
    await call('infirmiere', 'POST', `/conversations/${teamId}/messages`, { body: 'Message d’équipe' });
    await app.notifier.flush();
    const to = pushSender(app).sent.map((s) => s.endpoint);
    expect(to).toContain(devices.prepose2);
    expect(to).not.toContain(devices.prepose1);
    for (const who of ['prepose1', 'prepose2']) await call(who, 'POST', '/push/subscriptions/unsubscribe', { endpoint: devices[who] });
  });
});

describe('toujours actifs', () => {
  it('journal d’audit, équipe et export restent ouverts pour la responsable', async () => {
    for (const f of ['journal', 'residents', 'messaging']) await setRole(f, 'responsable', 'off');
    expect((await call('responsable', 'GET', '/audit')).statusCode).toBe(200);
    expect((await call('responsable', 'GET', '/users')).statusCode).toBe(200);
    expect((await call('responsable', 'GET', `/residents/${ids.residentId}/export`)).statusCode).toBe(200);
    expect((await call('responsable', 'GET', '/admin/conversations')).statusCode).toBe(200);
  });

  it('accès d’assistance : les réglages de la responsable s’appliquent', async () => {
    await setRole('journal', 'responsable', 'off');
    const resp = await loginAs(app, 'responsable@exemple.test');
    const grant = (await app.inject({ method: 'POST', url: '/assistance', headers: bearer(resp), payload: { hours: 1 } })).json();
    const admin = await loginAs(app, 'admin@exemple.test');
    const token = (await app.inject({ method: 'POST', url: `/platform/assistance/${grant.id}/start`, headers: bearer(admin) })).json().accessToken;
    expect((await app.inject({ method: 'GET', url: '/notes', headers: bearer(token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/residents', headers: bearer(token) })).statusCode).toBe(200);
    const revoked = await app.inject({ method: 'POST', url: `/assistance/${grant.id}/revoke`, headers: bearer(resp) });
    expect(revoked.statusCode, revoked.body).toBe(200);
  });
});
