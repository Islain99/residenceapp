// Logique des lectures et des suivis (revue du 12 octobre) :
//   * l'auteur a lu sa note ;
//   * « J'ai pris connaissance » confirme les notes ordinaires de la relève,
//     les consignes prioritaires se confirment une à une d'abord ;
//   * une consigne prioritaire corrigée est à relire (et revient dans la relève) ;
//     une note ordinaire corrigée est signalée « modifiée depuis votre lecture » ;
//   * « pas encore lue par » sur une consigne prioritaire ;
//   * le départ d'un résident ferme ses suivis ouverts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, loginAll, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;

beforeAll(async () => {
  app = await buildTestApp();
  call = caller(app, await loginAll(app, ['prepose1', 'prepose2', 'prepose3', 'infirmiere', 'responsable']));
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

async function createNote(who: string, extra: object = {}) {
  const res = await call(who, 'POST', '/notes', {
    occurredAt: new Date(Date.now() - 60_000).toISOString(), categoryId: ids.categoryId,
    residentId: ids.residentId, description: '[test] Note pour la logique de lecture.', ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const note = async (who: string, id: string) => (await call(who, 'GET', `/notes/${id}`)).json();
const handover = async (who: string) => (await call(who, 'GET', '/handover')).json();
const ack = (who: string, seenUntil: string) => call(who, 'POST', '/handover/ack', { seenUntil });

// Repart d'une relève vide pour cet employé (consignes lues, relève confirmée)
async function resetHandover(who: string) {
  const h = await handover(who);
  for (const n of h.notes.filter((x: { isPriority: boolean; readByMe: boolean }) => x.isPriority && !x.readByMe)) {
    await call(who, 'POST', `/notes/${n.id}/read`);
  }
  expect((await ack(who, h.generatedAt)).statusCode).toBe(201);
}

describe('auteur', () => {
  it('l’auteur a lu sa propre note', async () => {
    const n = await createNote('prepose1');
    expect(n.readByMe).toBe(true);
    const detail = await note('prepose1', n.id);
    expect(detail.reads.map((r: { user: { firstName: string } }) => r.user.firstName)).toEqual(['Marc']);
    const h = await handover('prepose1');
    expect(h.notes.find((x: { id: string }) => x.id === n.id)?.readByMe).toBe(true);
  });
});

describe('relève et lectures', () => {
  it('les consignes prioritaires se confirment avant la relève, puis la relève confirme les notes ordinaires', async () => {
    await resetHandover('prepose2');
    const ordinary = await createNote('prepose1');
    const priority = await createNote('infirmiere', { isPriority: true, description: '[test] Consigne : ne pas lever seul.' });

    const h = await handover('prepose2');
    expect(h.counts.unread).toBeGreaterThanOrEqual(2);

    const blocked = await ack('prepose2', h.generatedAt);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: 'priority_unread' });

    expect((await call('prepose2', 'POST', `/notes/${priority.id}/read`)).statusCode).toBe(204);
    expect((await ack('prepose2', h.generatedAt)).statusCode).toBe(201);

    expect((await note('prepose2', ordinary.id)).readByMe).toBe(true);
    const unread = (await call('prepose2', 'GET', '/notes?unread=true&limit=100')).json().items.map((x: { id: string }) => x.id);
    expect(unread).not.toContain(ordinary.id);
    expect(unread).not.toContain(priority.id);
  });

  it('une note écrite après la lecture de la relève n’est pas marquée lue par la confirmation', async () => {
    await resetHandover('prepose3');
    const h = await handover('prepose3');
    const late = await createNote('prepose1');
    expect((await ack('prepose3', h.generatedAt)).statusCode).toBe(201);
    expect((await note('prepose3', late.id)).readByMe).toBe(false);
    expect((await handover('prepose3')).notes.map((x: { id: string }) => x.id)).toContain(late.id);
  });
});

describe('corrections', () => {
  it('consigne prioritaire corrigée : à relire, revient dans la relève, puis relecture enregistrée', async () => {
    const priority = await createNote('infirmiere', { isPriority: true, description: '[test] Consigne v1.' });
    await call('prepose2', 'POST', `/notes/${priority.id}/read`);
    await resetHandover('prepose2');
    expect((await note('prepose2', priority.id)).readByMe).toBe(true);

    const edited = await call('infirmiere', 'PATCH', `/notes/${priority.id}`, { description: '[test] Consigne v2 : deux personnes.' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().readByMe).toBe(true);   // celle qui corrige a lu la nouvelle version
    expect(edited.json().contentEditedAt).not.toBeNull();

    const forReader = await note('prepose2', priority.id);
    expect(forReader.readByMe).toBe(false);
    expect(forReader.modifiedSinceRead).toBe(false);   // prioritaire : simplement à relire
    const h = await handover('prepose2');
    expect(h.notes.map((x: { id: string }) => x.id)).toContain(priority.id);
    expect((await ack('prepose2', h.generatedAt)).statusCode).toBe(409);

    expect((await call('prepose2', 'POST', `/notes/${priority.id}/read`)).statusCode).toBe(204);
    expect((await note('prepose2', priority.id)).readByMe).toBe(true);
    expect((await ack('prepose2', h.generatedAt)).statusCode).toBe(201);
  });

  it('note ordinaire corrigée : reste lue, signalée « modifiée depuis votre lecture »', async () => {
    const n = await createNote('prepose1');
    await call('prepose2', 'POST', `/notes/${n.id}/read`);
    await call('prepose1', 'PATCH', `/notes/${n.id}`, { description: '[test] Texte corrigé.' });
    const forReader = await note('prepose2', n.id);
    expect(forReader).toMatchObject({ readByMe: true, modifiedSinceRead: true });
    expect((await note('prepose1', n.id)).modifiedSinceRead).toBe(false);   // l'auteur de la correction
  });

  it('changer seulement la catégorie ou « positif » n’oblige pas à relire', async () => {
    const priority = await createNote('infirmiere', { isPriority: true, description: '[test] Consigne stable.' });
    await call('prepose3', 'POST', `/notes/${priority.id}/read`);
    await call('infirmiere', 'PATCH', `/notes/${priority.id}`, { isPositive: true });
    const forReader = await note('prepose3', priority.id);
    expect(forReader.readByMe).toBe(true);
    expect(forReader.contentEditedAt).toBeNull();
  });
});

describe('pas encore lue par', () => {
  it('liste les employés actifs qui n’ont pas lu la consigne (ni sa dernière version)', async () => {
    const priority = await createNote('infirmiere', { isPriority: true, description: '[test] Qui l’a lue ?' });
    await call('prepose1', 'POST', `/notes/${priority.id}/read`);
    const names = (await note('responsable', priority.id)).unreadBy.map((u: { firstName: string }) => u.firstName);
    expect(names).not.toContain('Nadia');   // l'autrice
    expect(names).not.toContain('Marc');    // a confirmé
    expect(names).toContain('Fatou');

    await call('infirmiere', 'PATCH', `/notes/${priority.id}`, { description: '[test] Qui l’a lue ? (corrigée)' });
    const after = (await note('responsable', priority.id)).unreadBy.map((u: { firstName: string }) => u.firstName);
    expect(after).toContain('Marc');        // doit relire
    expect(after).not.toContain('Nadia');
  });

  it('vide pour une note ordinaire', async () => {
    const n = await createNote('prepose1');
    expect((await note('responsable', n.id)).unreadBy).toEqual([]);
  });
});

describe('départ d’un résident', () => {
  it('ferme ses suivis ouverts avec le motif « Départ du résident. »', async () => {
    const created = (await call('infirmiere', 'POST', '/residents', { firstName: 'Test', lastName: 'Départ' })).json();
    const n = await createNote('prepose1', { residentId: created.id });
    const f = (await call('prepose1', 'POST', `/notes/${n.id}/follow-ups`, { description: '[test] À surveiller' })).json();

    const left = await call('infirmiere', 'PATCH', `/residents/${created.id}`, {
      status: 'parti', leftAt: new Date().toISOString().slice(0, 10),
    });
    expect(left.statusCode).toBe(200);

    const closed = (await call('prepose1', 'GET', `/follow-ups/${f.id}`)).json();
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closingNote).toBe('Départ du résident.');
    expect(closed.closedBy.firstName).toBe('Nadia');
  });
});
