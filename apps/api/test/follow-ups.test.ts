import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, ensureResidenceB, loginAll, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['prepose1', 'prepose2', 'infirmiere', 'prepose-b']));
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

async function createNote() {
  const res = await call('prepose1', 'POST', '/notes', {
    occurredAt: new Date().toISOString(), categoryId: ids.categoryId, residentId: ids.residentId,
    description: 'Chute dans le corridor, sans blessure apparente.',
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function createFollowUp(payload: object = {}) {
  const note = await createNote();
  const res = await call('prepose1', 'POST', `/notes/${note.id}/follow-ups`, {
    description: 'Surveiller la mobilité pendant 48 h', ...payload,
  });
  expect(res.statusCode, res.body).toBe(201);
  return { note, followUp: res.json() };
}

describe('création', () => {
  it('rattaché à la note, signé, pour toute l’équipe par défaut', async () => {
    const { note, followUp } = await createFollowUp();
    expect(followUp).toMatchObject({
      description: 'Surveiller la mobilité pendant 48 h',
      assignedTo: null, closedAt: null, isOverdue: false,
      createdBy: { firstName: 'Marc' },
      note: { id: note.id },
      resident: { id: ids.residentId },
    });
    const detail = (await call('prepose1', 'GET', `/notes/${note.id}`)).json();
    expect(detail.followUps.map((f: { id: string }) => f.id)).toEqual([followUp.id]);
  });

  it('échéance dépassée : en retard', async () => {
    const { followUp } = await createFollowUp({ dueAt: new Date(Date.now() - 3_600_000).toISOString() });
    expect(followUp.isOverdue).toBe(true);
  });

  it('refuse un employé d’une autre résidence', async () => {
    const other = await app.db.selectFrom('users').select('id').where('email', '=', 'prepose-b@exemple.test').executeTakeFirstOrThrow();
    const note = await createNote();
    const res = await call('prepose1', 'POST', `/notes/${note.id}/follow-ups`, { description: 'x', assignedTo: other.id });
    expect(res.json().error).toBe('invalid_assignee');
  });

  it('refuse une note annulée', async () => {
    const note = await createNote();
    await call('prepose1', 'POST', `/notes/${note.id}/cancel`, { reason: 'Erreur de saisie' });
    expect((await call('prepose1', 'POST', `/notes/${note.id}/follow-ups`, { description: 'x' })).statusCode).toBe(409);
  });
});

describe('liste', () => {
  it('« assignés à moi »', async () => {
    const { followUp } = await createFollowUp({ assignedTo: ids.userId('prepose2') });
    const mine = async (who: string) => (await call(who, 'GET', '/follow-ups?assignedTo=me')).json()
      .map((f: { id: string }) => f.id);
    expect(await mine('prepose2')).toContain(followUp.id);
    expect(await mine('prepose1')).not.toContain(followUp.id);
  });

  it('ouverts d’abord par échéance la plus proche', async () => {
    const list = (await call('prepose1', 'GET', '/follow-ups')).json() as { dueAt: string | null; closedAt: string | null }[];
    expect(list.every((f) => f.closedAt === null)).toBe(true);
    const dated = list.map((f) => f.dueAt).filter((d): d is string => d !== null);
    expect([...dated].sort()).toEqual(dated);
  });
});

describe('modification et fermeture', () => {
  it('modifier, fermer avec une note, puis plus rien ne change', async () => {
    const { followUp } = await createFollowUp();
    const url = `/follow-ups/${followUp.id}`;

    const edited = await call('prepose2', 'PATCH', url, { assignedTo: ids.userId('infirmiere'), description: 'Revoir la marche' });
    expect(edited.json()).toMatchObject({ description: 'Revoir la marche', assignedTo: { firstName: 'Nadia' } });

    const closed = await call('infirmiere', 'POST', `${url}/close`, { closingNote: 'Marche normale.' });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ closingNote: 'Marche normale.', closedBy: { firstName: 'Nadia' } });

    expect((await call('prepose1', 'POST', `${url}/close`, {})).statusCode).toBe(409);
    expect((await call('prepose1', 'PATCH', url, { description: 'x' })).statusCode).toBe(409);

    const open = (await call('prepose1', 'GET', '/follow-ups')).json().map((f: { id: string }) => f.id);
    const closedList = (await call('prepose1', 'GET', '/follow-ups?status=closed')).json().map((f: { id: string }) => f.id);
    expect(open).not.toContain(followUp.id);
    expect(closedList).toContain(followUp.id);

    const actions = await app.db.selectFrom('audit_log').select('action')
      .where('entity', '=', 'follow_up').where('entity_id', '=', followUp.id).orderBy('id').execute();
    expect(actions.map((a) => a.action)).toEqual(['create', 'update', 'close']);
  });

  it('autre résidence : 404', async () => {
    const { followUp } = await createFollowUp();
    expect((await call('prepose-b', 'GET', `/follow-ups/${followUp.id}`)).statusCode).toBe(404);
    expect((await call('prepose-b', 'POST', `/follow-ups/${followUp.id}/close`, {})).statusCode).toBe(404);
  });
});
