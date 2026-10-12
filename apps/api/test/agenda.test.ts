import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, ensureResidenceB, loginAll, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;

const HOUR = 3_600_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['prepose1', 'prepose2', 'infirmiere', 'prepose-b']));
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

async function create(who = 'prepose1', extra: object = {}) {
  const res = await call(who, 'POST', '/appointments', {
    kind: 'medical', title: 'Dentiste', residentId: ids.residentId, location: 'Clinique du Parc',
    startsAt: at(5), endsAt: at(6), details: 'À jeun. Accompagnement par la famille.', ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const range = (fromH: number, toH: number) => `from=${encodeURIComponent(at(fromH))}&to=${encodeURIComponent(at(toH))}`;

describe('création', () => {
  it('rendez-vous d’un résident, signé, audité', async () => {
    const a = await create();
    expect(a).toMatchObject({
      kind: 'medical', title: 'Dentiste', location: 'Clinique du Parc', status: 'prevu',
      details: 'À jeun. Accompagnement par la famille.',
      resident: { id: ids.residentId }, createdBy: { firstName: 'Marc' },
    });
    const audited = await app.db.selectFrom('audit_log').select('action')
      .where('entity', '=', 'appointment').where('entity_id', '=', a.id).execute();
    expect(audited.map((r) => r.action)).toEqual(['create']);
  });

  it('rendez-vous de la résidence (sans résident)', async () => {
    const a = await create('prepose1', { kind: 'activite', title: 'Bingo', residentId: null, location: 'Salle commune' });
    expect(a.resident).toBeNull();
  });

  it('refuse une fin avant le début, un résident inconnu, un titre vide, un type inconnu', async () => {
    const base = { kind: 'medical', title: 'X', startsAt: at(3) };
    const errors = await Promise.all([
      call('prepose1', 'POST', '/appointments', { ...base, endsAt: at(2) }),
      call('prepose1', 'POST', '/appointments', { ...base, residentId: crypto.randomUUID() }),
      call('prepose1', 'POST', '/appointments', { ...base, title: '   ' }),
      call('prepose1', 'POST', '/appointments', { ...base, kind: 'fete' }),
    ]);
    expect(errors.map((r) => r.statusCode)).toEqual([400, 400, 400, 400]);
    expect(errors.slice(0, 3).map((r) => r.json().error)).toEqual(['invalid_end', 'invalid_resident', 'invalid_title']);
  });
});

describe('liste', () => {
  it('période [from, to[ triée par heure, filtres résident et type', async () => {
    const later = await create('prepose1', { startsAt: at(30), endsAt: null, title: 'Prise de sang' });
    const earlier = await create('prepose1', { startsAt: at(28), endsAt: null, title: 'Radiographie' });
    await create('prepose1', { startsAt: at(80), endsAt: null, title: 'Hors période' });

    const list = (await call('prepose2', 'GET', `/appointments?${range(27, 31)}`)).json() as { id: string }[];
    expect(list.map((a) => a.id)).toEqual([earlier.id, later.id]);

    const byResident = (await call('prepose2', 'GET', `/appointments?${range(0, 90)}&residentId=${ids.residentId}`)).json();
    expect(byResident.every((a: { resident: { id: string } }) => a.resident.id === ids.residentId)).toBe(true);
    const activities = (await call('prepose2', 'GET', `/appointments?${range(0, 90)}&kind=activite`)).json();
    expect(activities.every((a: { kind: string }) => a.kind === 'activite')).toBe(true);
  });

  it('période trop longue ou inversée : 400', async () => {
    expect((await call('prepose1', 'GET', `/appointments?${range(0, 24 * 100)}`)).statusCode).toBe(400);
    expect((await call('prepose1', 'GET', `/appointments?${range(5, 1)}`)).statusCode).toBe(400);
  });
});

describe('modification et annulation', () => {
  it('l’auteur modifie ; un autre préposé non ; l’infirmière oui', async () => {
    const a = await create('prepose1');
    const url = `/appointments/${a.id}`;
    expect((await call('prepose1', 'PATCH', url, { location: 'Clinique Saint-Jean' })).json().location).toBe('Clinique Saint-Jean');
    expect((await call('prepose2', 'PATCH', url, { title: 'X' })).statusCode).toBe(403);
    expect((await call('infirmiere', 'PATCH', url, { startsAt: at(7), endsAt: at(8) })).statusCode).toBe(200);
    expect((await call('infirmiere', 'PATCH', url, { endsAt: at(1) })).json().error).toBe('invalid_end');
  });

  it('annulation avec motif : figé, masqué de la liste par défaut', async () => {
    const a = await create('prepose1', { startsAt: at(40), endsAt: null });
    const url = `/appointments/${a.id}`;
    expect((await call('prepose1', 'POST', `${url}/cancel`, { reason: '' })).statusCode).toBe(400);
    const cancelled = await call('prepose1', 'POST', `${url}/cancel`, { reason: 'Reporté par la clinique' });
    expect(cancelled.json()).toMatchObject({ status: 'annule', cancelReason: 'Reporté par la clinique', cancelledBy: { firstName: 'Marc' } });
    expect((await call('infirmiere', 'PATCH', url, { title: 'X' })).statusCode).toBe(409);

    const ids = async (status: string) => (await call('prepose2', 'GET', `/appointments?${range(39, 41)}&status=${status}`)).json()
      .map((x: { id: string }) => x.id);
    expect(await ids('prevu')).not.toContain(a.id);
    expect(await ids('all')).toContain(a.id);
  });
});

describe('relève et isolation', () => {
  it('la relève montre les rendez-vous prévus des prochaines 24 h', async () => {
    const soon = await create('prepose1', { startsAt: at(2), endsAt: null, title: 'Visite du podiatre' });
    const far = await create('prepose1', { startsAt: at(30), endsAt: null, title: 'Plus tard' });
    const handover = (await call('prepose2', 'GET', '/handover')).json();
    const shown = handover.appointments.map((a: { id: string }) => a.id);
    expect(shown).toContain(soon.id);
    expect(shown).not.toContain(far.id);
  });

  it('une autre résidence ne voit ni ne modifie rien', async () => {
    const a = await create('prepose1');
    expect((await call('prepose-b', 'GET', `/appointments/${a.id}`)).statusCode).toBe(404);
    expect((await call('prepose-b', 'PATCH', `/appointments/${a.id}`, { title: 'X' })).statusCode).toBe(404);
    const list = (await call('prepose-b', 'GET', `/appointments?${range(-1, 90)}&status=all`)).json();
    expect(list).toEqual([]);
  });

  it('un résident d’une autre résidence est refusé', async () => {
    const res = await call('prepose-b', 'POST', '/appointments', { kind: 'medical', title: 'X', startsAt: at(3), residentId: ids.residentId });
    expect(res.json().error).toBe('invalid_resident');
  });
});
