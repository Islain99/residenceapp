import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { bearer, buildTestApp, caller, loginAll, outbox, RESIDENCE_A, tokenFromMail } from './helpers.js';

let app: App;
let call: ReturnType<typeof caller>;
let tokens: Record<string, string>;
let counter = 0;

beforeAll(async () => {
  app = await buildTestApp();
  tokens = await loginAll(app, ['admin', 'responsable', 'prepose1']);
  call = caller(app, tokens);
});

afterAll(async () => { await app.close(); });

const PASSWORD = 'Mot-de-passe-plateforme-2026';
const unique = (prefix: string) => `${prefix}${++counter}-${Date.now()}@exemple.test`;
const lastMail = () => outbox(app).at(-1)!;
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const as = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, payload, headers: bearer(token) });

// Nouvelle résidence ; la responsable accepte l'invitation et se connecte
async function newResidence(name = `Résidence test ${++counter}`) {
  const email = unique('resp');
  const res = await call('admin', 'POST', '/platform/residences', {
    name, type: 'RI', timezone: 'America/Montreal',
    responsable: { email, firstName: 'Rita', lastName: 'Nouvelle' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const token = tokenFromMail(lastMail().text);
  expect((await post('/auth/password/reset', { token, password: PASSWORD })).statusCode).toBe(204);
  const login = await post('/auth/login', { email, password: PASSWORD });
  expect(login.statusCode).toBe(200);
  return { residence: res.json(), email, token: login.json().accessToken as string, refresh: login.json().refreshToken as string };
}

describe('accès réservé à l’administrateur de la plateforme', () => {
  it('les rôles d’une résidence sont refusés', async () => {
    for (const who of ['responsable', 'prepose1']) {
      expect((await call(who, 'GET', '/platform/residences')).statusCode).toBe(403);
      expect((await call(who, 'GET', '/platform/audit')).statusCode).toBe(403);
    }
  });

  it('l’admin n’a accès à aucune donnée d’une résidence', async () => {
    for (const url of ['/residents', '/notes', '/handover', '/conversations', '/users', '/audit']) {
      expect((await call('admin', 'GET', url)).statusCode, url).toBe(403);
    }
  });
});

describe('résidences', () => {
  it('liste avec indicateurs chiffrés, sans aucun contenu', async () => {
    const res = await call('admin', 'GET', '/platform/residences');
    expect(res.statusCode).toBe(200);
    const a = res.json().find((r: { id: string }) => r.id === RESIDENCE_A);
    expect(a).toMatchObject({ name: 'Résidence des Érables (fictive)', type: 'RPA', isActive: true, residentsActive: 15 });
    expect(a.staffActive).toBeGreaterThanOrEqual(6);
    expect(a.responsablesActive).toBeGreaterThanOrEqual(1);
    expect(a.notesLast30Days).toBeGreaterThan(0);
    expect(res.json().some((r: { name: string }) => r.name === 'Manoir du Fleuve (fictif)')).toBe(true);
    // Aucun nom de résident ni texte de note
    expect(res.body).not.toContain('Bélanger');
    expect(res.body).not.toContain('dîner');
  });

  it('création : réglages de départ, responsable invitée, inscrite aux deux journaux', async () => {
    const { residence, email, token } = await newResidence('Villa des Pins');
    expect(residence).toMatchObject({ name: 'Villa des Pins', type: 'RI', timezone: 'America/Montreal', staffActive: 1, residentsActive: 0 });

    const mail = lastMail();
    expect(mail.subject).toContain('Villa des Pins');
    // La responsable trouve sa résidence prête
    expect((await as(token, 'GET', '/note-categories')).json()).toHaveLength(8);
    expect((await as(token, 'GET', '/shift-types')).json()).toHaveLength(3);
    const channels = (await as(token, 'GET', '/conversations')).json().map((c: { kind: string }) => c.kind).sort();
    expect(channels).toEqual(['announcements', 'team']);
    // … et voit dans son journal la création faite par l'administrateur
    const own = (await as(token, 'GET', '/audit', undefined)).json().items;
    expect(own.some((e: { action: string; entity: string; user: { lastName: string } }) =>
      e.action === 'create' && e.entity === 'residence' && e.user.lastName === 'Plateforme')).toBe(true);

    const platform = (await call('admin', 'GET', `/platform/audit?residenceId=${residence.id}`)).json().items;
    expect(platform.map((e: { action: string; entity: string }) => `${e.action}:${e.entity}`))
      .toEqual(expect.arrayContaining(['create:residence', 'create:user']));
    expect(email).toBeTruthy();
  });

  it('refus : courriel déjà utilisé (rien n’est créé), fuseau inconnu', async () => {
    const before = (await call('admin', 'GET', '/platform/residences')).json().length;
    const taken = await call('admin', 'POST', '/platform/residences', {
      name: 'Doublon', type: 'RPA', responsable: { email: 'responsable@exemple.test', firstName: 'A', lastName: 'B' },
    });
    expect(taken.statusCode).toBe(409);
    const tz = await call('admin', 'POST', '/platform/residences', {
      name: 'Fuseau', type: 'RPA', timezone: 'Mars/Olympus', responsable: { email: unique('tz'), firstName: 'A', lastName: 'B' },
    });
    expect(tz.json().error).toBe('invalid_timezone');
    expect((await call('admin', 'GET', '/platform/residences')).json()).toHaveLength(before);
  });

  it('suspendre : sessions fermées, connexion refusée ; réactiver', async () => {
    const { residence, email, token, refresh } = await newResidence();
    const suspend = await call('admin', 'PATCH', `/platform/residences/${residence.id}`, { isActive: false, reason: 'Fin de contrat' });
    expect(suspend.json()).toMatchObject({ isActive: false });
    expect((await as(token, 'GET', '/residents')).statusCode).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: refresh })).statusCode).toBe(401);
    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);

    await call('admin', 'PATCH', `/platform/residences/${residence.id}`, { isActive: true });
    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
    const log = (await call('admin', 'GET', `/platform/audit?residenceId=${residence.id}`)).json().items;
    expect(log.find((e: { action: string }) => e.action === 'suspend').details).toMatchObject({ reason: 'Fin de contrat' });
  });
});

