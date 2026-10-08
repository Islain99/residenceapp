import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, ensureResidenceB, loginAll } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['prepose1', 'infirmiere', 'responsable', 'prepose-b']));
});

afterAll(async () => { await app.close(); });

async function createResident(extra: object = {}) {
  const res = await call('responsable', 'POST', '/residents', { firstName: 'Test', lastName: 'Résident', ...extra });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

describe('liste', () => {
  it('résidents actifs, triés par nom', async () => {
    const res = await call('prepose1', 'GET', '/residents');
    expect(res.statusCode).toBe(200);
    const list = res.json() as { lastName: string; status: string }[];
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(list.every((r) => r.status === 'actif')).toBe(true);
    const names = list.map((r) => r.lastName);
    expect([...names].sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(names);
  });

  it('recherche sans accents, sur le nom ou la chambre', async () => {
    const byName = (await call('prepose1', 'GET', '/residents?q=cote')).json();
    expect(byName.map((r: { lastName: string }) => r.lastName)).toContain('Côté');
    const byRoom = (await call('prepose1', 'GET', '/residents?q=105')).json();
    expect(byRoom.map((r: { room: string }) => r.room)).toContain('105');
  });

  it('les caractères spéciaux de recherche sont traités littéralement', async () => {
    expect((await call('prepose1', 'GET', '/residents?q=%25')).json()).toEqual([]);
  });
});

describe('fiche', () => {
  it('notes réservées : visibles par l’infirmière, absentes pour le préposé ; consultation auditée', async () => {
    const created = await createResident({ restrictedNotes: 'Diagnostic confidentiel.' });
    const prepose = (await call('prepose1', 'GET', `/residents/${created.id}`)).json();
    const infirmiere = (await call('infirmiere', 'GET', `/residents/${created.id}`)).json();
    expect(prepose).not.toHaveProperty('restrictedNotes');
    expect(infirmiere.restrictedNotes).toBe('Diagnostic confidentiel.');
    const audited = await app.db.selectFrom('audit_log').select('id')
      .where('action', '=', 'view').where('entity', '=', 'resident').where('entity_id', '=', created.id).execute();
    expect(audited).toHaveLength(2);
  });

  it('autre résidence : 404', async () => {
    const created = await createResident();
    expect((await call('prepose-b', 'GET', `/residents/${created.id}`)).statusCode).toBe(404);
  });
});

describe('création et modification', () => {
  it('réservées à l’infirmière et à la responsable', async () => {
    expect((await call('prepose1', 'POST', '/residents', { firstName: 'A', lastName: 'B' })).statusCode).toBe(403);
    const created = await createResident();
    expect((await call('prepose1', 'PATCH', `/residents/${created.id}`, { room: '999' })).statusCode).toBe(403);
    const res = await call('infirmiere', 'PATCH', `/residents/${created.id}`, { room: ' 210 ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().room).toBe('210');
  });

  it('dates au format AAAA-MM-JJ, sans décalage', async () => {
    const created = await createResident({ birthDate: '1940-01-01', admittedAt: '2024-03-15' });
    expect(created).toMatchObject({ birthDate: '1940-01-01', admittedAt: '2024-03-15' });
    const bad = await call('responsable', 'POST', '/residents', { firstName: 'A', lastName: 'B', birthDate: '01/01/1940' });
    expect(bad.statusCode).toBe(400);
  });

  it('départ : date obligatoire, après l’admission ; retour : date effacée', async () => {
    const created = await createResident({ admittedAt: '2024-03-15' });
    const url = `/residents/${created.id}`;
    expect((await call('responsable', 'PATCH', url, { status: 'parti' })).json().error).toBe('left_at_required');
    expect((await call('responsable', 'PATCH', url, { status: 'parti', leftAt: '2024-01-01' })).json().error).toBe('invalid_left_at');

    const left = await call('responsable', 'PATCH', url, { status: 'parti', leftAt: '2025-06-30' });
    expect(left.json()).toMatchObject({ status: 'parti', leftAt: '2025-06-30' });
    const ids = async (qs: string) => (await call('prepose1', 'GET', `/residents${qs}`)).json().map((r: { id: string }) => r.id);
    expect(await ids('')).not.toContain(created.id);
    expect(await ids('?status=all')).toContain(created.id);

    const back = await call('responsable', 'PATCH', url, { status: 'actif' });
    expect(back.json()).toMatchObject({ status: 'actif', leftAt: null });
  });

  it('nom vide refusé', async () => {
    const res = await call('responsable', 'POST', '/residents', { firstName: '  ', lastName: 'B' });
    expect(res.json().error).toBe('invalid_name');
  });
});
