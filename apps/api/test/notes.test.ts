import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { bearer, buildTestApp, ensureResidenceB, loginAs, RESIDENCE_A, RESIDENCE_B } from './helpers.js';

let app: App;
const tokens: Record<string, string> = {};
let categoryId: string;      // catégorie de la résidence A
let categoryB: string;       // catégorie de la résidence B
let residentId: string;      // résident de la résidence A

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  for (const who of ['prepose1', 'prepose2', 'infirmiere', 'responsable', 'admin', 'prepose-b']) {
    tokens[who] = await loginAs(app, `${who}@exemple.test`);
  }
  const cat = (rid: string) => app.db.selectFrom('note_categories').select('id')
    .where('residence_id', '=', rid).orderBy('sort_order').executeTakeFirstOrThrow();
  categoryId = (await cat(RESIDENCE_A)).id;
  categoryB = (await cat(RESIDENCE_B)).id;
  residentId = (await app.db.selectFrom('residents').select('id')
    .where('residence_id', '=', RESIDENCE_A).orderBy('last_name').executeTakeFirstOrThrow()).id;
});

afterAll(async () => { await app.close(); });

const call = (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: bearer(tokens[who]!) });

async function createNote(who: string, extra: object = {}) {
  const res = await call(who, 'POST', '/notes', {
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    categoryId, residentId, description: '[test] Note de test automatisé.', ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const lastAudit = (action: string, entityId: string) => app.db.selectFrom('audit_log').selectAll()
  .where('action', '=', action).where('entity_id', '=', entityId).executeTakeFirst();

describe('catégories', () => {
  it('liste les catégories actives de la résidence, dans l’ordre', async () => {
    const res = await call('prepose1', 'GET', '/note-categories');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { label: string }) => c.label).slice(0, 3)).toEqual(['Comportement', 'Alimentation', 'Sommeil']);
  });
});