describe('responsables', () => {
  it('nommer un employé responsable, puis remplacer l’ancienne (jamais sans responsable)', async () => {
    const { residence, token } = await newResidence();
    const detail = async () => (await call('admin', 'GET', `/platform/residences/${residence.id}`)).json();
    const first = (await detail()).responsables[0];

    // Dernière responsable : la désactiver est refusé
    const last = await call('admin', 'PATCH', `/platform/users/${first.id}`, { isActive: false });
    expect(last.json().error).toBe('last_responsable');

    // La responsable ajoute un préposé ; l'admin le voit (nom seulement) et le nomme responsable
    const prepose = await as(token, 'POST', '/users', { email: unique('emp'), firstName: 'Paul', lastName: 'Préposé', role: 'prepose' });
    expect(prepose.statusCode).toBe(201);
    const staff = (await detail()).staff;
    expect(staff).toEqual([{ id: prepose.json().id, firstName: 'Paul', lastName: 'Préposé', role: 'prepose' }]);
    const promoted = await call('admin', 'POST', `/platform/residences/${residence.id}/responsables`, { userId: prepose.json().id });
    expect(promoted.statusCode).toBe(201);
    expect(promoted.json()).toMatchObject({ role: 'responsable' });

    // Désactiver l'ancienne : ses sessions sont fermées
    const off = await call('admin', 'PATCH', `/platform/users/${first.id}`, { isActive: false });
    expect(off.json()).toMatchObject({ status: 'inactive' });
    expect((await as(token, 'GET', '/users')).statusCode).toBe(401);
  });

  it('inviter une nouvelle responsable, renvoyer l’invitation, lien de réinitialisation', async () => {
    const { residence } = await newResidence();
    const email = unique('resp-b');
    const invited = await call('admin', 'POST', `/platform/residences/${residence.id}/responsables`, { email, firstName: 'Bea', lastName: 'Seconde' });
    expect(invited.json()).toMatchObject({ email, status: 'invited', role: 'responsable' });
    const resend = await call('admin', 'POST', `/platform/users/${invited.json().id}/invite`);
    expect(resend.statusCode).toBe(200);
    expect(lastMail().to).toBe(email);
    // Pas encore activé : pas de lien de réinitialisation
    expect((await call('admin', 'POST', `/platform/users/${invited.json().id}/reset-password`)).json().error).toBe('not_activated');

    const sophie = (await call('admin', 'GET', `/platform/residences/${RESIDENCE_A}`)).json().responsables
      .find((r: { email: string }) => r.email === 'responsable@exemple.test');
    const reset = await call('admin', 'POST', `/platform/users/${sophie.id}/reset-password`);
    expect(reset.statusCode).toBe(200);
    expect(lastMail().to).toBe('responsable@exemple.test');
    expect(lastMail().subject).toContain('Réinitialiser');
  });

  it('les autres employés restent gérés par la responsable', async () => {
    const marc = await app.db.selectFrom('users').select('id').where('email', '=', 'prepose1@exemple.test').executeTakeFirstOrThrow();
    expect((await call('admin', 'PATCH', `/platform/users/${marc.id}`, { isActive: false })).json().error).toBe('not_managed');
    expect((await call('admin', 'POST', `/platform/users/${marc.id}/reset-password`)).json().error).toBe('not_managed');
  });
});

