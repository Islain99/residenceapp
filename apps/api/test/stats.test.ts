import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, ensureResidenceB, loginAll } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let residentId: string;
let categories: Record<string, string>;   // libellé → id

// Résident créé pour ces tests, notes datées hors de l'heure avancée (UTC-5,
// fuseau de la résidence America/Toronto) : résultats connus à l'avance.
const notes = [
  { at: '2019-12-15T10:00:00-05:00', label: 'Chute' },                                   // période précédente
  { at: '2020-01-10T03:30:00-05:00', label: 'Chute' },                                   // nuit
  { at: '2020-01-20T14:00:00-05:00', label: 'Chute' },                                   // après-midi
  { at: '2020-01-25T09:00:00-05:00', label: 'Visite', positive: true },                  // matin
  { at: '2020-01-31T23:30:00-05:00', label: 'Sommeil' },                                 // 1er février en UTC : reste en janvier
  { at: '2020-01-12T08:00:00-05:00', label: 'Santé', cancel: true },                     // annulée : ne compte pas
];

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['infirmiere', 'responsable', 'prepose1', 'prepose-b']));
  residentId = (await call('responsable', 'POST', '/residents', { firstName: 'Stat', lastName: 'Tistique' })).json().id;
  const list = (await call('infirmiere', 'GET', '/note-categories')).json() as { id: string; label: string }[];
  categories = Object.fromEntries(list.map((c) => [c.label, c.id]));

  for (const n of notes) {
    const res = await call('infirmiere', 'POST', '/notes', {
      occurredAt: n.at, categoryId: categories[n.label], residentId, description: `Note ${n.label}`,
      isPositive: n.positive ?? false, isPriority: n.label === 'Chute',
    });
    expect(res.statusCode, res.body).toBe(201);
    if (n.cancel) await call('infirmiere', 'POST', `/notes/${res.json().id}/cancel`, { reason: 'Erreur de saisie' });
  }
});

afterAll(async () => { await app.close(); });

const stats = (query: string, who = 'infirmiere') => call(who, 'GET', `/residents/${residentId}/stats?${query}`);

describe('statistiques du mois', () => {
  it('totaux comparés au mois précédent ; notes annulées exclues', async () => {
    const res = await stats('period=month&date=2020-01-15');
    expect(res.statusCode, res.body).toBe(200);
    const s = res.json();
    expect(s.period).toEqual({ unit: 'month', start: '2020-01-01', end: '2020-02-01', previousStart: '2019-12-01' });
    expect(s.totals).toEqual({ notes: 4, positive: 1, priority: 2, previousNotes: 1, previousPositive: 0, previousPriority: 1 });
    expect(s.resident).toMatchObject({ firstName: 'Stat', lastName: 'Tistique' });
  });

  it('par catégorie : toutes les catégories actives, même à zéro', async () => {
    const s = (await stats('period=month&date=2020-01-15')).json();
    const byLabel = Object.fromEntries(s.categories.map((c: { label: string; count: number; previousCount: number }) => [c.label, [c.count, c.previousCount]]));
    expect(byLabel).toMatchObject({ Chute: [2, 1], Visite: [1, 0], Sommeil: [1, 0], Santé: [0, 0], Hygiène: [0, 0] });
  });

  it('un point par jour, au jour local (23 h 30 le 31 reste le 31)', async () => {
    const s = (await stats('period=month&date=2020-01-15')).json();
    expect(s.timeline).toHaveLength(31);
    const day = (d: string) => s.timeline.find((t: { bucket: string }) => t.bucket === d);
    expect(day('2020-01-31')).toEqual({ bucket: '2020-01-31', total: 1, byCategory: { [categories.Sommeil!]: 1 } });
    expect(day('2020-01-10').total).toBe(1);
    expect(day('2020-01-12').total).toBe(0);   // annulée
  });

  it('moments de la journée à l’heure de la résidence', async () => {
    const s = (await stats('period=month&date=2020-01-15')).json();
    expect(s.timeOfDay).toEqual([
      { slot: 'nuit', count: 1 }, { slot: 'matin', count: 1 }, { slot: 'apres_midi', count: 1 }, { slot: 'soir', count: 1 },
    ]);
  });

  it('suivis et rendez-vous de la période', async () => {
    const s = (await stats('period=month&date=2020-01-15')).json();
    expect(s.followUps).toEqual({ opened: 0, closed: 0, openNow: 0 });
    expect(s.appointments).toBe(0);
  });
});

describe('statistiques de l’année', () => {
  it('douze points, un par mois ; comparaison avec l’année précédente', async () => {
    const s = (await stats('period=year&date=2020-06-01')).json();
    expect(s.period).toMatchObject({ unit: 'year', start: '2020-01-01', end: '2021-01-01', previousStart: '2019-01-01' });
    expect(s.timeline.map((t: { bucket: string }) => t.bucket)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2020-${String(i + 1).padStart(2, '0')}-01`));
    expect(s.timeline[0].total).toBe(4);
    expect(s.timeline[1].total).toBe(0);
    expect(s.totals).toMatchObject({ notes: 4, previousNotes: 1 });
  });

  it('période par défaut : le mois en cours', async () => {
    const s = (await stats('')).json();
    expect(s.period.unit).toBe('month');
    expect(s.period.start.endsWith('-01')).toBe(true);
  });
});

describe('accès', () => {
  it('infirmière et responsable seulement ; consultation auditée', async () => {
    expect((await stats('period=month', 'prepose1')).statusCode).toBe(403);
    expect((await stats('period=month', 'responsable')).statusCode).toBe(200);
    const audited = await app.db.selectFrom('audit_log').select('action')
      .where('action', '=', 'view_stats').where('entity_id', '=', residentId).execute();
    expect(audited.length).toBeGreaterThan(0);
  });

  it('autre résidence : 404 (la préposée B est refusée avant, par son rôle)', async () => {
    expect((await stats('period=month', 'prepose-b')).statusCode).toBe(403);
    expect((await call('infirmiere', 'GET', `/residents/${crypto.randomUUID()}/stats`)).statusCode).toBe(404);
  });

  it('période invalide : 400', async () => {
    expect((await stats('period=week')).statusCode).toBe(400);
    expect((await stats('period=month&date=2020-13-01')).statusCode).toBe(400);
  });
});
