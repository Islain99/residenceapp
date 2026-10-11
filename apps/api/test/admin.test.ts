// Administration de la résidence : journal d'audit, export d'un dossier
// (Loi 25) et catégories de notes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, ensureResidenceB, loginAll, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['prepose1', 'infirmiere', 'responsable', 'admin', 'prepose-b']));
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

describe('journal d’audit', () => {
  it('responsable seulement', async () => {
    for (const who of ['prepose1', 'infirmiere', 'admin']) {
      expect((await call(who, 'GET', '/audit')).statusCode, who).toBe(403);
    }
    expect((await call('responsable', 'GET', '/audit')).statusCode).toBe(200);
  });

  it('qui a consulté un dossier : filtres, plus récent d’abord, auteur', async () => {
    await call('prepose1', 'GET', `/residents/${ids.residentId}`);
    await call('infirmiere', 'GET', `/residents/${ids.residentId}`);
    const res = await call('responsable', 'GET',
      `/audit?entity=resident&entityId=${ids.residentId}&action=view&limit=2`);
    expect(res.statusCode).toBe(200);
    const { items, nextCursor } = res.json();
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ action: 'view', entity: 'resident', entityId: ids.residentId,
      user: { firstName: 'Nadia' } });
    expect(items[1].user.firstName).toBe('Marc');
    expect(Number(items[0].id)).toBeGreaterThan(Number(items[1].id));
    expect(nextCursor === null || nextCursor === items[1].id).toBe(true);
  });

  it('connexion refusée : le compte visé est nommé', async () => {
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'prepose2@exemple.test', password: 'mauvais' } });
    const { items } = (await call('responsable', 'GET', '/audit?action=login_failed&limit=1')).json();
    expect(items[0]).toMatchObject({ user: null, target: { firstName: 'Fatou' } });
  });

  it('pagination sans doublon', async () => {
    const first = (await call('responsable', 'GET', '/audit?limit=3')).json();
    const second = (await call('responsable', 'GET', `/audit?limit=3&cursor=${first.nextCursor}`)).json();
    const firstIds = first.items.map((i: { id: string }) => i.id);
    expect(second.items.some((i: { id: string }) => firstIds.includes(i.id))).toBe(false);
  });

  it('ne montre que la résidence de la responsable', async () => {
    await call('prepose-b', 'GET', '/notes');
    const prepB = await app.db.selectFrom('users').select('id').where('email', '=', 'prepose-b@exemple.test')
      .executeTakeFirstOrThrow();
    const res = await call('responsable', 'GET', `/audit?userId=${prepB.id}`);
    expect(res.json().items).toEqual([]);
  });
});

