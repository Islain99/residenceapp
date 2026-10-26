// Plateforme : réglage des fonctionnalités d'une résidence par rôle.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { FORMULAS } from '../src/lib/features.js';
import { bearer, buildTestApp, caller, loginAll, loginAs, outbox, RESIDENCE_A } from './helpers.js';

let app: App;
let admin: string;
let call: ReturnType<typeof caller>;
const url = `/platform/residences/${RESIDENCE_A}/features`;

beforeAll(async () => {
  app = await buildTestApp();
  admin = await loginAs(app, 'admin@exemple.test');
  call = caller(app, await loginAll(app, ['responsable', 'prepose1', 'prepose2']));
});

afterEach(async () => {
  await app.db.updateTable('residence_features').set({ level: null }).execute();
  app.features.invalidate(RESIDENCE_A);
  outbox(app).length = 0;
});

afterAll(async () => { await app.close(); });

const get = () => app.inject({ method: 'GET', url, headers: bearer(admin) });
const put = (payload: object) => app.inject({ method: 'PUT', url, headers: bearer(admin), payload });

describe('lecture', () => {
  it('sans réglage : formule Complète, catalogue et niveaux par rôle', async () => {
    const res = await get();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.formula).toBe('complete');
    expect(body.settings).toEqual({});
    expect(body.effective.prepose).toMatchObject({ journal: 'full', residents: 'read', priority: 'off' });
    expect(body.catalogue.find((c: { key: string }) => c.key === 'stats')).toMatchObject({ levels: ['off', 'read'] });
    expect(Object.keys(body.formulas)).toEqual(['complete', 'essential', 'nurseJournal']);
  });

  it('réservé à l’administration de la plateforme', async () => {
    expect((await call('responsable', 'GET', url)).statusCode).toBe(403);
  });
});

describe('enregistrement', () => {
  it('formule Journal infirmier : appliquée tout de suite, tracée, responsable prévenue', async () => {
    const res = await put({ settings: FORMULAS.nurseJournal, acceptCascade: true });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.formula).toBe('nurseJournal');
    expect(body.changes).toEqual(expect.arrayContaining([
      { role: 'prepose', feature: 'journal', from: 'full', to: 'read' },
      { role: 'prepose', feature: 'residents', from: 'read', to: 'off' },
      { role: 'prepose', feature: 'dictation', from: 'full', to: 'off' },   // conséquence acceptée
    ]));
    // Effet immédiat pour les préposés
    expect((await call('prepose1', 'GET', '/features')).json().features).toMatchObject({ journal: 'read', residents: 'off' });

    // Journal d'audit de la résidence
    const entry = await app.db.selectFrom('audit_log').select(['details', 'residence_id'])
      .where('action', '=', 'feature_update').orderBy('at', 'desc').executeTakeFirstOrThrow();
    expect(entry.residence_id).toBe(RESIDENCE_A);
    expect((entry.details as { changes: unknown[] }).changes.length).toBe(body.changes.length);

    // Un courriel par responsable active, sans nom de résident
    expect(body.notified).toBe(1);
    const mail = outbox(app).find((m) => m.to === 'responsable@exemple.test')!;
    expect(mail.subject).toContain('Fonctionnalités modifiées');
    expect(mail.text).toContain('Préposés — Journal : Complet → Consultation');

    // Le tableau de bord affiche la formule
    const list = await app.inject({ method: 'GET', url: '/platform/residences', headers: bearer(admin) });
    expect(list.json().find((r: { id: string }) => r.id === RESIDENCE_A).formula).toBe('nurseJournal');
  });

  it('dépendance : refus avec la liste des conséquences, puis accord', async () => {
    const settings = { journal: { infirmiere: 'off' } };
    const res = await put({ settings });
    expect(res.statusCode).toBe(409);
    expect(res.json().conflicts).toEqual(expect.arrayContaining([
      { role: 'infirmiere', feature: 'handover', requested: 'full', effective: 'off' },
      { role: 'infirmiere', feature: 'stats', requested: 'read', effective: 'off' },
    ]));
    expect((await get()).json().formula).toBe('complete');   // rien d'enregistré

    const ok = await put({ settings, acceptCascade: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.handover).toEqual({ infirmiere: 'off' });   // conséquence enregistrée telle quelle
    expect(ok.json().formula).toBe('custom');
  });

  it('niveau impossible ou au-dessus du rôle : refusé', async () => {
    expect((await put({ settings: { messaging: { prepose: 'read' } } })).json().error).toBe('invalid_level');
    expect((await put({ settings: { residents: { prepose: 'full' } } })).json().error).toBe('invalid_level');
    expect((await put({ settings: { priority: { prepose: 'full' } } })).json().error).toBe('invalid_level');
    expect((await put({ settings: { inconnu: { prepose: 'off' } } })).json().error).toBe('unknown_feature');
  });

  it('retour à Complète : valeurs par défaut, rien de stocké', async () => {
    await put({ settings: { agenda: { prepose: 'read' } } });
    const res = await put({ settings: {} });
    expect(res.json()).toMatchObject({ formula: 'complete', settings: {} });
    expect(res.json().changes).toEqual([{ role: 'prepose', feature: 'agenda', from: 'read', to: 'full' }]);
  });

  it('aucun changement : ni audit ni courriel', async () => {
    const before = await app.db.selectFrom('audit_log').select((eb) => eb.fn.countAll<string>().as('c'))
      .where('action', '=', 'feature_update').executeTakeFirstOrThrow();
    const res = await put({ settings: {} });
    expect(res.json()).toMatchObject({ changes: [], notified: 0 });
    const after = await app.db.selectFrom('audit_log').select((eb) => eb.fn.countAll<string>().as('c'))
      .where('action', '=', 'feature_update').executeTakeFirstOrThrow();
    expect(after.c).toBe(before.c);
    expect(outbox(app)).toHaveLength(0);
  });
});

