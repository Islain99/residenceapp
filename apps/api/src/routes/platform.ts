// Administration de la plateforme — réservé au rôle « admin » (sans résidence).
//
// L'administrateur gère les résidences et leurs responsables, surveille la
// sécurité et tient le journal de la plateforme. Il ne voit JAMAIS le contenu
// d'une résidence (résidents, notes, suivis, messages) : seulement des
// indicateurs chiffrés. Exception : l'accès d'assistance, accordé par la
// responsable, limité dans le temps, en lecture seule et tracé (auth.ts).
//
//   Résidences   GET  /platform/residences            liste + indicateurs
//                POST /platform/residences            créer (+ réglages de départ + 1re responsable)
//                GET  /platform/residences/:id        détail : responsables, employés, accès d'assistance
//                PATCH /platform/residences/:id       nom, type, fuseau ; suspendre / réactiver
//                POST /platform/residences/:id/responsables   inviter une responsable ou nommer un employé
//   Comptes      PATCH /platform/users/:id            désactiver / réactiver (responsable ou admin)
//                POST /platform/users/:id/invite      renvoyer l'invitation
//                POST /platform/users/:id/reset-password  envoyer un lien de réinitialisation
//                POST /platform/users/:id/reset-mfa   double authentification à reconfigurer
//                POST /platform/users/:id/unlock      débloquer après trop d'essais
//                POST /platform/users/:id/revoke-sessions  fermer toutes ses sessions
//   Admins       GET/POST /platform/admins
//   Sécurité     GET  /platform/security
//   Journal      GET  /platform/audit                 actions des admins + événements sans résidence
//   Assistance   GET  /platform/assistance            accès ouverts
//                POST /platform/assistance/:id/start  jeton de consultation (lecture seule)
//                POST /platform/assistance/:id/end    terminer l'accès
//
// L'administrateur ne crée jamais de mot de passe : invitation ou lien de
// réinitialisation par courriel. Rien n'est supprimé.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql, type Updateable } from 'kysely';
import { requireRole, type AccessTokenPayload } from '../auth.js';
import type { Users } from '../db/types.js';
import { invalidateAccountTokens, inviteMail, issueAccountToken, resetMail } from '../lib/account-tokens.js';
import { mailerKind } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { asLocale, LocaleSchema, MAIL_TEXT } from '../lib/locale.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import type { Db } from '../lib/note-view.js';
import { createResidenceDefaults } from '../lib/residence-defaults.js';
import { IdParams, Nullable, Person, Text, Uuid } from '../lib/schemas.js';
import { AssistanceGrantBody, grantQuery, toGrant } from './assistance.js';


const ResidenceType = Type.Union([Type.Literal('RPA'), Type.Literal('RI')]);

const ResidenceSummary = Type.Object({
  id: Type.String(),
  name: Type.String(),
  type: Type.String(),
  timezone: Type.String(),
  isActive: Type.Boolean(),
  createdAt: Type.String(),
  // Indicateurs chiffrés seulement : aucun nom de résident, aucun contenu
  staffActive: Type.Integer(),
  responsablesActive: Type.Integer(),
  residentsActive: Type.Integer(),
  notesLast30Days: Type.Integer(),
  lastLoginAt: Nullable(Type.String()),
  lockedAccounts: Type.Integer(),
  failedLogins24h: Type.Integer(),
  assistanceUntil: Nullable(Type.String()),   // accès d'assistance ouvert jusqu'à…
});

const Account = Type.Object({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  role: Type.String(),
  status: Type.Union([Type.Literal('invited'), Type.Literal('active'), Type.Literal('inactive')]),
  lastLoginAt: Nullable(Type.String()),
  lockedUntil: Nullable(Type.String()),
  invitationExpiresAt: Nullable(Type.String()),
  mfaEnabled: Type.Boolean(),
});

const StaffMember = Type.Object({
  id: Type.String(), firstName: Type.String(), lastName: Type.String(), role: Type.String(),
});

const ResidenceRef = Type.Object({ id: Type.String(), name: Type.String() });

const NewPerson = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  firstName: Text(100),
  lastName: Text(100),
  locale: Type.Optional(LocaleSchema),   // langue des courriels et des notifications (français par défaut)
});

const n = (v: string | number | bigint | null | undefined) => Number(v ?? 0);
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

