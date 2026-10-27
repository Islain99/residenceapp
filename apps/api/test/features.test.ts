// Fonctionnalités activables par résidence : calcul des niveaux (catalogue,
// plafond du rôle, dépendances, exceptions, formules) et GET /features.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import {
  effectiveFeatures, FEATURE_KEYS, FEATURE_ROLES, FEATURES, FeatureStore, FORMULAS, formulaOf, type Level,
} from '../src/lib/features.js';
import { bearer, buildTestApp, caller, ensureResidenceB, loginAll, loginAs, RESIDENCE_A, RESIDENCE_B, seedIds } from './helpers.js';

describe('calcul des niveaux', () => {
  it('sans réglage : le comportement d’avant (plafond de chaque rôle)', () => {
    expect(effectiveFeatures('prepose')).toMatchObject({
      handover: 'full', journal: 'full', priority: 'off', followUps: 'full', messaging: 'full',
      announcements: 'read', agenda: 'full', schedule: 'read', residents: 'read', stats: 'off', dictation: 'full',
    });
    expect(effectiveFeatures('infirmiere')).toMatchObject({ priority: 'full', residents: 'full', stats: 'read', schedule: 'read' });
    expect(effectiveFeatures('responsable')).toMatchObject({ schedule: 'full', announcements: 'full', stats: 'read' });
  });

  it('un réglage ne donne jamais plus que le rôle', () => {
    const levels = effectiveFeatures('prepose', { residents: { prepose: 'full' }, priority: { prepose: 'full' }, stats: { prepose: 'read' } });
    expect(levels).toMatchObject({ residents: 'read', priority: 'off', stats: 'off' });
  });

  it('un niveau absent du module est ramené au niveau possible en dessous', () => {
    expect(effectiveFeatures('prepose', { messaging: { prepose: 'read' } }).messaging).toBe('off');
    expect(effectiveFeatures('infirmiere', { stats: { infirmiere: 'full' } }).stats).toBe('read');
  });

  it('dépendances : Journal masqué → Relève, Dictée, Consignes et Statistiques masquées', () => {
    const levels = effectiveFeatures('infirmiere', { journal: { infirmiere: 'off' } });
    expect(levels).toMatchObject({ journal: 'off', handover: 'off', dictation: 'off', priority: 'off', stats: 'off' });
    expect(levels.followUps).toBe('full');   // les suivis ne dépendent pas du journal pour être consultés
  });

  it('Journal en consultation : pas de dictée ni de consignes, la relève reste', () => {
    const levels = effectiveFeatures('infirmiere', { journal: { infirmiere: 'read' } });
    expect(levels).toMatchObject({ journal: 'read', handover: 'full', dictation: 'off', priority: 'off', stats: 'read' });
  });

  it('Résidents masqués → Statistiques masquées', () => {
    expect(effectiveFeatures('responsable', { residents: { responsable: 'off' } }).stats).toBe('off');
  });

  it('Annonces : visibles par la messagerie ou par la relève, masquées sans les deux', () => {
    expect(effectiveFeatures('prepose', { messaging: { prepose: 'off' } }).announcements).toBe('read');
    expect(effectiveFeatures('prepose', { handover: { prepose: 'off' } }).announcements).toBe('read');
    expect(effectiveFeatures('prepose', { messaging: { prepose: 'off' }, journal: { prepose: 'off' } }).announcements).toBe('off');
  });

  it('une exception remplace le réglage du rôle, dans les deux sens, sans dépasser le rôle', () => {
    const settings = { journal: { prepose: 'read' as Level } };
    expect(effectiveFeatures('prepose', settings).journal).toBe('read');
    expect(effectiveFeatures('prepose', settings, { journal: 'full' }).journal).toBe('full');
    expect(effectiveFeatures('prepose', {}, { messaging: 'off' }).messaging).toBe('off');
    expect(effectiveFeatures('prepose', {}, { residents: 'full' }).residents).toBe('read');
  });

  it('chaque module : niveaux possibles valides et défaut proposé', () => {
    for (const key of FEATURE_KEYS) {
      const def = FEATURES[key];
      expect(def.levels[0], key).toBe('off');
      for (const role of FEATURE_ROLES) expect(def.levels, `${key}/${role}`).toContain(def.ceiling[role]);
    }
  });

  it('formules reconnues, sinon « Personnalisée »', () => {
    expect(formulaOf({})).toBe('complete');
    expect(formulaOf(FORMULAS.essential)).toBe('essential');
    expect(formulaOf(FORMULAS.nurseJournal)).toBe('nurseJournal');
    // Même résultat écrit autrement (réglage égal au défaut) : toujours « Complète »
    expect(formulaOf({ journal: { prepose: 'full' } })).toBe('complete');
    expect(formulaOf({ agenda: { prepose: 'read' } })).toBe('custom');
  });

  it('formule Journal infirmier : les préposés consultent le journal, sans fiches', () => {
    const levels = effectiveFeatures('prepose', FORMULAS.nurseJournal);
    expect(levels).toMatchObject({ journal: 'read', residents: 'off', followUps: 'full', handover: 'full', dictation: 'off' });
    expect(effectiveFeatures('infirmiere', FORMULAS.nurseJournal).journal).toBe('full');
  });
});