describe('création', () => {
  it('crée une note signée par l’utilisateur connecté, et l’audite', async () => {
    const note = await createNote('prepose1', { isPriority: true, intervention: '  Infirmière avisée.  ' });
    expect(note).toMatchObject({
      status: 'active', isPriority: true, isPositive: false, versionCount: 0,
      intervention: 'Infirmière avisée.',
      author: { firstName: 'Marc', lastName: 'Tremblay' },
      resident: { id: residentId },
      category: { id: categoryId },
    });
    expect(await lastAudit('create', note.id)).toBeDefined();
  });

  it('note générale (sans résident)', async () => {
    const note = await createNote('prepose1', { residentId: null });
    expect(note.resident).toBeNull();
  });

  it('refuse une catégorie d’une autre résidence', async () => {
    const res = await call('prepose1', 'POST', '/notes', {
      occurredAt: new Date().toISOString(), categoryId: categoryB, description: 'x',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_category');
  });

  it('refuse un résident inconnu, une date future, une description vide', async () => {
    const base = { occurredAt: new Date().toISOString(), categoryId, description: 'x' };
    const resident = await call('prepose1', 'POST', '/notes', { ...base, residentId: crypto.randomUUID() });
    const future = await call('prepose1', 'POST', '/notes', { ...base, occurredAt: new Date(Date.now() + 3_600_000).toISOString() });
    const blank = await call('prepose1', 'POST', '/notes', { ...base, description: '   ' });
    expect([resident.json().error, future.json().error, blank.json().error])
      .toEqual(['invalid_resident', 'invalid_occurred_at', 'invalid_description']);
  });
});

describe('liste et recherche', () => {
  it('filtre par résident, la plus récente d’abord', async () => {
    const res = await call('prepose2', 'GET', `/notes?residentId=${residentId}&limit=20`);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { resident: { id: string }; occurredAt: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((n) => n.resident.id === residentId)).toBe(true);
    const times = items.map((n) => n.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('recherche plein texte insensible aux accents', async () => {
    const word = 'zébulon' + Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
    const note = await createNote('prepose1', { description: `[test] Résident ${word} ce matin.` });
    const res = await call('prepose2', 'GET', `/notes?q=${encodeURIComponent(word.replace('é', 'e'))}`);
    expect(res.json().items.map((n: { id: string }) => n.id)).toEqual([note.id]);
  });

  it('pagination par curseur : pages sans doublon, ordre conservé', async () => {
    const page1 = (await call('prepose1', 'GET', '/notes?limit=5')).json();
    expect(page1.items).toHaveLength(5);
    expect(page1.nextCursor).toBeTypeOf('string');
    const page2 = (await call('prepose1', 'GET', `/notes?limit=5&cursor=${page1.nextCursor}`)).json();
    const ids1 = page1.items.map((n: { id: string }) => n.id);
    expect(page2.items.some((n: { id: string }) => ids1.includes(n.id))).toBe(false);
    expect(page2.items[0].occurredAt <= page1.items[4].occurredAt).toBe(true);
  });

  it('curseur invalide → 400', async () => {
    expect((await call('prepose1', 'GET', '/notes?cursor=nimporte')).statusCode).toBe(400);
  });
});

describe('correction', () => {
  it('l’auteur corrige : ancienne version conservée, audit', async () => {
    const note = await createNote('prepose1');
    const res = await call('prepose1', 'PATCH', `/notes/${note.id}`, { description: '[test] Texte corrigé.' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ description: '[test] Texte corrigé.', versionCount: 1 });

    const detail = (await call('prepose1', 'GET', `/notes/${note.id}`)).json();
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0].previous.description).toBe('[test] Note de test automatisé.');
    expect(detail.versions[0].editedBy.firstName).toBe('Marc');
    expect((await lastAudit('update', note.id))?.details).toEqual({ fields: ['description'] });
    expect(await lastAudit('view', note.id)).toBeDefined();
  });

  it('aucun changement réel : pas de nouvelle version', async () => {
    const note = await createNote('prepose1');
    const res = await call('prepose1', 'PATCH', `/notes/${note.id}`, { description: note.description });
    expect(res.json().versionCount).toBe(0);
  });

  it('un autre préposé ne peut pas corriger ; une infirmière peut', async () => {
    const note = await createNote('prepose1');
    expect((await call('prepose2', 'PATCH', `/notes/${note.id}`, { isPriority: true })).statusCode).toBe(403);
    const res = await call('infirmiere', 'PATCH', `/notes/${note.id}`, { isPriority: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().isPriority).toBe(true);
  });

  it('l’auteur ne peut plus corriger après 24 h', async () => {
    const old = await app.db.selectFrom('notes as n').innerJoin('users as u', 'u.id', 'n.author_id')
      .select('n.id').where('u.email', '=', 'prepose1@exemple.test')
      .where('n.status', '=', 'active')
      .where('n.created_at', '<', new Date(Date.now() - 2 * 24 * 3_600_000))
      .executeTakeFirstOrThrow();
    const res = await call('prepose1', 'PATCH', `/notes/${old.id}`, { isPositive: true });
    expect(res.statusCode).toBe(403);
  });
});

describe('annulation', () => {
  it('exige un motif, puis la note est figée et masquée par défaut', async () => {
    const note = await createNote('prepose1');
    expect((await call('prepose1', 'POST', `/notes/${note.id}/cancel`, { reason: '' })).statusCode).toBe(400);

    const res = await call('prepose1', 'POST', `/notes/${note.id}/cancel`, { reason: 'Mauvais résident.' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'annulee', cancelReason: 'Mauvais résident.', cancelledBy: { firstName: 'Marc' } });
    expect(await lastAudit('cancel', note.id)).toBeDefined();

    expect((await call('responsable', 'PATCH', `/notes/${note.id}`, { description: 'x' })).statusCode).toBe(409);
    expect((await call('responsable', 'POST', `/notes/${note.id}/cancel`, { reason: 'encore' })).statusCode).toBe(409);

    const ids = async (qs: string) => (await call('prepose1', 'GET', `/notes?limit=100${qs}`)).json()
      .items.map((n: { id: string }) => n.id);
    expect(await ids('')).not.toContain(note.id);
    expect(await ids('&status=annulee')).toContain(note.id);
  });
});

describe('isolation et accès', () => {
  it('une autre résidence ne voit ni ne modifie les notes', async () => {
    const note = await createNote('prepose1');
    expect((await call('prepose-b', 'GET', `/notes/${note.id}`)).statusCode).toBe(404);
    expect((await call('prepose-b', 'PATCH', `/notes/${note.id}`, { description: 'x' })).statusCode).toBe(404);
    expect((await call('prepose-b', 'POST', `/notes/${note.id}/cancel`, { reason: 'xxx' })).statusCode).toBe(404);
    const list = (await call('prepose-b', 'GET', '/notes?status=all')).json().items;
    expect(list.every((n: { category: { id: string } }) => n.category.id === categoryB)).toBe(true);
  });

  it('admin plateforme (sans résidence) : 403', async () => {
    expect((await call('admin', 'GET', '/notes')).statusCode).toBe(403);
  });

  it('sans jeton : 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/notes' })).statusCode).toBe(401);
  });

  it('identifiant mal formé : 400', async () => {
    expect((await call('prepose1', 'GET', '/notes/pas-un-uuid')).statusCode).toBe(400);
  });
});
