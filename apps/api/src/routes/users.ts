// Comptes des employés de la résidence — réservé à la responsable.
//
//   * Ajouter un employé : nom, courriel, rôle. Il reçoit une invitation par
//     courriel et choisit lui-même son mot de passe (personne d'autre ne le connaît).
//   * Renvoyer une invitation, changer un nom ou un rôle, désactiver / réactiver.
//     Désactiver ferme immédiatement ses sessions et annule ses liens ouverts.
//   * La responsable ne peut ni se désactiver ni changer son propre rôle
//     (la résidence resterait sans responsable).
//   * Aucune suppression : un compte désactivé garde son historique.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql, type Updateable } from 'kysely';
import { requireRole, residenceOf } from '../auth.js';
import type { Users } from '../db/types.js';
import { invalidateAccountTokens, inviteMail, issueAccountToken } from '../lib/account-tokens.js';
import { audit } from '../lib/audit.js';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import type { Db } from '../lib/note-view.js';
import { IdParams, Nullable, Text } from '../lib/schemas.js';

const StaffRole = Type.Union([Type.Literal('prepose'), Type.Literal('infirmiere'), Type.Literal('responsable')]);

const Account = Type.Object({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  role: Type.String(),
  isActive: Type.Boolean(),
  status: Type.Union([Type.Literal('invited'), Type.Literal('active'), Type.Literal('inactive')]),
  lastLoginAt: Nullable(Type.String()),
  invitationExpiresAt: Nullable(Type.String()),   // invitation en attente
});

function accountQuery(db: Db, residenceId: string) {
  return db.selectFrom('users as u')
    .where('u.residence_id', '=', residenceId)
    .select((eb) => [
      'u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.role', 'u.is_active', 'u.last_login_at',
      sql<boolean>`u.password_hash IS NULL`.as('invited'),
      eb.selectFrom('account_tokens as t').whereRef('t.user_id', '=', 'u.id')
        .where('t.purpose', '=', 'invite').where('t.used_at', 'is', null)
        .select((t) => t.fn.max('t.expires_at').as('e')).as('invitation_expires_at'),
    ]);
}

type AccountRow = Awaited<ReturnType<ReturnType<typeof accountQuery>['executeTakeFirstOrThrow']>>;

const toAccount = (row: AccountRow) => ({
  id: row.id,
  email: row.email,
  firstName: row.first_name,
  lastName: row.last_name,
  role: row.role,
  isActive: row.is_active,
  status: !row.is_active ? 'inactive' as const : row.invited ? 'invited' as const : 'active' as const,
  lastLoginAt: row.last_login_at?.toISOString() ?? null,
  invitationExpiresAt: row.invitation_expires_at ? new Date(row.invitation_expires_at).toISOString() : null,
});

const userRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config, mailer } = app;
  app.addHook('preHandler', requireRole('responsable'));

  async function findAccount(residenceId: string, id: string) {
    const row = await accountQuery(db, residenceId).where('u.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Employé introuvable.');
    return toAccount(row);
  }

  // Envoie l'invitation dans la transaction : si le courriel échoue, rien n'est enregistré
  async function sendInvite(trx: Db, user: { id: string; email: string; first_name: string },
    residenceId: string, inviterId: string) {
    const context = await trx.selectFrom('users as me')
      .innerJoin('residences as r', 'r.id', 'me.residence_id')
      .select(['me.first_name', 'me.last_name', 'r.name'])
      .where('me.id', '=', inviterId).where('r.id', '=', residenceId)
      .executeTakeFirstOrThrow();
    const token = await issueAccountToken(trx, user.id, 'invite', inviterId);
    try {
      await mailer.send(inviteMail(config, { email: user.email, firstName: user.first_name }, token,
        `${context.first_name} ${context.last_name}`, context.name));
    } catch {
      throw new HttpError(502, 'mail_failed', "Le courriel d'invitation n'a pas pu être envoyé. Réessayer plus tard.");
    }
  }

  app.get('/users', {
    schema: { response: { 200: Type.Array(Account) } },
  }, async (request) => {
    const rows = await accountQuery(db, residenceOf(request))
      .orderBy('u.is_active', 'desc')
      .orderBy(sql`u.last_name COLLATE "fr-CA-x-icu"`)
      .orderBy(sql`u.first_name COLLATE "fr-CA-x-icu"`)
      .execute();
    return rows.map(toAccount);
  });

  app.post('/users', {
    schema: {
      body: Type.Object({
        email: Type.String({ format: 'email', maxLength: 254 }),
        firstName: Text(100),
        lastName: Text(100),
        role: StaffRole,
      }),
      response: { 201: Account },
    },
  }, async (request, reply) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const email = b.email.trim().toLowerCase();
    const firstName = b.firstName.trim();
    const lastName = b.lastName.trim();
    if (!firstName || !lastName) throw badRequest('invalid_name', 'Prénom et nom obligatoires.');

    const id = await db.transaction().execute(async (trx) => {
      const taken = await trx.selectFrom('users').select('id').where(sql<string>`lower(email)`, '=', email).executeTakeFirst();
      if (taken) throw new HttpError(409, 'email_taken', 'Ce courriel est déjà utilisé par un compte.');

      const user = await trx.insertInto('users').values({
        residence_id: residenceId, email, first_name: firstName, last_name: lastName,
        role: b.role, password_hash: null,
      }).returning(['id', 'email', 'first_name']).executeTakeFirstOrThrow();
      await audit(trx, {
        action: 'create', entity: 'user', entityId: user.id, userId: request.user.sub, residenceId,
        details: { role: b.role }, ip: request.ip,
      });
      await sendInvite(trx, user, residenceId, request.user.sub);
      return user.id;
    });
    return reply.code(201).send(await findAccount(residenceId, id));
  });

  // Nouvelle invitation (l'ancienne ne vaut plus rien)
  app.post('/users/:id/invite', {
    schema: { params: IdParams, response: { 200: Account } },
  }, async (request) => {
    const residenceId = residenceOf(request);
    await db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select(['id', 'email', 'first_name', 'is_active', 'password_hash'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate().executeTakeFirst();
      if (!user) throw notFound('Employé introuvable.');
      if (!user.is_active) throw new HttpError(409, 'inactive_account', 'Compte désactivé : le réactiver d’abord.');
      if (user.password_hash !== null) {
        throw new HttpError(409, 'already_active', 'Ce compte est déjà activé. En cas d’oubli : « Mot de passe oublié » à la connexion.');
      }
      await audit(trx, {
        action: 'invite', entity: 'user', entityId: user.id, userId: request.user.sub, residenceId, ip: request.ip,
      });
      await sendInvite(trx, user, residenceId, request.user.sub);
    });
    return findAccount(residenceId, request.params.id);
  });

  app.patch('/users/:id', {
    schema: {
      params: IdParams,
      body: Type.Object({
        firstName: Type.Optional(Text(100)),
        lastName: Type.Optional(Text(100)),
        role: Type.Optional(StaffRole),
        isActive: Type.Optional(Type.Boolean()),
      }, { minProperties: 1 }),
      response: { 200: Account },
    },
  }, async (request) => {
    const residenceId = residenceOf(request);
    const b = request.body;
    const self = request.params.id === request.user.sub;
    if (self && (b.role !== undefined || b.isActive !== undefined)) {
      throw badRequest('cannot_modify_self', 'Vous ne pouvez pas changer votre propre rôle ni désactiver votre compte.');
    }

    await db.transaction().execute(async (trx) => {
      const user = await trx.selectFrom('users').select(['id', 'is_active'])
        .where('id', '=', request.params.id).where('residence_id', '=', residenceId)
        .forUpdate().executeTakeFirst();
      if (!user) throw notFound('Employé introuvable.');

      const changes: Updateable<Users> = {};
      if (b.firstName !== undefined) changes.first_name = b.firstName.trim();
      if (b.lastName !== undefined) changes.last_name = b.lastName.trim();
      if (changes.first_name === '' || changes.last_name === '') throw badRequest('invalid_name', 'Prénom et nom obligatoires.');
      if (b.role !== undefined) changes.role = b.role;
      if (b.isActive !== undefined) changes.is_active = b.isActive;
      await trx.updateTable('users').set(changes).where('id', '=', user.id).execute();

      if (b.isActive === false && user.is_active) {
        // Désactivation : sessions fermées et liens annulés tout de suite
        await trx.updateTable('refresh_tokens').set({ revoked_at: new Date() })
          .where('user_id', '=', user.id).where('revoked_at', 'is', null).execute();
        await invalidateAccountTokens(trx, user.id);
      }
      await audit(trx, {
        action: b.isActive === false ? 'deactivate' : b.isActive === true && !user.is_active ? 'reactivate' : 'update',
        entity: 'user', entityId: user.id, userId: request.user.sub, residenceId,
        details: { fields: Object.keys(b) }, ip: request.ip,
      });
    });
    return findAccount(residenceId, request.params.id);
  });
};

export default userRoutes;