describe('sécurité', () => {
  it('comptes bloqués visibles et déblocage ; fermeture des sessions', async () => {
    const { email, refresh } = await newResidence();
    const user = await app.db.updateTable('users').set({ locked_until: new Date(Date.now() + 10 * 60_000) })
      .where('email', '=', email).returning('id').executeTakeFirstOrThrow();
    const security = (await call('admin', 'GET', '/platform/security')).json();
    expect(security.locked.some((u: { id: string }) => u.id === user.id)).toBe(true);
    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(429);

    expect((await call('admin', 'POST', `/platform/users/${user.id}/unlock`)).json()).toMatchObject({ lockedUntil: null });
    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);

    const revoked = await call('admin', 'POST', `/platform/users/${user.id}/revoke-sessions`);
    expect(revoked.json().revoked).toBeGreaterThanOrEqual(2);
    expect((await post('/auth/refresh', { refreshToken: refresh })).statusCode).toBe(401);
  });
});

describe('administrateurs et journal de la plateforme', () => {
  it('inviter un administrateur ; jamais se désactiver soi-même', async () => {
    const email = unique('admin');
    const res = await call('admin', 'POST', '/platform/admins', { email, firstName: 'Frank', lastName: 'Admin' });
    expect(res.json()).toMatchObject({ role: 'admin', status: 'invited' });
    expect(lastMail().text).toContain('l’administration de la plateforme');
    const admins = (await call('admin', 'GET', '/platform/admins')).json();
    const me = admins.find((a: { email: string }) => a.email === 'admin@exemple.test');
    expect((await call('admin', 'PATCH', `/platform/users/${me.id}`, { isActive: false })).json().error).toBe('cannot_modify_self');
    expect((await call('admin', 'PATCH', `/platform/users/${res.json().id}`, { isActive: false })).json().status).toBe('inactive');
  });

  it('le journal montre les actions des admins, jamais l’activité d’une résidence', async () => {
    await call('responsable', 'GET', '/residents');
    const items = (await call('admin', 'GET', '/platform/audit?limit=200')).json().items;
    expect(items.length).toBeGreaterThan(0);
    for (const e of items) {
      expect(e.residence === null || e.user?.lastName === 'Plateforme' || e.user?.lastName === 'Admin').toBe(true);
    }
  });
});