function residenceQuery(db: Db) {
  return db.selectFrom('residences as r').select((eb) => [
    'r.id', 'r.name', 'r.type', 'r.timezone', 'r.is_active', 'r.created_at',
    eb.selectFrom('users as u').whereRef('u.residence_id', '=', 'r.id').where('u.is_active', '=', true)
      .select((c) => c.fn.countAll<string>().as('c')).as('staff_active'),
    eb.selectFrom('users as u').whereRef('u.residence_id', '=', 'r.id').where('u.is_active', '=', true)
      .where('u.role', '=', 'responsable').select((c) => c.fn.countAll<string>().as('c')).as('responsables_active'),
    eb.selectFrom('residents as p').whereRef('p.residence_id', '=', 'r.id').where('p.status', '=', 'actif')
      .select((c) => c.fn.countAll<string>().as('c')).as('residents_active'),
    eb.selectFrom('notes as x').whereRef('x.residence_id', '=', 'r.id')
      .where('x.created_at', '>', sql<Date>`now() - interval '30 days'`)
      .select((c) => c.fn.countAll<string>().as('c')).as('notes_30d'),
    eb.selectFrom('users as u').whereRef('u.residence_id', '=', 'r.id')
      .select((c) => c.fn.max('u.last_login_at').as('m')).as('last_login_at'),
    eb.selectFrom('users as u').whereRef('u.residence_id', '=', 'r.id')
      .where('u.locked_until', '>', sql<Date>`now()`)
      .select((c) => c.fn.countAll<string>().as('c')).as('locked'),
    eb.selectFrom('audit_log as l').whereRef('l.residence_id', '=', 'r.id').where('l.action', '=', 'login_failed')
      .where('l.at', '>', sql<Date>`now() - interval '24 hours'`)
      .select((c) => c.fn.countAll<string>().as('c')).as('failed_24h'),
    eb.selectFrom('assistance_grants as g').whereRef('g.residence_id', '=', 'r.id')
      .where('g.revoked_at', 'is', null).where('g.expires_at', '>', sql<Date>`now()`)
      .select((c) => c.fn.max('g.expires_at').as('m')).as('assistance_until'),
  ]);
}

type ResidenceRow = Awaited<ReturnType<ReturnType<typeof residenceQuery>['executeTakeFirstOrThrow']>>;

const toResidence = (r: ResidenceRow) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  timezone: r.timezone,
  isActive: r.is_active,
  createdAt: r.created_at.toISOString(),
  staffActive: n(r.staff_active),
  responsablesActive: n(r.responsables_active),
  residentsActive: n(r.residents_active),
  notesLast30Days: n(r.notes_30d),
  lastLoginAt: iso(r.last_login_at),
  lockedAccounts: n(r.locked),
  failedLogins24h: n(r.failed_24h),
  assistanceUntil: iso(r.assistance_until),
});

function accountQuery(db: Db) {
  return db.selectFrom('users as u').select((eb) => [
    'u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.role', 'u.is_active', 'u.last_login_at',
    'u.locked_until', 'u.residence_id', 'u.mfa_enabled_at',
    sql<boolean>`u.password_hash IS NULL`.as('invited'),
    eb.selectFrom('account_tokens as t').whereRef('t.user_id', '=', 'u.id')
      .where('t.purpose', '=', 'invite').where('t.used_at', 'is', null)
      .select((t) => t.fn.max('t.expires_at').as('e')).as('invitation_expires_at'),
  ]);
}

type AccountRow = Awaited<ReturnType<ReturnType<typeof accountQuery>['executeTakeFirstOrThrow']>>;

const toAccount = (r: AccountRow) => ({
  id: r.id,
  email: r.email,
  firstName: r.first_name,
  lastName: r.last_name,
  role: r.role,
  status: !r.is_active ? 'inactive' as const : r.invited ? 'invited' as const : 'active' as const,
  lastLoginAt: iso(r.last_login_at),
  lockedUntil: r.locked_until && r.locked_until > new Date() ? r.locked_until.toISOString() : null,
  invitationExpiresAt: iso(r.invitation_expires_at),
  mfaEnabled: r.mfa_enabled_at !== null,
});

function checkTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('fr-CA', { timeZone: tz });
  } catch {
    throw badRequest('invalid_timezone', 'Fuseau horaire inconnu.');
  }
}

const platformRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config, mailer } = app;
  app.addHook('preHandler', requireRole('admin'));

  async function findResidence(id: string) {
    const row = await residenceQuery(db).where('r.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Résidence introuvable.');
    return toResidence(row);
  }

  async function findAccount(id: string) {
    return toAccount(await accountQuery(db).where('u.id', '=', id).executeTakeFirstOrThrow());
  }

  // Courriel envoyé dans la transaction : en cas d'échec, rien n'est enregistré
  async function sendInvite(trx: Db, user: { id: string; email: string; first_name: string; locale: string },
    place: string | null, adminId: string) {
    const token = await issueAccountToken(trx, user.id, 'invite', adminId);
    try {
      await mailer.send(inviteMail(config, { email: user.email, firstName: user.first_name, locale: user.locale }, token, null, place));
    } catch {
      throw new HttpError(502, 'mail_failed', "Le courriel d'invitation n'a pas pu être envoyé. Réessayer plus tard.");
    }
  }

  async function ensureEmailFree(trx: Db, email: string) {
    const taken = await trx.selectFrom('users').select('id').where(sql<string>`lower(email)`, '=', email).executeTakeFirst();
    if (taken) throw new HttpError(409, 'email_taken', 'Ce courriel est déjà utilisé par un compte.');
  }

  function cleanPerson(p: { email: string; firstName: string; lastName: string; locale?: 'fr' | 'en' }) {
    const person = { email: p.email.trim().toLowerCase(), first_name: p.firstName.trim(), last_name: p.lastName.trim(), locale: p.locale ?? 'fr' };
    if (!person.first_name || !person.last_name) throw badRequest('invalid_name', 'Prénom et nom obligatoires.');
    return person;
  }

  // Compte géré par la plateforme : responsable ou admin (les autres : la responsable)
  async function managedAccount(trx: Db, id: string) {
    const user = await trx.selectFrom('users as u').leftJoin('residences as r', 'r.id', 'u.residence_id')
      .select(['u.id', 'u.email', 'u.first_name', 'u.locale', 'u.role', 'u.is_active', 'u.password_hash', 'u.residence_id', 'r.name as residence_name'])
      .where('u.id', '=', id).forUpdate('u').executeTakeFirst();
    if (!user) throw notFound('Compte introuvable.');
    if (user.role !== 'responsable' && user.role !== 'admin') {
      throw new HttpError(409, 'not_managed', 'Ce compte est géré par la responsable de la résidence.');
    }
    return user;
  }

  // ------------------------------------------------------------- Résidences

  app.get('/platform/residences', {
    schema: { response: { 200: Type.Array(ResidenceSummary) } },
  }, async () => {
    const rows = await residenceQuery(db)
      .orderBy('r.is_active', 'desc')
      .orderBy(sql`r.name COLLATE "fr-CA-x-icu"`)
      .execute();
    return rows.map(toResidence);
  });

  app.post('/platform/residences', {
    schema: {
      body: Type.Object({
        name: Text(150),
        type: ResidenceType,
        timezone: Type.String({ minLength: 1, maxLength: 64, default: 'America/Toronto' }),
        responsable: NewPerson,
      }),
      response: { 201: ResidenceSummary },
    },
  }, async (request, reply) => {
    const b = request.body;
    const name = b.name.trim();
    if (!name) throw badRequest('invalid_name', 'Nom obligatoire.');
    checkTimezone(b.timezone);
    const person = cleanPerson(b.responsable);

    const id = await db.transaction().execute(async (trx) => {
      await ensureEmailFree(trx, person.email);
      const residence = await trx.insertInto('residences')
        .values({ name, type: b.type, timezone: b.timezone })
        .returning('id').executeTakeFirstOrThrow();
      await createResidenceDefaults(trx, residence.id);
      const user = await trx.insertInto('users')
        .values({ ...person, residence_id: residence.id, role: 'responsable', password_hash: null })
        .returning(['id', 'email', 'first_name', 'locale']).executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'residence', entityId: residence.id, userId: request.user.sub,
        residenceId: residence.id, details: { name, type: b.type }, ip: request.ip,
      });
      await audit(trx, {
        action: 'create', entity: 'user', entityId: user.id, userId: request.user.sub,
        residenceId: residence.id, details: { role: 'responsable' }, ip: request.ip,
      });
      await sendInvite(trx, user, name, request.user.sub);
      return residence.id;
    });
    return reply.code(201).send(await findResidence(id));
  });

  app.get('/platform/residences/:id', {
    schema: {
      params: IdParams,
      response: {
        200: Type.Object({
          residence: ResidenceSummary,
          responsables: Type.Array(Account),
          // Employés actifs qu'on peut nommer responsable (noms seulement)
          staff: Type.Array(StaffMember),
          assistance: Type.Array(AssistanceGrantBody),
        }),
      },
    },
  }, async (request) => {
    const residence = await findResidence(request.params.id);
    const [responsables, staff, grants] = await Promise.all([
      accountQuery(db).where('u.residence_id', '=', residence.id).where('u.role', '=', 'responsable')
        .orderBy('u.is_active', 'desc').orderBy('u.last_name').execute(),
      db.selectFrom('users').select(['id', 'first_name', 'last_name', 'role'])
        .where('residence_id', '=', residence.id).where('is_active', '=', true).where('role', '!=', 'responsable')
        .orderBy('last_name').orderBy('first_name').execute(),
      grantQuery(db).where('g.residence_id', '=', residence.id).orderBy('g.granted_at', 'desc').limit(10).execute(),
    ]);
    return {
      residence,
      responsables: responsables.map(toAccount),
      staff: staff.map((s) => ({ id: s.id, firstName: s.first_name, lastName: s.last_name, role: s.role })),
      assistance: grants.map(toGrant),
    };
  });

  app.patch('/platform/residences/:id', {
    schema: {
      params: IdParams,
      body: Type.Object({
        name: Type.Optional(Text(150)),
        type: Type.Optional(ResidenceType),
        timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
        isActive: Type.Optional(Type.Boolean()),
        reason: Type.Optional(Type.String({ maxLength: 500 })),   // motif d'une suspension
      }, { minProperties: 1 }),
      response: { 200: ResidenceSummary },
    },
  }, async (request) => {
    const b = request.body;
    if (b.timezone !== undefined) checkTimezone(b.timezone);
    await db.transaction().execute(async (trx) => {
      const residence = await trx.selectFrom('residences').select(['id', 'is_active'])
        .where('id', '=', request.params.id).forUpdate().executeTakeFirst();
      if (!residence) throw notFound('Résidence introuvable.');
      const name = b.name?.trim();
      if (name === '') throw badRequest('invalid_name', 'Nom obligatoire.');
      await trx.updateTable('residences').set({
        ...(name !== undefined ? { name } : {}),
        ...(b.type !== undefined ? { type: b.type } : {}),
        ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
        ...(b.isActive !== undefined ? { is_active: b.isActive } : {}),
      }).where('id', '=', residence.id).execute();

      const suspended = b.isActive === false && residence.is_active;
      if (suspended) {
        // Plus personne n'y entre : sessions fermées, accès d'assistance retirés
        await trx.updateTable('refresh_tokens').set({ revoked_at: sql<Date>`now()` })
          .where('revoked_at', 'is', null)
          .where('user_id', 'in', (eb) => eb.selectFrom('users').select('id').where('residence_id', '=', residence.id))
          .execute();
        await trx.updateTable('assistance_grants').set({ revoked_at: sql<Date>`now()`, revoked_by: request.user.sub })
          .where('residence_id', '=', residence.id).where('revoked_at', 'is', null).execute();
      }
      await audit(trx, {
        action: suspended ? 'suspend' : b.isActive === true && !residence.is_active ? 'reactivate' : 'update',
        entity: 'residence', entityId: residence.id, userId: request.user.sub, residenceId: residence.id,
        details: { fields: Object.keys(b).filter((k) => k !== 'reason'), ...(b.reason?.trim() ? { reason: b.reason.trim() } : {}) },
        ip: request.ip,
      });
    });
    return findResidence(request.params.id);
  });

  // Nouvelle responsable : invitation par courriel, ou employé existant nommé responsable
  app.post('/platform/residences/:id/responsables', {
    schema: {
      params: IdParams,
      body: Type.Union([
        Type.Object({ userId: Uuid }, { additionalProperties: false }),
        Type.Object({
          email: Type.String({ format: 'email', maxLength: 254 }),
          firstName: Text(100),
          lastName: Text(100),
        }, { additionalProperties: false }),
      ]),
      response: { 201: Account },
    },
  }, async (request, reply) => {
    const body = request.body;
    const id = await db.transaction().execute(async (trx) => {
      const residence = await trx.selectFrom('residences').select(['id', 'name'])
        .where('id', '=', request.params.id).executeTakeFirst();
      if (!residence) throw notFound('Résidence introuvable.');

      if ('userId' in body) {
        const user = await trx.selectFrom('users').select(['id', 'role', 'is_active'])
          .where('id', '=', body.userId).where('residence_id', '=', residence.id).forUpdate().executeTakeFirst();
        if (!user) throw notFound('Employé introuvable dans cette résidence.');
        if (!user.is_active) throw new HttpError(409, 'inactive_account', 'Compte désactivé.');
        if (user.role === 'responsable') throw new HttpError(409, 'already_responsable', 'Cet employé est déjà responsable.');
        await trx.updateTable('users').set({ role: 'responsable' }).where('id', '=', user.id).execute();
        // Double authentification obligatoire : nouvelle connexion
        await trx.updateTable('refresh_tokens').set({ expires_at: new Date() })
          .where('user_id', '=', user.id).where('revoked_at', 'is', null).execute();
        await audit(trx, {
          action: 'update', entity: 'user', entityId: user.id, userId: request.user.sub, residenceId: residence.id,
          details: { fields: ['role'], from: user.role, to: 'responsable' }, ip: request.ip,
        });
        return user.id;
      }

      const person = cleanPerson(body);
      await ensureEmailFree(trx, person.email);
      const user = await trx.insertInto('users')
        .values({ ...person, residence_id: residence.id, role: 'responsable', password_hash: null })
        .returning(['id', 'email', 'first_name', 'locale']).executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'user', entityId: user.id, userId: request.user.sub, residenceId: residence.id,
        details: { role: 'responsable' }, ip: request.ip,
      });
      await sendInvite(trx, user, residence.name, request.user.sub);
      return user.id;
    });
    return reply.code(201).send(await findAccount(id));
  });

  // ---------------------------------------------------------------- Comptes

  app.patch('/platform/users/:id', {
    schema: {
      params: IdParams,
      body: Type.Object({ isActive: Type.Boolean() }),
      response: { 200: Account },
    },
  }, async (request) => {
    const { isActive } = request.body;
    if (request.params.id === request.user.sub) {
      throw badRequest('cannot_modify_self', 'Vous ne pouvez pas désactiver votre propre compte.');
    }
    await db.transaction().execute(async (trx) => {
      const user = await managedAccount(trx, request.params.id);
      if (user.is_active === isActive) return;
      if (!isActive) {
        // Jamais sans responsable (résidence) ni sans administrateur (plateforme)
        let others = trx.selectFrom('users').select((c) => c.fn.countAll<string>().as('c'))
          .where('id', '!=', user.id).where('is_active', '=', true).where('role', '=', user.role);
        others = user.residence_id ? others.where('residence_id', '=', user.residence_id) : others.where('residence_id', 'is', null);
        const { c } = await others.executeTakeFirstOrThrow();
        if (n(c) === 0) {
          throw new HttpError(409, user.role === 'admin' ? 'last_admin' : 'last_responsable',
            user.role === 'admin'
              ? 'C’est le dernier administrateur actif : en inviter un autre d’abord.'
              : 'C’est la dernière responsable active : inviter ou nommer sa remplaçante d’abord.');
        }
      }
      await trx.updateTable('users').set({ is_active: isActive } satisfies Updateable<Users>).where('id', '=', user.id).execute();
      if (!isActive) {
        await trx.updateTable('refresh_tokens').set({ revoked_at: sql<Date>`now()` })
          .where('user_id', '=', user.id).where('revoked_at', 'is', null).execute();
        await invalidateAccountTokens(trx, user.id);
      }
      await audit(trx, {
        action: isActive ? 'reactivate' : 'deactivate', entity: 'user', entityId: user.id,
        userId: request.user.sub, residenceId: user.residence_id, details: { role: user.role }, ip: request.ip,
      });
    });
    return findAccount(request.params.id);
  });

  app.post('/platform/users/:id/invite', {
    schema: { params: IdParams, response: { 200: Account } },
  }, async (request) => {
    await db.transaction().execute(async (trx) => {
      const user = await managedAccount(trx, request.params.id);
      if (!user.is_active) throw new HttpError(409, 'inactive_account', 'Compte désactivé : le réactiver d’abord.');
      if (user.password_hash !== null) {
        throw new HttpError(409, 'already_active', 'Ce compte est déjà activé : envoyer plutôt un lien de réinitialisation.');
      }
      await audit(trx, {
        action: 'invite', entity: 'user', entityId: user.id, userId: request.user.sub,
        residenceId: user.residence_id, ip: request.ip,
      });
      await sendInvite(trx, user, user.residence_name, request.user.sub);
    });
    return findAccount(request.params.id);
  });

  app.post('/platform/users/:id/reset-password', {
    schema: { params: IdParams, response: { 200: Account } },
  }, async (request) => {
    await db.transaction().execute(async (trx) => {
      const user = await managedAccount(trx, request.params.id);
      if (!user.is_active) throw new HttpError(409, 'inactive_account', 'Compte désactivé : le réactiver d’abord.');
      if (user.password_hash === null) {
        throw new HttpError(409, 'not_activated', 'Invitation pas encore acceptée : renvoyer plutôt l’invitation.');
      }
      const token = await issueAccountToken(trx, user.id, 'reset', request.user.sub);
      await audit(trx, {
        action: 'reset_link', entity: 'user', entityId: user.id, userId: request.user.sub,
        residenceId: user.residence_id, ip: request.ip,
      });
      try {
        await mailer.send(resetMail(config, { email: user.email, firstName: user.first_name, locale: user.locale }, token));
      } catch {
        throw new HttpError(502, 'mail_failed', 'Le courriel n’a pas pu être envoyé. Réessayer plus tard.');
      }
    });
    return findAccount(request.params.id);
  });

  // Téléphone perdu, codes de secours perdus : la double authentification est
  // à reconfigurer à la prochaine connexion. Sessions fermées.
  app.post('/platform/users/:id/reset-mfa', {
    schema: { params: IdParams, response: { 200: Account } },
  }, async (request) => {
    if (request.params.id === request.user.sub) {
      throw badRequest('cannot_modify_self', 'Un autre administrateur doit le faire pour vous.');
    }
    await db.transaction().execute(async (trx) => {
      const user = await managedAccount(trx, request.params.id);
      await trx.updateTable('users').set({ mfa_secret: null, mfa_enabled_at: null, mfa_last_step: null })
        .where('id', '=', user.id).execute();
      await trx.updateTable('mfa_backup_codes').set({ revoked_at: sql<Date>`now()` })
        .where('user_id', '=', user.id).where('used_at', 'is', null).where('revoked_at', 'is', null).execute();
      await trx.updateTable('refresh_tokens').set({ revoked_at: sql<Date>`now()` })
        .where('user_id', '=', user.id).where('revoked_at', 'is', null).execute();
      await audit(trx, {
        action: 'mfa_reset', entity: 'user', entityId: user.id, userId: request.user.sub,
        residenceId: user.residence_id, ip: request.ip,
      });
    });
    return findAccount(request.params.id);
  });

  // Tout compte (sécurité) : débloquer, fermer les sessions
  app.post('/platform/users/:id/unlock', {
    schema: { params: IdParams, response: { 200: Account } },
  }, async (request) => {
    const user = await db.updateTable('users').set({ locked_until: null, failed_login_count: 0 })
      .where('id', '=', request.params.id).returning(['id', 'residence_id']).executeTakeFirst();
    if (!user) throw notFound('Compte introuvable.');
    await audit(db, {
      action: 'unlock', entity: 'user', entityId: user.id, userId: request.user.sub,
      residenceId: user.residence_id, ip: request.ip,
    });
    return findAccount(user.id);
  });

  app.post('/platform/users/:id/revoke-sessions', {
    schema: { params: IdParams, response: { 200: Type.Object({ revoked: Type.Integer() }) } },
  }, async (request) => {
    if (request.params.id === request.user.sub) {
      throw badRequest('cannot_modify_self', 'Pour fermer vos propres sessions : se déconnecter.');
    }
    return db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select(['id', 'residence_id'])
        .where('id', '=', request.params.id).executeTakeFirst();
      if (!user) throw notFound('Compte introuvable.');
      const revoked = await trx.updateTable('refresh_tokens').set({ revoked_at: sql<Date>`now()` })
        .where('user_id', '=', user.id).where('revoked_at', 'is', null)
        .where('expires_at', '>', sql<Date>`now()`).executeTakeFirst();
      await audit(trx, {
        action: 'revoke_sessions', entity: 'user', entityId: user.id, userId: request.user.sub,
        residenceId: user.residence_id, details: { revoked: Number(revoked.numUpdatedRows) }, ip: request.ip,
      });
      return { revoked: Number(revoked.numUpdatedRows) };
    });
  });

  // ---------------------------------------------------------- Administrateurs

  app.get('/platform/admins', {
    schema: { response: { 200: Type.Array(Account) } },
  }, async () => {
    const rows = await accountQuery(db).where('u.role', '=', 'admin')
      .orderBy('u.is_active', 'desc').orderBy('u.last_name').execute();
    return rows.map(toAccount);
  });

  app.post('/platform/admins', {
    schema: { body: NewPerson, response: { 201: Account } },
  }, async (request, reply) => {
    const person = cleanPerson(request.body);
    const id = await db.transaction().execute(async (trx) => {
      await ensureEmailFree(trx, person.email);
      const user = await trx.insertInto('users')
        .values({ ...person, residence_id: null, role: 'admin', password_hash: null })
        .returning(['id', 'email', 'first_name', 'locale']).executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'user', entityId: user.id, userId: request.user.sub,
        details: { role: 'admin' }, ip: request.ip,
      });
      await sendInvite(trx, user, null, request.user.sub);
      return user.id;
    });
    return reply.code(201).send(await findAccount(id));
  });

  // ---------------------------------------------------------------- Courriels

  app.get('/platform/email', {
    schema: { response: { 200: Type.Object({ provider: Type.String(), from: Type.String() }) } },
  }, async () => ({ provider: mailerKind(config), from: config.MAIL_FROM }));

  // Courriel d'essai : vérifie la configuration d'envoi. Destinataire : sa
  // propre adresse, ou une autre (ex. l'adresse du compte Resend : sans domaine
  // vérifié, Resend n'écrit qu'à celle-là)
  app.post('/platform/email/test', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({ to: Type.Optional(Type.String({ format: 'email', maxLength: 254 })) }),
      response: { 200: Type.Object({ to: Type.String(), provider: Type.String() }) },
    },
  }, async (request) => {
    const me = await db.selectFrom('users').select(['email', 'first_name', 'locale']).where('id', '=', request.user.sub).executeTakeFirstOrThrow();
    const m = MAIL_TEXT[asLocale(me.locale)];
    const to = request.body.to?.trim().toLowerCase() || me.email;
    try {
      await mailer.send({
        to,
        subject: m.test.subject,
        text: `${m.hello(me.first_name)}\n\n${m.test.body}`,
        html: `<p>${m.hello(me.first_name.replace(/[&<>"']/g, ''))}</p><p>${m.test.body}</p>`,
      });
    } catch {
      throw new HttpError(502, 'mail_failed', mailerKind(config) === 'resend' && config.MAIL_FROM.includes('@resend.dev')
        ? 'Refusé par Resend : sans domaine vérifié, il n’envoie qu’à l’adresse de votre compte Resend. Indiquez-la comme destinataire.'
        : 'Le courriel n’a pas pu être envoyé : vérifier la clé du fournisseur et l’adresse d’expédition (MAIL_FROM). Détail dans le journal du serveur.');
    }
    await audit(db, { action: 'email_test', entity: 'user', entityId: request.user.sub, userId: request.user.sub, details: { to }, ip: request.ip });
    return { to, provider: mailerKind(config) };
  });

  // ---------------------------------------------------------------- Sécurité

  app.get('/platform/security', {
    schema: {
      response: {
        200: Type.Object({
          locked: Type.Array(Type.Object({
            id: Type.String(), firstName: Type.String(), lastName: Type.String(), email: Type.String(),
            role: Type.String(), residence: Nullable(ResidenceRef), lockedUntil: Type.String(),
          })),
          failedLogins24h: Type.Array(Type.Object({ residence: Nullable(ResidenceRef), count: Type.Integer() })),
          events: Type.Array(Type.Object({
            id: Type.String(), at: Type.String(), action: Type.String(),
            user: Nullable(Person), residence: Nullable(ResidenceRef), ip: Nullable(Type.String()),
          })),
        }),
      },
    },
  }, async () => {
    const [locked, failed, events] = await Promise.all([
      db.selectFrom('users as u').leftJoin('residences as r', 'r.id', 'u.residence_id')
        .select(['u.id', 'u.first_name', 'u.last_name', 'u.email', 'u.role', 'u.locked_until', 'r.id as rid', 'r.name as rname'])
        .where('u.locked_until', '>', sql<Date>`now()`).orderBy('u.locked_until', 'desc').execute(),
      db.selectFrom('audit_log as l').leftJoin('residences as r', 'r.id', 'l.residence_id')
        .select((c) => ['r.id as rid', 'r.name as rname', c.fn.countAll<string>().as('c')])
        .where('l.action', '=', 'login_failed').where('l.at', '>', sql<Date>`now() - interval '24 hours'`)
        .groupBy(['r.id', 'r.name']).orderBy('c', 'desc').execute(),
      // Événements à surveiller (7 jours) : comptes bloqués, jeton de session réutilisé (vol probable)
      db.selectFrom('audit_log as l')
        .leftJoin('users as u', 'u.id', 'l.entity_id')
        .leftJoin('residences as r', 'r.id', 'l.residence_id')
        .select(['l.id', 'l.at', 'l.action', 'l.ip', 'u.id as uid', 'u.first_name', 'u.last_name', 'r.id as rid', 'r.name as rname'])
        .where('l.at', '>', sql<Date>`now() - interval '7 days'`)
        .where((eb) => eb.or([
          eb('l.action', '=', 'refresh_reuse'),
          eb.and([eb('l.action', '=', 'login_failed'), sql<boolean>`l.details->>'locked' = 'true'`]),
        ]))
        .orderBy('l.id', 'desc').limit(50).execute(),
    ]);
    return {
      locked: locked.map((u) => ({
        id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email, role: u.role,
        residence: u.rid ? { id: u.rid, name: u.rname ?? '' } : null,
        lockedUntil: u.locked_until!.toISOString(),
      })),
      failedLogins24h: failed.map((f) => ({ residence: f.rid ? { id: f.rid, name: f.rname ?? '' } : null, count: n(f.c) })),
      events: events.map((e) => ({
        id: String(e.id), at: e.at.toISOString(), action: e.action, ip: e.ip,
        user: e.uid ? { id: e.uid, firstName: e.first_name ?? '', lastName: e.last_name ?? '' } : null,
        residence: e.rid ? { id: e.rid, name: e.rname ?? '' } : null,
      })),
    };
  });

  // ------------------------------------------------------- Journal plateforme

  app.get('/platform/audit', {
    schema: {
      querystring: Type.Object({
        action: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
        residenceId: Type.Optional(Uuid),
        limit: Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
        cursor: Type.Optional(Type.String({ pattern: '^[0-9]{1,18}$' })),
      }),
      response: {
        200: Type.Object({
          items: Type.Array(Type.Object({
            id: Type.String(), at: Type.String(), action: Type.String(), entity: Type.String(),
            entityId: Nullable(Type.String()), user: Nullable(Person), target: Nullable(Person),
            residence: Nullable(ResidenceRef), details: Nullable(Type.Unknown()), ip: Nullable(Type.String()),
          })),
          nextCursor: Nullable(Type.String()),
        }),
      },
    },
  }, async (request) => {
    const q = request.query;
    let query = db.selectFrom('audit_log as l')
      .leftJoin('users as u', 'u.id', 'l.user_id')
      .leftJoin('users as t', (join) => join.onRef('t.id', '=', 'l.entity_id').on('l.entity', '=', 'user'))
      .leftJoin('residences as r', 'r.id', 'l.residence_id')
      .select(['l.id', 'l.at', 'l.action', 'l.entity', 'l.entity_id', 'l.details', 'l.ip',
               'u.id as user_id', 'u.first_name', 'u.last_name',
               't.id as target_id', 't.first_name as target_first_name', 't.last_name as target_last_name',
               'r.id as rid', 'r.name as rname'])
      // Actions des administrateurs, et événements sans résidence ; jamais
      // le reste de l'activité d'une résidence (c'est son journal à elle)
      .where((eb) => eb.or([eb('l.residence_id', 'is', null), eb('u.role', '=', 'admin')]));
    if (q.action) query = query.where('l.action', '=', q.action);
    if (q.residenceId) query = query.where('l.residence_id', '=', q.residenceId);
    if (q.cursor) query = query.where('l.id', '<', q.cursor);
    const rows = await query.orderBy('l.id', 'desc').limit(q.limit + 1).execute();
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: String(r.id), at: r.at.toISOString(), action: r.action, entity: r.entity, entityId: r.entity_id,
        user: r.user_id ? { id: r.user_id, firstName: r.first_name ?? '', lastName: r.last_name ?? '' } : null,
        target: r.target_id ? { id: r.target_id, firstName: r.target_first_name ?? '', lastName: r.target_last_name ?? '' } : null,
        residence: r.rid ? { id: r.rid, name: r.rname ?? '' } : null,
        details: r.details ?? null,
        ip: r.ip,
      })),
      nextCursor: rows.length > q.limit ? String(page.at(-1)!.id) : null,
    };
  });

  // -------------------------------------------------------------- Assistance

  const OpenGrant = Type.Intersect([AssistanceGrantBody, Type.Object({ residence: ResidenceRef })]);

  app.get('/platform/assistance', {
    schema: { response: { 200: Type.Array(OpenGrant) } },
  }, async () => {
    const rows = await grantQuery(db)
      .innerJoin('residences as r', 'r.id', 'g.residence_id')
      .select(['r.name as residence_name'])
      .where('g.revoked_at', 'is', null).where('g.expires_at', '>', sql<Date>`now()`)
      .where('r.is_active', '=', true)
      .orderBy('g.expires_at').execute();
    return rows.map((r) => ({ ...toGrant(r), residence: { id: r.residence_id, name: r.residence_name } }));
  });

  // Jeton de consultation : valable jusqu'à la fin de l'accès, revérifié à chaque requête
  app.post('/platform/assistance/:id/start', {
    schema: {
      params: IdParams,
      response: {
        200: Type.Object({
          accessToken: Type.String(),
          expiresAt: Type.String(),
          residence: Type.Object({ id: Type.String(), name: Type.String(), type: Type.String() }),
        }),
      },
    },
  }, async (request) => {
    const grant = await db.selectFrom('assistance_grants as g')
      .innerJoin('residences as r', 'r.id', 'g.residence_id')
      .select(['g.id', 'g.residence_id', 'g.expires_at', 'r.name', 'r.type'])
      .where('g.id', '=', request.params.id)
      .where('g.revoked_at', 'is', null).where('g.expires_at', '>', sql<Date>`now()`)
      .where('r.is_active', '=', true)
      .executeTakeFirst();
    if (!grant) throw new HttpError(409, 'assistance_closed', 'Cet accès est terminé ou a été retiré.');
    await audit(db, {
      action: 'assistance_start', entity: 'assistance', entityId: grant.id, userId: request.user.sub,
      residenceId: grant.residence_id, ip: request.ip,
    });
    const payload: AccessTokenPayload = { sub: request.user.sub, rid: grant.residence_id, role: 'admin', asst: grant.id };
    const seconds = Math.max(1, Math.floor((grant.expires_at.getTime() - Date.now()) / 1000));
    return {
      accessToken: app.jwt.sign(payload, { expiresIn: `${seconds}s` }),
      expiresAt: grant.expires_at.toISOString(),
      residence: { id: grant.residence_id, name: grant.name, type: grant.type },
    };
  });

  app.post('/platform/assistance/:id/end', {
    schema: { params: IdParams, response: { 204: Type.Null() } },
  }, async (request, reply) => {
    await db.transaction().execute(async (trx) => {
      const grant = await trx.updateTable('assistance_grants')
        .set({ revoked_at: sql<Date>`now()`, revoked_by: request.user.sub })
        .where('id', '=', request.params.id).where('revoked_at', 'is', null)
        .returning(['id', 'residence_id']).executeTakeFirst();
      if (!grant) throw new HttpError(409, 'assistance_closed', 'Cet accès est déjà terminé.');
      await audit(trx, {
        action: 'assistance_end', entity: 'assistance', entityId: grant.id, userId: request.user.sub,
        residenceId: grant.residence_id, ip: request.ip,
      });
    });
    return reply.code(204).send(null);
  });
};

export default platformRoutes;