describe('GET /features', () => {
  let app: App;
  let call: ReturnType<typeof caller>;
  let ids: Awaited<ReturnType<typeof seedIds>>;

  beforeAll(async () => {
    app = await buildTestApp();
    await ensureResidenceB(app);
    call = caller(app, await loginAll(app, ['responsable', 'infirmiere', 'prepose1', 'prepose2', 'prepose-b']));
    ids = await seedIds(app);
  });

  afterAll(async () => {
    // Résidence A remise comme avant pour les autres fichiers de tests
    await app.db.updateTable('residence_features').set({ level: null }).execute();
    await app.db.updateTable('user_features').set({ revoked_at: new Date(), revoke_reason: 'removed' })
      .where('revoked_at', 'is', null).execute();
    await app.close();
  });

  const setRole = async (residenceId: string, feature: string, role: string, level: Level | null) => {
    await app.db.insertInto('residence_features').values({ residence_id: residenceId, feature, role, level })
      .onConflict((oc) => oc.columns(['residence_id', 'feature', 'role']).doUpdateSet({ level }))
      .execute();
    app.features.invalidate(residenceId);
  };

  it('sans réglage : tous les modules, comme avant', async () => {
    const res = await call('prepose1', 'GET', '/features');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().features).toEqual(effectiveFeatures('prepose'));
    expect(res.json().locked).toContain('audit');
  });

  it('réglage par rôle : seulement ce rôle, seulement cette résidence', async () => {
    await setRole(RESIDENCE_A, 'journal', 'prepose', 'read');
    await setRole(RESIDENCE_A, 'residents', 'prepose', 'off');
    expect((await call('prepose1', 'GET', '/features')).json().features).toMatchObject({ journal: 'read', residents: 'off', dictation: 'off' });
    expect((await call('infirmiere', 'GET', '/features')).json().features).toMatchObject({ journal: 'full', residents: 'full' });
    expect((await call('prepose-b', 'GET', '/features')).json().features).toMatchObject({ journal: 'full', residents: 'read' });
  });

  it('retour à la valeur par défaut (level NULL)', async () => {
    await setRole(RESIDENCE_A, 'residents', 'prepose', null);
    expect((await call('prepose1', 'GET', '/features')).json().features.residents).toBe('read');
  });

  it('exception pour une personne : elle seule, tant qu’elle n’est pas retirée', async () => {
    const [exception] = await app.db.insertInto('user_features').values({
      residence_id: RESIDENCE_A, user_id: ids.userId('prepose1'), feature: 'journal', level: 'full', reason: 'formé au journal',
    }).returning('id').execute();
    app.features.invalidate(RESIDENCE_A);
    expect((await call('prepose1', 'GET', '/features')).json().features).toMatchObject({ journal: 'full', dictation: 'full' });
    expect((await call('prepose2', 'GET', '/features')).json().features.journal).toBe('read');

    await app.db.updateTable('user_features').set({ revoked_at: new Date(), revoke_reason: 'removed' })
      .where('id', '=', exception!.id).execute();
    app.features.invalidate(RESIDENCE_A);
    expect((await call('prepose1', 'GET', '/features')).json().features.journal).toBe('read');
  });

  it('une seule exception en cours par personne et par module', async () => {
    const row = { residence_id: RESIDENCE_A, user_id: ids.userId('prepose2'), feature: 'agenda', level: 'off' };
    await app.db.insertInto('user_features').values(row).execute();
    await expect(app.db.insertInto('user_features').values(row).execute()).rejects.toThrow();
  });

  it('une exception enregistrée pour une autre résidence est ignorée', async () => {
    await app.db.insertInto('user_features').values({
      residence_id: RESIDENCE_B, user_id: ids.userId('infirmiere'), feature: 'messaging', level: 'off',
    }).execute();
    app.features.invalidate(RESIDENCE_A);
    app.features.invalidate(RESIDENCE_B);
    expect((await call('infirmiere', 'GET', '/features')).json().features.messaging).toBe('full');
  });

  it('accès d’assistance : les niveaux de la responsable', async () => {
    await setRole(RESIDENCE_A, 'agenda', 'responsable', 'read');
    const resp = await loginAs(app, 'responsable@exemple.test');
    const grant = await app.inject({ method: 'POST', url: '/assistance', headers: bearer(resp), payload: { hours: 1 } });
    expect(grant.statusCode, grant.body).toBe(201);
    const admin = await loginAs(app, 'admin@exemple.test');
    const start = await app.inject({ method: 'POST', url: `/platform/assistance/${grant.json().id}/start`, headers: bearer(admin) });
    expect(start.statusCode, start.body).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/features', headers: bearer(start.json().accessToken) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().features.agenda).toBe('read');
    await app.inject({ method: 'POST', url: `/assistance/${grant.json().id}/revoke`, headers: bearer(resp) });
  });

  it('administration de la plateforme (sans résidence) : 403', async () => {
    const admin = await loginAs(app, 'admin@exemple.test');
    const res = await app.inject({ method: 'GET', url: '/features', headers: bearer(admin) });
    expect(res.statusCode).toBe(403);
  });

  it('sans connexion : 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/features' })).statusCode).toBe(401);
  });
});