describe('accès d’assistance', () => {
  async function grant(token = tokens.responsable!, hours = 1) {
    const res = await as(token, 'POST', '/assistance', { hours, reason: 'Problème d’affichage de la relève' });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }

  it('seule la responsable accorde ; un seul accès ouvert à la fois', async () => {
    expect((await call('prepose1', 'POST', '/assistance', { hours: 1 })).statusCode).toBe(403);
    expect((await call('responsable', 'POST', '/assistance', { hours: 2 })).statusCode).toBe(400);
    const g = await grant();
    expect(g).toMatchObject({ status: 'active', views: 0, grantedBy: { lastName: 'Gagnon' } });
    expect((await call('responsable', 'POST', '/assistance', { hours: 4 })).json().error).toBe('assistance_active');
    await call('responsable', 'POST', `/assistance/${g.id}/revoke`);
  });

  it('consultation en lecture seule, messagerie et exports exclus, tout est tracé', async () => {
    const g = await grant();
    const open = (await call('admin', 'GET', '/platform/assistance')).json();
    expect(open.find((x: { id: string }) => x.id === g.id)).toMatchObject({ residence: { id: RESIDENCE_A } });

    const start = await call('admin', 'POST', `/platform/assistance/${g.id}/start`);
    expect(start.statusCode, start.body).toBe(200);
    const t = start.json().accessToken as string;

    const residents = await as(t, 'GET', '/residents');
    expect(residents.statusCode).toBe(200);
    const residentId = residents.json()[0].id;
    expect((await as(t, 'GET', `/residents/${residentId}`)).statusCode).toBe(200);
    expect((await as(t, 'GET', `/residents/${residentId}`)).statusCode).toBe(200);   // même page : une seule ligne au journal
    expect((await as(t, 'GET', '/handover')).statusCode).toBe(200);
    expect((await as(t, 'GET', '/users')).statusCode).toBe(200);

    expect((await as(t, 'POST', '/notes', { description: 'x' })).json().error).toBe('assistance_read_only');
    expect((await as(t, 'PATCH', `/residents/${residentId}`, { room: '999' })).json().error).toBe('assistance_read_only');
    expect((await as(t, 'GET', '/conversations')).json().error).toBe('assistance_forbidden');
    expect((await as(t, 'GET', '/admin/conversations')).json().error).toBe('assistance_forbidden');
    expect((await as(t, 'GET', `/residents/${residentId}/export`)).json().error).toBe('assistance_forbidden');
    expect((await as(t, 'GET', '/platform/residences')).statusCode).toBe(403);

    // Journal de la résidence : chaque page consultée, au nom de l'administrateur
    const log = (await call('responsable', 'GET', '/audit?action=assistance_view&limit=200')).json().items
      .filter((e: { details: { grant: string } }) => e.details.grant === g.id);
    const routes = log.map((e: { details: { route: string } }) => e.details.route);
    expect(routes.filter((r: string) => r === '/residents/:id')).toHaveLength(1);
    expect(routes).toEqual(expect.arrayContaining(['/residents', '/handover', '/users']));
    expect(log[0].user.lastName).toBe('Plateforme');
    const listed = (await call('responsable', 'GET', '/assistance')).json().find((x: { id: string }) => x.id === g.id);
    expect(listed.views).toBe(log.length);

    // Retrait par la responsable : effet immédiat
    await call('responsable', 'POST', `/assistance/${g.id}/revoke`);
    expect((await as(t, 'GET', '/residents')).json().error).toBe('assistance_ended');
    expect((await call('admin', 'POST', `/platform/assistance/${g.id}/start`)).json().error).toBe('assistance_closed');
  });

  it('accès expiré ou terminé par l’admin : plus de consultation', async () => {
    const g = await grant();
    const t = (await call('admin', 'POST', `/platform/assistance/${g.id}/start`)).json().accessToken;
    expect((await call('admin', 'POST', `/platform/assistance/${g.id}/end`)).statusCode).toBe(204);
    expect((await as(t, 'GET', '/residents')).statusCode).toBe(401);
    const ended = (await call('responsable', 'GET', '/assistance')).json().find((x: { id: string }) => x.id === g.id);
    expect(ended).toMatchObject({ status: 'revoked', revokedBy: { lastName: 'Plateforme' } });

    const old = await app.db.insertInto('assistance_grants').values({
      residence_id: RESIDENCE_A,
      granted_by: ended.grantedBy.id,
      granted_at: new Date(Date.now() - 3 * 3600_000),
      expires_at: new Date(Date.now() - 2 * 3600_000),
    }).returning('id').executeTakeFirstOrThrow();
    expect((await call('admin', 'POST', `/platform/assistance/${old.id}/start`)).json().error).toBe('assistance_closed');
  });
});
