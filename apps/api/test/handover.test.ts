import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, loginAll, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;

beforeAll(async () => {
  app = await buildTestApp();
  call = caller(app, await loginAll(app, ['prepose1', 'prepose2', 'prepose4', 'admin']));
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

async function createNote(extra: object = {}) {
  const res = await call('prepose1', 'POST', '/notes', {
    occurredAt: new Date().toISOString(), categoryId: ids.categoryId, residentId: ids.residentId,
    description: 'Note pour la relève.', ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const noteIds = (body: { notes?: { id: string }[]; items?: { id: string }[] }) =>
  (body.notes ?? body.items ?? []).map((n) => n.id);

describe('confirmation de lecture', () => {
  it('idempotente, propre à chaque employé, visible dans le détail', async () => {
    const note = await createNote();
    expect((await call('prepose2', 'POST', `/notes/${note.id}/read`)).statusCode).toBe(204);
    expect((await call('prepose2', 'POST', `/notes/${note.id}/read`)).statusCode).toBe(204);

    const forReader = (await call('prepose2', 'GET', `/notes/${note.id}`)).json();
    const forOther = (await call('prepose4', 'GET', `/notes/${note.id}`)).json();
    expect(forReader.readByMe).toBe(true);
    expect(forOther.readByMe).toBe(false);
    expect(forReader.reads.map((r: { user: { firstName: string } }) => r.user.firstName)).toEqual(['Fatou']);

    expect(noteIds((await call('prepose2', 'GET', '/notes?unread=true&limit=100')).json())).not.toContain(note.id);
    expect(noteIds((await call('prepose4', 'GET', '/notes?unread=true&limit=100')).json())).toContain(note.id);
  });

  it('note inconnue : 404', async () => {
    expect((await call('prepose2', 'POST', `/notes/${crypto.randomUUID()}/read`)).statusCode).toBe(404);
  });
});

describe('relève', () => {
  it('depuis la dernière relève : nouvelles notes, prioritaires d’abord, suivis qui me concernent', async () => {
    const normal = await createNote();
    const priority = await createNote({ isPriority: true, description: 'Consigne : ne pas lever seul.' });
    const team = (await call('prepose1', 'POST', `/notes/${normal.id}/follow-ups`, { description: 'Pour l’équipe' })).json();
    const mine = (await call('prepose1', 'POST', `/notes/${normal.id}/follow-ups`,
      { description: 'Pour moi', assignedTo: ids.userId('prepose4') })).json();
    const other = (await call('prepose1', 'POST', `/notes/${normal.id}/follow-ups`,
      { description: 'Pour un autre', assignedTo: ids.userId('prepose2') })).json();

    const res = await call('prepose4', 'GET', '/handover');
    expect(res.statusCode).toBe(200);
    const h = res.json();

    // Dernière relève des données fictives : hier
    expect(Date.now() - Date.parse(h.since)).toBeGreaterThan(20 * 3_600_000);
    expect(h.lastHandoverAt).toBe(h.since);

    expect(noteIds(h)).toEqual(expect.arrayContaining([normal.id, priority.id]));
    const flags = h.notes.map((n: { isPriority: boolean }) => n.isPriority);
    expect(flags.indexOf(false) === -1 || flags.lastIndexOf(true) < flags.indexOf(false)).toBe(true);
    expect(h.counts.notes).toBe(h.notes.length);
    expect(h.counts.priority).toBe(flags.filter(Boolean).length);

    const fIds = h.followUps.map((f: { id: string }) => f.id);
    expect(fIds).toEqual(expect.arrayContaining([team.id, mine.id]));
    expect(fIds).not.toContain(other.id);
  });

  it('confirmation : la relève suivante part de generatedAt, sans perdre les notes écrites entre-temps', async () => {
    const before = await createNote();
    const first = (await call('prepose4', 'GET', '/handover')).json();
    expect(noteIds(first)).toContain(before.id);

    const during = await createNote();   // écrite après la lecture, avant la confirmation
    const ack = await call('prepose4', 'POST', '/handover/ack', { seenUntil: first.generatedAt });
    expect(ack.statusCode).toBe(201);
    expect(ack.json().acknowledgedAt).toBe(first.generatedAt);

    const next = (await call('prepose4', 'GET', '/handover')).json();
    expect(next.since).toBe(first.generatedAt);
    expect(noteIds(next)).not.toContain(before.id);
    expect(noteIds(next)).toContain(during.id);
  });

  it('seenUntil dans le futur : 400', async () => {
    const res = await call('prepose4', 'POST', '/handover/ack', { seenUntil: new Date(Date.now() + 3_600_000).toISOString() });
    expect(res.statusCode).toBe(400);
  });

  it('admin plateforme : 403', async () => {
    expect((await call('admin', 'GET', '/handover')).statusCode).toBe(403);
  });
});
