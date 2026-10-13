// Messagerie interne : conversations privées, groupes, canal d'équipe,
// annonces ; non-lus ; correction et retrait (15 min, rien n'est supprimé) ;
// consultation tracée par la responsable ; isolation entre résidences.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, ensureResidenceB, loginAll, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['prepose1', 'prepose2', 'prepose3', 'prepose4', 'infirmiere', 'responsable', 'prepose-b']));
  ids = await seedIds(app);
});

afterAll(async () => { await app.close(); });

type Conv = { id: string; kind: string; title: string; unreadCount: number; pendingAcks: number; canPost: boolean };
const list = async (who: string): Promise<Conv[]> => (await call(who, 'GET', '/conversations')).json();
const channel = async (who: string, kind: string) => (await list(who)).find((c) => c.kind === kind)!;
const send = (who: string, conversationId: string, body: string) =>
  call(who, 'POST', `/conversations/${conversationId}/messages`, { body });
const messages = async (who: string, conversationId: string) =>
  (await call(who, 'GET', `/conversations/${conversationId}/messages`)).json().items;

describe('conversations', () => {
  it('chacun voit les canaux Équipe et Annonces', async () => {
    const kinds = (await list('prepose3')).map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['team', 'announcements']));
  });

  it('privée : une seule par paire, retrouvée par les deux', async () => {
    const a = await call('prepose3', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose4') });
    expect(a.statusCode).toBe(201);
    expect(a.json().title).toBe('Carmen Lopez');
    const b = await call('prepose4', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose3') });
    expect(b.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(b.json().title).toBe('Julien Roy');
  });

  it('privée avec soi-même ou avec un employé d’une autre résidence : 400', async () => {
    expect((await call('prepose3', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose3') })).statusCode).toBe(400);
    const other = await app.db.selectFrom('users').select('id').where('email', '=', 'prepose-b@exemple.test').executeTakeFirstOrThrow();
    expect((await call('prepose3', 'POST', '/conversations', { kind: 'direct', userId: other.id })).statusCode).toBe(400);
  });

  it('groupe : créer, ajouter, quitter ; un non-membre ne le voit pas (404)', async () => {
    const g = (await call('prepose1', 'POST', '/conversations', {
      kind: 'group', title: '  Sorties du samedi ', memberIds: [ids.userId('prepose2')],
    })).json();
    expect(g).toMatchObject({ kind: 'group', title: 'Sorties du samedi', memberCount: 2 });
    expect((await call('prepose3', 'GET', `/conversations/${g.id}`)).statusCode).toBe(404);
    expect((await send('prepose3', g.id, 'Intrus')).statusCode).toBe(404);

    const added = (await call('prepose2', 'POST', `/conversations/${g.id}/members`, { userIds: [ids.userId('prepose3')] })).json();
    expect(added.memberCount).toBe(3);
    expect((await call('prepose3', 'GET', `/conversations/${g.id}`)).statusCode).toBe(200);

    expect((await call('prepose3', 'POST', `/conversations/${g.id}/leave`)).statusCode).toBe(204);
    expect((await call('prepose3', 'GET', `/conversations/${g.id}`)).statusCode).toBe(404);
    expect((await call('prepose1', 'PATCH', `/conversations/${g.id}`, { title: 'Sorties' })).json().title).toBe('Sorties');
  });
});

describe('messages et non-lus', () => {
  it('envoyer, recevoir, non-lus, marquer lu ; l’auteur n’a pas de non-lu', async () => {
    const conv = (await call('prepose1', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose3') })).json();
    const sent = await send('prepose1', conv.id, '  Bonjour Julien,\nça va ?  ');
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ body: 'Bonjour Julien,\nça va ?', mine: true });
    expect(sent.json().editableUntil).not.toBeNull();

    expect((await list('prepose1')).find((c) => c.id === conv.id)!.unreadCount).toBe(0);
    expect((await list('prepose3')).find((c) => c.id === conv.id)!.unreadCount).toBe(1);
    const summary = (await call('prepose3', 'GET', '/messaging/summary')).json();
    expect(summary.unread).toBeGreaterThanOrEqual(1);

    const items = await messages('prepose3', conv.id);
    expect(items.at(-1)).toMatchObject({ mine: false, editableUntil: null, author: { firstName: 'Marc' } });
    expect((await call('prepose3', 'POST', `/conversations/${conv.id}/read`)).statusCode).toBe(204);
    expect((await list('prepose3')).find((c) => c.id === conv.id)!.unreadCount).toBe(0);
  });

  it('message vide : 400', async () => {
    const team = await channel('prepose1', 'team');
    expect((await send('prepose1', team.id, '   \n  ')).statusCode).toBe(400);
  });

  it('pagination : les plus récents d’abord, puis les plus anciens avec le curseur', async () => {
    const conv = (await call('prepose2', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose4') })).json();
    for (let i = 1; i <= 5; i++) await send('prepose2', conv.id, `Message ${i}`);
    const first = (await call('prepose4', 'GET', `/conversations/${conv.id}/messages?limit=3`)).json();
    expect(first.items.map((m: { body: string }) => m.body)).toEqual(['Message 3', 'Message 4', 'Message 5']);
    const older = (await call('prepose4', 'GET', `/conversations/${conv.id}/messages?limit=3&before=${encodeURIComponent(first.nextCursor)}`)).json();
    expect(older.items.map((m: { body: string }) => m.body)).toEqual(['Message 1', 'Message 2']);
    expect(older.nextCursor).toBeNull();
  });
});

describe('corriger et retirer (15 minutes)', () => {
  it('corriger garde l’ancien texte ; retirer masque le message sans le supprimer', async () => {
    const team = await channel('prepose1', 'team');
    const m = (await send('prepose1', team.id, 'Réunion à 14 h')).json();

    expect((await call('prepose2', 'PATCH', `/messages/${m.id}`, { body: 'Piraté' })).statusCode).toBe(403);
    const edited = (await call('prepose1', 'PATCH', `/messages/${m.id}`, { body: 'Réunion à 15 h' })).json();
    expect(edited).toMatchObject({ body: 'Réunion à 15 h' });
    expect(edited.editedAt).not.toBeNull();

    const retracted = (await call('prepose1', 'POST', `/messages/${m.id}/retract`)).json();
    expect(retracted.body).toBeNull();
    expect((await messages('prepose2', team.id)).find((x: { id: string }) => x.id === m.id).body).toBeNull();

    const row = await app.db.selectFrom('messages').select(['body', 'retracted_at']).where('id', '=', m.id).executeTakeFirstOrThrow();
    expect(row.body).toBe('Réunion à 15 h');     // conservé
    const versions = await app.db.selectFrom('message_versions').select('previous_body').where('message_id', '=', m.id).execute();
    expect(versions.map((v) => v.previous_body)).toEqual(['Réunion à 14 h']);
    expect((await call('prepose1', 'POST', `/messages/${m.id}/retract`)).statusCode).toBe(409);
  });

  it('après 15 minutes : 409', async () => {
    const team = await channel('prepose1', 'team');
    const m = (await send('prepose1', team.id, 'Ancien message')).json();
    await app.db.updateTable('messages').set({ created_at: new Date(Date.now() - 16 * 60_000) }).where('id', '=', m.id).execute();
    const res = await call('prepose1', 'PATCH', `/messages/${m.id}`, { body: 'Trop tard' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('edit_window_over');
    expect((await messages('prepose1', team.id)).find((x: { id: string }) => x.id === m.id).editableUntil).toBeNull();
  });
});

describe('annonces', () => {
  it('seules l’infirmière et la responsable publient', async () => {
    const ann = await channel('prepose1', 'announcements');
    expect(ann.canPost).toBe(false);
    expect((await send('prepose1', ann.id, 'Test')).statusCode).toBe(403);
    expect((await channel('infirmiere', 'announcements')).canPost).toBe(true);
  });

  it('chacun confirme sa lecture ; la direction voit qui manque', async () => {
    const ann = await channel('responsable', 'announcements');
    const m = (await send('responsable', ann.id, 'Nouvelle procédure : gants obligatoires pour les soins.')).json();
    expect(m.ack).toMatchObject({ ackedByMe: true, count: 0 });

    const summary = (await call('prepose2', 'GET', '/messaging/summary')).json();
    expect(summary.announcements.map((a: { id: string }) => a.id)).toContain(m.id);
    expect((await channel('prepose2', 'announcements')).pendingAcks).toBeGreaterThanOrEqual(1);

    expect((await call('prepose2', 'POST', `/messages/${m.id}/ack`)).statusCode).toBe(204);
    expect((await call('prepose2', 'POST', `/messages/${m.id}/ack`)).statusCode).toBe(204);   // idempotent
    const after = (await call('prepose2', 'GET', '/messaging/summary')).json();
    expect(after.announcements.map((a: { id: string }) => a.id)).not.toContain(m.id);

    const acks = (await call('responsable', 'GET', `/messages/${m.id}/acks`)).json();
    expect(acks.acked.map((a: { user: { firstName: string } }) => a.user.firstName)).toEqual(['Fatou']);
    expect(acks.pending.map((u: { firstName: string }) => u.firstName)).toContain('Marc');
    expect(acks.pending.map((u: { firstName: string }) => u.firstName)).not.toContain('Sophie');   // l'autrice
    expect((await call('prepose1', 'GET', `/messages/${m.id}/acks`)).statusCode).toBe(403);
  });

  it('confirmer un message qui n’est pas une annonce : 400', async () => {
    const team = await channel('prepose1', 'team');
    const m = (await send('prepose1', team.id, 'Pas une annonce')).json();
    expect((await call('prepose2', 'POST', `/messages/${m.id}/ack`)).statusCode).toBe(400);
  });
});

describe('consultation par la responsable', () => {
  it('liste sans contenu ; consultation avec motif, tout compris, inscrite au journal d’audit', async () => {
    const conv = (await call('prepose3', 'POST', '/conversations', { kind: 'direct', userId: ids.userId('prepose2') })).json();
    const m = (await send('prepose3', conv.id, 'Texte d’origine')).json();
    await call('prepose3', 'PATCH', `/messages/${m.id}`, { body: 'Texte corrigé' });
    await call('prepose3', 'POST', `/messages/${m.id}/retract`);

    expect((await call('infirmiere', 'GET', '/admin/conversations')).statusCode).toBe(403);
    const listed = (await call('responsable', 'GET', '/admin/conversations')).json();
    const entry = listed.find((c: { id: string }) => c.id === conv.id);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('lastMessage');
    expect((await call('responsable', 'GET', `/conversations/${conv.id}`)).statusCode).toBe(404);   // pas membre

    expect((await call('responsable', 'POST', `/admin/conversations/${conv.id}/consult`, { reason: 'court' })).statusCode).toBe(400);
    const res = await call('responsable', 'POST', `/admin/conversations/${conv.id}/consult`, { reason: 'Plainte reçue le 13 octobre' });
    expect(res.statusCode).toBe(200);
    const msg = res.json().messages.find((x: { id: string }) => x.id === m.id);
    expect(msg).toMatchObject({ body: 'Texte corrigé' });
    expect(msg.retractedAt).not.toBeNull();
    expect(msg.versions.map((v: { body: string }) => v.body)).toEqual(['Texte d’origine']);

    const log = await app.db.selectFrom('audit_log').select(['action', 'details'])
      .where('entity', '=', 'conversation').where('entity_id', '=', conv.id).where('action', '=', 'consult')
      .executeTakeFirstOrThrow();
    expect(log.details).toMatchObject({ reason: 'Plainte reçue le 13 octobre' });
  });
});

describe('isolation', () => {
  it('une autre résidence ne voit ni les conversations ni les messages', async () => {
    const team = await channel('prepose1', 'team');
    expect((await call('prepose-b', 'GET', `/conversations/${team.id}/messages`)).statusCode).toBe(404);
    expect((await send('prepose-b', team.id, 'Bonjour')).statusCode).toBe(404);
    const theirs = await list('prepose-b');
    expect(theirs.map((c) => c.id)).not.toContain(team.id);
    expect(theirs.map((c) => c.kind)).toEqual(expect.arrayContaining(['team', 'announcements']));   // créés au premier usage
  });
});