describe('export d’un dossier (Loi 25)', () => {
  it('responsable seulement', async () => {
    for (const who of ['prepose1', 'infirmiere']) {
      expect((await call(who, 'GET', `/residents/${ids.residentId}/export`)).statusCode).toBe(403);
    }
  });

  it('fiche complète, notes et corrections, suivis, consultations ; export audité', async () => {
    // Une note corrigée et un suivi sur ce résident
    const note = (await call('infirmiere', 'POST', '/notes', {
      occurredAt: new Date(Date.now() - 60_000).toISOString(), categoryId: ids.categoryId,
      residentId: ids.residentId, description: '[test] Note pour l’export.',
    })).json();
    await call('infirmiere', 'PATCH', `/notes/${note.id}`, { description: '[test] Note corrigée pour l’export.' });
    await call('infirmiere', 'POST', `/notes/${note.id}/follow-ups`, { description: '[test] Suivi exporté' });
    await call('prepose1', 'GET', `/notes/${note.id}`);

    const res = await call('responsable', 'GET', `/residents/${ids.residentId}/export`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="dossier-[\w.-]+\.json"$/);
    const dossier = res.json();
    expect(dossier).toMatchObject({ format: 'residence-app/dossier-resident', version: 1 });
    expect(dossier.resident.id).toBe(ids.residentId);
    expect(dossier.resident).toHaveProperty('restrictedNotes');   // champs réservés inclus

    const exported = dossier.notes.find((n: { id: string }) => n.id === note.id);
    expect(exported.description).toBe('[test] Note corrigée pour l’export.');
    expect(exported.corrections).toHaveLength(1);
    expect(exported.corrections[0].previous.description).toBe('[test] Note pour l’export.');
    expect(dossier.notes.every((n: { resident: { id: string } }) => n.resident.id === ids.residentId)).toBe(true);

    expect(dossier.followUps.map((f: { description: string }) => f.description)).toContain('[test] Suivi exporté');
    expect(dossier.accessLog.some((l: { action: string; entity: string; entityId: string }) =>
      l.action === 'view' && l.entity === 'note' && l.entityId === note.id)).toBe(true);

    const audit = await app.db.selectFrom('audit_log').select(['action', 'user_id'])
      .where('action', '=', 'export').where('entity_id', '=', ids.residentId).executeTakeFirst();
    expect(audit?.user_id).toBe(ids.userId('responsable'));
  });

  it('jeton qui ne correspond pas au compte : refusé', async () => {
    const res = await app.inject({ method: 'GET', url: `/residents/${ids.residentId}/export`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: ids.userId('responsable'), rid: '00000000-0000-4000-8000-0000000000b0', role: 'responsable' })}` } });
    // Jeton dont la résidence ne correspond pas au compte : refusé avant même la recherche
    expect(res.statusCode).toBe(401);
  });
});

describe('catégories', () => {
  it('créer, renommer, désactiver, réactiver (responsable)', async () => {
    const created = await call('responsable', 'POST', '/note-categories', { label: '  Visite   famille ' });
    expect(created.statusCode).toBe(201);
    const cat = created.json();
    expect(cat).toMatchObject({ label: 'Visite famille', isActive: true });

    expect((await call('responsable', 'PATCH', `/note-categories/${cat.id}`, { label: 'Visites' })).json().label)
      .toBe('Visites');

    expect((await call('responsable', 'PATCH', `/note-categories/${cat.id}`, { isActive: false })).json().isActive)
      .toBe(false);
    const active = (await call('prepose1', 'GET', '/note-categories')).json();
    expect(active.some((c: { id: string }) => c.id === cat.id)).toBe(false);
    const all = (await call('responsable', 'GET', '/note-categories?all=true')).json();
    expect(all.find((c: { id: string }) => c.id === cat.id).isActive).toBe(false);

    // Plus proposée pour une nouvelle note
    const note = await call('prepose1', 'POST', '/notes', {
      occurredAt: new Date().toISOString(), categoryId: cat.id, description: '[test] x',
    });
    expect(note.json().error).toBe('invalid_category');

    await call('responsable', 'PATCH', `/note-categories/${cat.id}`, { isActive: true });
    const actions = (await app.db.selectFrom('audit_log').select('action')
      .where('entity', '=', 'note_category').where('entity_id', '=', cat.id).orderBy('id').execute())
      .map((a) => a.action);
    expect(actions).toEqual(['create', 'update', 'deactivate', 'reactivate']);
  });

  it('nom en double : 409', async () => {
    const res = await call('responsable', 'POST', '/note-categories', { label: 'Comportement' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('duplicate_label');
  });

  it('écriture et liste complète : responsable seulement', async () => {
    expect((await call('infirmiere', 'POST', '/note-categories', { label: 'Interdit' })).statusCode).toBe(403);
    expect((await call('prepose1', 'GET', '/note-categories?all=true')).statusCode).toBe(403);
    const other = (await call('prepose-b', 'GET', '/note-categories')).json()[0];
    expect((await call('responsable', 'PATCH', `/note-categories/${other.id}`, { label: 'Piratée' })).statusCode)
      .toBe(404);
  });
});
