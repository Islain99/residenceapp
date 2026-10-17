// Mon profil : chacun modifie ses coordonnées et change son mot de passe.
//
//   PATCH /auth/me               { firstName?, lastName?, phone?, avatarColor? }
//   POST  /auth/password/change  { currentPassword, newPassword, signOutOthers? }
//
// Le courriel et le rôle ne se changent pas ici : la responsable (ou
// l'administration de la plateforme) les gère. Tous les comptes, admin
// compris ; jamais en accès d'assistance (lecture seule, app.ts).
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { authenticate } from '../auth.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { linkMail } from '../lib/mailer.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { Nullable } from '../lib/schemas.js';
import { hashToken } from '../lib/tokens.js';
import { AvatarColor, toUserBody, USER_COLUMNS, UserBody } from '../lib/user-view.js';
import { REFRESH_COOKIE } from './auth.js';
import { PASSWORD_MIN_LENGTH } from './password.js';

const PHONE = /^[0-9 +().-]{7,30}$/;   // même règle que la base (0012)

const profileRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config, mailer } = app;
  app.addHook('preHandler', authenticate);

  async function me(userId: string) {
    return toUserBody(await db.selectFrom('users').select(USER_COLUMNS).where('id', '=', userId).executeTakeFirstOrThrow());
  }

  // Coordonnées : seuls les champs envoyés changent
  app.patch('/auth/me', {
    schema: {
      body: Type.Object({
        firstName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        lastName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
        phone: Type.Optional(Nullable(Type.String({ maxLength: 30 }))),   // vide ou null : retiré
        avatarColor: Type.Optional(Nullable(AvatarColor)),               // null : couleur par défaut
      }, { minProperties: 1 }),
      response: { 200: UserBody },
    },
  }, async (request) => {
    const b = request.body;
    const changes: { first_name?: string; last_name?: string; phone?: string | null; avatar_color?: string | null } = {};
    if (b.firstName !== undefined) {
      changes.first_name = b.firstName.trim();
      if (!changes.first_name) throw badRequest('invalid_name', 'Le prénom est obligatoire.');
    }
    if (b.lastName !== undefined) {
      changes.last_name = b.lastName.trim();
      if (!changes.last_name) throw badRequest('invalid_name', 'Le nom est obligatoire.');
    }
    if (b.phone !== undefined) {
      changes.phone = b.phone?.trim() || null;
      if (changes.phone && !PHONE.test(changes.phone)) {
        throw badRequest('invalid_phone', 'Numéro de téléphone invalide (chiffres, espaces, + ( ) . - ; 7 caractères au moins).');
      }
    }
    if (b.avatarColor !== undefined) changes.avatar_color = b.avatarColor;
    // Champs inconnus (courriel, rôle…) : retirés par la validation, il ne reste rien
    if (Object.keys(changes).length === 0) throw badRequest('nothing_to_update', 'Aucun champ modifiable.');

    await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set(changes).where('id', '=', request.user.sub).execute();
      // Le journal note quels champs ont changé, pas leur valeur
      await audit(trx, {
        action: 'profile_update', entity: 'user', entityId: request.user.sub, userId: request.user.sub,
        residenceId: request.user.rid, details: { fields: Object.keys(b) }, ip: request.ip,
      });
    });
    return me(request.user.sub);
  });

  // Nouveau mot de passe, avec l'actuel. Un mauvais mot de passe actuel compte
  // dans le blocage du compte (comme à la connexion) : une session laissée
  // ouverte ne permet pas d'essayer des mots de passe sans limite.
  app.post('/auth/password/change', {
    config: { rateLimit: { max: config.LOGIN_RATE_LIMIT_MAX, timeWindow: '1 minute' } },   // même limite que la connexion
    schema: {
      body: Type.Object({
        currentPassword: Type.String({ minLength: 1, maxLength: 200 }),
        newPassword: Type.String({ minLength: PASSWORD_MIN_LENGTH, maxLength: 200 }),
        signOutOthers: Type.Boolean({ default: true }),   // fermer les sessions des autres appareils
        refreshToken: Type.Optional(Type.String({ maxLength: 200 })),   // session à garder (mode jeton)
      }),
    },
  }, async (request, reply) => {
    const b = request.body;
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'first_name', 'residence_id', 'password_hash', 'locked_until'])
      .where('id', '=', request.user.sub).executeTakeFirstOrThrow();
    // 429 envoyé directement, comme à la connexion : le gestionnaire d'erreurs
    // (app.ts) remplacerait le code par « too_many_requests »
    const locked = () => reply.code(429).send({
      error: 'account_locked', message: 'Trop de mots de passe erronés : compte bloqué quelques minutes.',
    });
    if (user.locked_until && user.locked_until > new Date()) return locked();

    if (!user.password_hash || !await verifyPassword(user.password_hash, b.currentPassword)) {
      const max = config.LOGIN_MAX_ATTEMPTS;
      const row = await db.updateTable('users')
        .set({
          failed_login_count: sql<number>`CASE WHEN failed_login_count + 1 >= ${max} THEN 0 ELSE failed_login_count + 1 END`,
          locked_until: sql<Date | null>`CASE WHEN failed_login_count + 1 >= ${max}
            THEN now() + make_interval(mins => ${config.LOGIN_LOCK_MINUTES}) ELSE locked_until END`,
        })
        .where('id', '=', user.id).returning(['locked_until']).executeTakeFirstOrThrow();
      const nowLocked = row.locked_until !== null && row.locked_until > new Date();
      await audit(db, {
        action: 'password_change_failed', entity: 'user', entityId: user.id, userId: user.id,
        residenceId: user.residence_id, ...(nowLocked ? { details: { locked: true } } : {}), ip: request.ip,
      });
      if (nowLocked) return locked();
      throw badRequest('invalid_current_password', 'Le mot de passe actuel est incorrect.');
    }
    if (b.newPassword === b.currentPassword) {
      throw badRequest('same_password', 'Le nouveau mot de passe doit être différent de l’actuel.');
    }
    if (b.newPassword.trim().toLowerCase() === user.email.toLowerCase()) {
      throw badRequest('weak_password', 'Le mot de passe ne peut pas être votre courriel.');
    }

    const passwordHash = await hashPassword(b.newPassword);
    // Session de cet appareil : cookie (navigateur) ou jeton envoyé (application)
    const current = request.cookies[REFRESH_COOKIE] ?? b.refreshToken;
    let closed = 0;
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('users')
        .set({ password_hash: passwordHash, failed_login_count: 0, locked_until: null })
        .where('id', '=', user.id).execute();
      if (b.signOutOthers) {
        // Sessions EXPIRÉES, pas révoquées : l'autre appareil qui présente son
        // jeton reçoit simplement « session expirée ». Un jeton révoqué
        // présenté de nouveau passerait pour un vol et fermerait toutes les
        // sessions, y compris celle-ci (routes/auth.ts, /auth/refresh).
        let others = trx.updateTable('refresh_tokens').set({ expires_at: sql<Date>`now() - interval '1 second'` })
          .where('user_id', '=', user.id).where('revoked_at', 'is', null).where('expires_at', '>', sql<Date>`now()`);
        if (current) others = others.where('token_hash', '!=', hashToken(current));
        closed = Number((await others.executeTakeFirst()).numUpdatedRows);
      }
      await audit(trx, {
        action: 'password_change', entity: 'user', entityId: user.id, userId: user.id,
        residenceId: user.residence_id, details: { other_sessions_closed: closed }, ip: request.ip,
      });
    });

    // Avis par courriel : si ce n'est pas la personne, elle le sait tout de suite
    try {
      await mailer.send(linkMail(user.email, 'Votre mot de passe a été changé',
        [`Bonjour ${user.first_name},`,
          'Le mot de passe de votre compte du journal de bord vient d’être changé.',
          'Si ce n’est pas vous, choisissez tout de suite un nouveau mot de passe et prévenez votre responsable.'],
        { label: 'Choisir un nouveau mot de passe', url: `${config.APP_URL.replace(/\/$/, '')}/mot-de-passe-oublie` },
        'Courriel automatique, ne pas y répondre.'));
    } catch (err) {
      request.log.error({ err }, 'avis de changement de mot de passe non envoyé');
    }
    return reply.code(200).send({ otherSessionsClosed: closed });
  });
};

export default profileRoutes;