describe('exceptions pour une personne', () => {
  let ids: Awaited<ReturnType<typeof import('./helpers.js')['seedIds']>>;
  beforeAll(async () => { ids = await (await import('./helpers.js')).seedIds(app); });
  afterEach(async () => {
    await app.db.updateTable('user_features').set({ revoked_at: new Date(), revoke_reason: 'removed' })
      .where('revoked_at', 'is', null).execute();
    await app.db.updateTable('users').set({ role: 'prepose' }).where('email', '=', 'prepose2@exemple.test').execute();
    app.features.invalidate(RESIDENCE_A);
  });

  const except = (who: string, payload: object) => app.inject({
    method: 'PUT', url: `${url}/users/${ids.userId(who)}`, headers: bearer(admin), payload,
  });

  it('un préposé écrit au journal alors que les autres le consultent ; tracé, responsable prévenue', async () => {
    await put({ settings: FORMULAS.nurseJournal, acceptCascade: true });
    outbox(app).length = 0;
    const res = await except('prepose1', { feature: 'journal', level: 'full', reason: 'Formé au journal' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.exceptions).toEqual([expect.objectContaining({
      feature: 'journal', level: 'full', roleLevel: 'read', effective: 'full', reason: 'Formé au journal',
      user: expect.objectContaining({ id: ids.userId('prepose1'), role: 'prepose' }),
    })]);
    expect(body.notified).toBe(1);
    expect(outbox(app)[0]!.text).toContain('Exception pour');
    expect(outbox(app)[0]!.text).toContain('Journal : Consultation → Complet (motif : Formé au journal)');
    expect((await call('prepose1', 'POST', '/notes', {
      occurredAt: new Date().toISOString(), categoryId: ids.categoryId, description: 'Note par exception',
    })).statusCode).toBe(201);
    const entry = await app.db.selectFrom('audit_log').select(['details', 'entity_id'])
      .where('action', '=', 'feature_exception').orderBy('at', 'desc').executeTakeFirstOrThrow();
    expect(entry.entity_id).toBe(ids.userId('prepose1'));
    expect(entry.details).toMatchObject({ feature: 'journal', from: 'read', to: 'full' });
  });

  it('remplacer puis retirer : une seule exception en cours, retour au niveau du rôle', async () => {
    await except('prepose2', { feature: 'agenda', level: 'off' });
    const res = await except('prepose2', { feature: 'agenda', level: 'read' });
    expect(res.json().exceptions).toHaveLength(1);
    expect(res.json().exceptions[0].level).toBe('read');
    const revoke = await app.inject({
      method: 'POST', url: `${url}/exceptions/${res.json().exceptions[0].id}/revoke`, headers: bearer(admin),
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(revoke.json().exceptions).toEqual([]);
    expect(outbox(app).at(-1)!.text).toContain('Exception retirée');
    const again = await app.inject({ method: 'POST', url: `${url}/exceptions/${res.json().exceptions[0].id}/revoke`, headers: bearer(admin) });
    expect(again.statusCode).toBe(404);
  });

  it('refus : même niveau que le rôle, au-dessus du rôle, dépendance manquante, employé d’une autre résidence', async () => {
    expect((await except('prepose1', { feature: 'journal', level: 'full' })).json().error).toBe('exception_same_as_role');
    expect((await except('prepose1', { feature: 'residents', level: 'full' })).json().error).toBe('invalid_level');
    await put({ settings: FORMULAS.nurseJournal, acceptCascade: true });
    expect((await except('prepose1', { feature: 'dictation', level: 'full' })).json().error).toBe('exception_blocked');
    const other = await app.db.selectFrom('users').select('id').where('email', '=', 'prepose-b@exemple.test').executeTakeFirst();
    if (other) {
      const res = await app.inject({ method: 'PUT', url: `${url}/users/${other.id}`, headers: bearer(admin), payload: { feature: 'agenda', level: 'off' } });
      expect(res.json().error).toBe('invalid_user');
    }
  });

  it('changement de rôle par la responsable : exceptions retirées et tracées', async () => {
    await except('prepose2', { feature: 'messaging', level: 'off' });
    expect((await call('prepose2', 'GET', '/features')).json().features.messaging).toBe('off');
    const res = await call('responsable', 'PATCH', `/users/${ids.userId('prepose2')}`, { role: 'infirmiere' });
    expect(res.statusCode, res.body).toBe(200);
    const left = await app.db.selectFrom('user_features').select(['revoke_reason'])
      .where('user_id', '=', ids.userId('prepose2')).where('feature', '=', 'messaging').orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    expect(left.revoke_reason).toBe('role_changed');
    const entry = await app.db.selectFrom('audit_log').select('details')
      .where('action', '=', 'feature_exception_revoke').orderBy('at', 'desc').executeTakeFirstOrThrow();
    expect(entry.details).toMatchObject({ reason: 'role_changed', from: 'prepose', to: 'infirmiere', features: ['messaging'] });
    expect((await get()).json().exceptions).toEqual([]);
  });

  it('liste des employés pour choisir une personne (sans administrateur)', async () => {
    const staff = (await get()).json().staff as { role: string }[];
    expect(staff.length).toBeGreaterThan(2);
    expect(staff.every((u) => ['prepose', 'infirmiere', 'responsable'].includes(u.role))).toBe(true);
  });
});