describe('cache de 30 s', () => {
  it('un changement fait ailleurs est vu à l’expiration du cache, ou tout de suite après invalidate', async () => {
    const app = await buildTestApp();
    try {
      const store = new FeatureStore(app.db, 60_000);
      const userId = (await seedIds(app)).userId('prepose2');
      expect(await store.level(RESIDENCE_A, userId, 'prepose', 'agenda')).toBe('full');
      await app.db.insertInto('residence_features').values({ residence_id: RESIDENCE_A, feature: 'agenda', role: 'prepose', level: 'read' })
        .onConflict((oc) => oc.columns(['residence_id', 'feature', 'role']).doUpdateSet({ level: 'read' })).execute();
      expect(await store.level(RESIDENCE_A, userId, 'prepose', 'agenda')).toBe('full');   // encore en cache
      store.invalidate(RESIDENCE_A);
      expect(await store.level(RESIDENCE_A, userId, 'prepose', 'agenda')).toBe('read');

      const short = new FeatureStore(app.db, 0);   // cache expiré à chaque lecture
      await app.db.updateTable('residence_features').set({ level: null }).where('feature', '=', 'agenda').execute();
      expect(await short.level(RESIDENCE_A, userId, 'prepose', 'agenda')).toBe('full');
    } finally {
      await app.close();
    }
  });
});

describe('GET /features/residence', () => {
  it('la responsable voit les réglages de sa résidence et les exceptions ; les autres rôles non', async () => {
    const app = await buildTestApp();
    try {
      const call = caller(app, await loginAll(app, ['responsable', 'infirmiere']));
      const ids = await seedIds(app);
      await app.db.insertInto('residence_features').values({ residence_id: RESIDENCE_A, feature: 'journal', role: 'prepose', level: 'read' })
        .onConflict((oc) => oc.columns(['residence_id', 'feature', 'role']).doUpdateSet({ level: 'read' })).execute();
      await app.db.insertInto('user_features').values({
        residence_id: RESIDENCE_A, user_id: ids.userId('prepose1'), feature: 'journal', level: 'full', reason: 'Formé',
      }).execute();
      const res = await call('responsable', 'GET', '/features/residence');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().formula).toBe('custom');
      expect(res.json().effective.prepose.journal).toBe('read');
      expect(res.json().exceptions).toEqual([expect.objectContaining({ feature: 'journal', level: 'full', roleLevel: 'read', reason: 'Formé' })]);
      expect(res.json().exceptions[0].createdBy).toBeUndefined();
      expect((await call('infirmiere', 'GET', '/features/residence')).statusCode).toBe(403);
    } finally {
      await app.db.updateTable('residence_features').set({ level: null }).execute();
      await app.db.updateTable('user_features').set({ revoked_at: new Date(), revoke_reason: 'removed' }).where('revoked_at', 'is', null).execute();
      await app.close();
    }
  });
});
