import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildTestApp, caller, ensureResidenceB, loginAll, seedIds } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let ids: Awaited<ReturnType<typeof seedIds>>;
let types: Record<string, string>;   // libellé → id

// Dates fixes loin dans le futur : pas de conflit avec l'horaire de démonstration
const MONDAY = '2030-01-07';
const NEXT_MONDAY = '2030-01-14';

beforeAll(async () => {
  app = await buildTestApp();
  await ensureResidenceB(app);
  call = caller(app, await loginAll(app, ['responsable', 'prepose1', 'prepose2', 'prepose-b']));
  ids = await seedIds(app);
  const list = (await call('responsable', 'GET', '/shift-types')).json() as { id: string; label: string }[];
  types = Object.fromEntries(list.map((t) => [t.label, t.id]));
});

afterAll(async () => { await app.close(); });

const schedule = (payload: object) => call('responsable', 'POST', '/shifts', payload);
const shiftsOf = async (from: string, to: string, who = 'prepose1') =>
  (await call(who, 'GET', `/shifts?from=${from}&to=${to}`)).json() as { id: string; user: { id: string }; workDate: string }[];

describe('quarts types', () => {
  it('Jour, Soir, Nuit par défaut, dans l’ordre', async () => {
    const list = (await call('prepose1', 'GET', '/shift-types')).json();
    expect(list.map((t: { label: string; startTime: string; endTime: string }) => `${t.label} ${t.startTime}-${t.endTime}`))
      .toEqual(['Jour 07:00-15:00', 'Soir 15:00-23:00', 'Nuit 23:00-07:00']);
  });

  it('la responsable crée et modifie ; nom en double, heures égales ou format invalide refusés', async () => {
    const created = await call('responsable', 'POST', '/shift-types', { label: 'Jour court', startTime: '08:00', endTime: '12:00', sortOrder: 4 });
    expect(created.statusCode).toBe(201);
    expect((await call('responsable', 'POST', '/shift-types', { label: 'Jour court', startTime: '08:00', endTime: '12:00' })).statusCode).toBe(409);
    expect((await call('responsable', 'POST', '/shift-types', { label: 'X', startTime: '08:00', endTime: '08:00' })).json().error).toBe('invalid_times');
    expect((await call('responsable', 'POST', '/shift-types', { label: 'Y', startTime: '8h', endTime: '12:00' })).statusCode).toBe(400);

    const edited = await call('responsable', 'PATCH', `/shift-types/${created.json().id}`, { endTime: '12:30', isActive: false });
    expect(edited.json()).toMatchObject({ endTime: '12:30', isActive: false });
    const visible = (await call('prepose1', 'GET', '/shift-types')).json().map((t: { label: string }) => t.label);
    expect(visible).not.toContain('Jour court');
  });

  it('réservé à la responsable', async () => {
    expect((await call('prepose1', 'POST', '/shift-types', { label: 'Z', startTime: '08:00', endTime: '12:00' })).statusCode).toBe(403);
    expect((await call('prepose1', 'GET', '/shift-types?all=true')).statusCode).toBe(403);
  });
});

describe('horaire', () => {
  it('ajouter : heures du quart type par défaut ; nuit = finit le lendemain ; heures ajustées signalées', async () => {
    const day = await schedule({ userId: ids.userId('prepose1'), workDate: '2030-02-04', shiftTypeId: types.Jour });
    expect(day.statusCode, day.body).toBe(201);
    expect(day.json()).toMatchObject({ workDate: '2030-02-04', startTime: '07:00', endTime: '15:00', overnight: false, adjusted: false,
      shiftType: { label: 'Jour' }, user: { firstName: 'Marc' } });

    const night = await schedule({ userId: ids.userId('prepose2'), workDate: '2030-02-04', shiftTypeId: types.Nuit });
    expect(night.json()).toMatchObject({ startTime: '23:00', endTime: '07:00', overnight: true });

    const adjusted = await schedule({ userId: ids.userId('prepose2'), workDate: '2030-02-05', shiftTypeId: types.Jour,
      startTime: '09:00', endTime: '15:00', notes: 'Rendez-vous médical le matin' });
    expect(adjusted.json()).toMatchObject({ startTime: '09:00', adjusted: true, notes: 'Rendez-vous médical le matin' });
  });

  it('même quart, même jour, même employé : 409 ; employé d’une autre résidence : 400', async () => {
    const body = { userId: ids.userId('prepose1'), workDate: '2030-02-06', shiftTypeId: types.Soir };
    expect((await schedule(body)).statusCode).toBe(201);
    expect((await schedule(body)).json().error).toBe('already_scheduled');
    const other = await app.db.selectFrom('users').select('id').where('email', '=', 'prepose-b@exemple.test').executeTakeFirstOrThrow();
    expect((await schedule({ ...body, userId: other.id })).json().error).toBe('invalid_user');
  });

  it('modifier : nouveau quart type = ses heures ; retirer puis replanifier', async () => {
    const shift = (await schedule({ userId: ids.userId('prepose1'), workDate: '2030-02-07', shiftTypeId: types.Jour })).json();
    const edited = await call('responsable', 'PATCH', `/shifts/${shift.id}`, { shiftTypeId: types.Soir });
    expect(edited.json()).toMatchObject({ shiftType: { label: 'Soir' }, startTime: '15:00', endTime: '23:00' });

    expect((await call('responsable', 'POST', `/shifts/${shift.id}/cancel`)).statusCode).toBe(204);
    expect((await shiftsOf('2030-02-07', '2030-02-07')).map((s) => s.id)).not.toContain(shift.id);
    expect((await call('responsable', 'POST', `/shifts/${shift.id}/cancel`)).statusCode).toBe(404);
    expect((await schedule({ userId: ids.userId('prepose1'), workDate: '2030-02-07', shiftTypeId: types.Soir })).statusCode).toBe(201);
  });

  it('tout le monde consulte ; seule la responsable planifie', async () => {
    expect((await call('prepose1', 'POST', '/shifts', { userId: ids.userId('prepose1'), workDate: '2030-02-08', shiftTypeId: types.Jour })).statusCode).toBe(403);
    const mine = (await call('prepose2', 'GET', `/shifts?from=2030-02-04&to=2030-02-10&userId=${ids.userId('prepose2')}`)).json();
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((s: { user: { id: string } }) => s.user.id === ids.userId('prepose2'))).toBe(true);
  });

  it('période inversée ou de plus de 62 jours : 400', async () => {
    expect((await call('prepose1', 'GET', '/shifts?from=2030-02-10&to=2030-02-01')).statusCode).toBe(400);
    expect((await call('prepose1', 'GET', '/shifts?from=2030-01-01&to=2030-04-01')).statusCode).toBe(400);
  });

  it('horaire de démonstration : la semaine en cours est remplie', async () => {
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    expect((await shiftsOf(from, to)).length).toBeGreaterThan(10);
  });
});

describe('copier une semaine', () => {
  it('copie les quarts, garde les heures ajustées, ignore les doublons', async () => {
    await schedule({ userId: ids.userId('prepose1'), workDate: MONDAY, shiftTypeId: types.Jour });
    await schedule({ userId: ids.userId('prepose2'), workDate: '2030-01-09', shiftTypeId: types.Soir, startTime: '16:00', endTime: '23:00' });

    const first = await call('responsable', 'POST', '/shifts/copy-week', { fromWeek: MONDAY, toWeek: NEXT_MONDAY });
    expect(first.json()).toEqual({ created: 2, skipped: 0 });
    const copied = await shiftsOf(NEXT_MONDAY, '2030-01-20');
    expect(copied.map((s) => s.workDate).sort()).toEqual(['2030-01-14', '2030-01-16']);
    expect(copied.find((s) => s.workDate === '2030-01-16')).toMatchObject({ startTime: '16:00', adjusted: true });

    const again = await call('responsable', 'POST', '/shifts/copy-week', { fromWeek: MONDAY, toWeek: NEXT_MONDAY });
    expect(again.json()).toEqual({ created: 0, skipped: 2 });
  });

  it('semaine qui ne commence pas un lundi : 400', async () => {
    const res = await call('responsable', 'POST', '/shifts/copy-week', { fromWeek: '2030-01-08', toWeek: NEXT_MONDAY });
    expect(res.json().error).toBe('invalid_week');
  });
});

describe('isolation', () => {
  it('une autre résidence ne voit pas l’horaire ni les quarts types', async () => {
    expect(await shiftsOf('2030-01-01', '2030-02-28', 'prepose-b')).toEqual([]);
    expect((await call('prepose-b', 'GET', '/shift-types')).json()).toEqual([]);
  });
});
