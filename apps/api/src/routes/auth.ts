// Connexion, rafraîchissement, déconnexion, profil courant.
//
// Jeton d'accès : JWT court (ACCESS_TOKEN_TTL_MINUTES), envoyé dans
//   Authorization: Bearer <jeton>.
// Jeton de rafraîchissement : aléatoire, longue durée, à usage unique.
//   Chaque /auth/refresh le révoque et en remet un nouveau (rotation).
//   Un jeton déjà révoqué présenté de nouveau = vol probable : toutes les
//   sessions de l'utilisateur sont révoquées. Exception : un jeton remplacé
//   (rotation) il y a moins de ROTATION_GRACE_SECONDS — deux rechargements
//   rapprochés, ou une réponse perdue en route — donne une nouvelle session.
// Blocage par compte : LOGIN_MAX_ATTEMPTS mauvais mots de passe d'affilée
//   bloquent le compte LOGIN_LOCK_MINUTES (429 account_locked), quelle que
//   soit l'adresse IP.
// Appareil partagé : le cookie de session disparaît à la fermeture du navigateur.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { audit } from '../lib/audit.js';
import { HttpError } from '../lib/errors.js';
import { burnVerifyTime, verifyPassword } from '../lib/passwords.js';
import {
  BACKUP_CODE_COUNT, decryptSecret, encryptSecret, generateBackupCodes, generateSecret, hashBackupCode,
  looksLikeBackupCode, otpauthUrl, verifyTotp,
} from '../lib/mfa.js';
import { generateRefreshToken, hashToken } from '../lib/tokens.js';
import { authenticate, MFA_ROLES, type AccessTokenPayload, type MfaTokenPayload, type Role } from '../auth.js';
import QRCode from 'qrcode';

const ErrorBody = Type.Object({ error: Type.String(), message: Type.String() });

const UserBody = Type.Object({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  role: Type.String(),
  residenceId: Type.Union([Type.String(), Type.Null()]),
});

const MFA_CHALLENGE_MINUTES = 10;

const TokensBody = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.Optional(Type.String()),   // absent en mode cookie
  expiresIn: Type.Integer(),   // durée de vie du jeton d'accès, en secondes
  // Session ouverte sur un appareil partagé : l'interface déconnecte après 15 min d'inactivité
  sharedDevice: Type.Boolean(),
});

const LoginBody = Type.Intersect([TokensBody, Type.Object({ user: UserBody })]);

// Responsable, admin : le mot de passe est bon, il reste le code de l'application
const MfaChallengeBody = Type.Object({
  mfa: Type.Union([Type.Literal('required'), Type.Literal('setup')]),   // setup : première fois
  mfaToken: Type.String(),
  expiresIn: Type.Integer(),
});

// Jeton dans le corps (application mobile) ou, s'il est absent, dans le cookie (navigateur)
const RefreshTokenInput = Type.Object({
  refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

// Mode cookie (navigateur) : le jeton de rafraîchissement est déposé dans un
// cookie httpOnly, illisible par le JavaScript de la page (un script injecté
// ne peut pas le voler). SameSite=Strict : jamais envoyé depuis un autre site.
export const REFRESH_COOKIE = 'refresh_token';

// Délai pendant lequel un jeton qui vient d'être remplacé reste échangeable
export const ROTATION_GRACE_SECONDS = 30;

const INVALID_CREDENTIALS = { error: 'invalid_credentials', message: 'Courriel ou mot de passe invalide.' };
const INVALID_REFRESH = { error: 'invalid_refresh_token', message: 'Session expirée : se reconnecter.' };
const accountLocked = (minutes: number) => ({
  error: 'account_locked',
  message: `Trop de mots de passe erronés : compte bloqué ${minutes} minutes. `
    + 'Réessayer plus tard ou utiliser « Mot de passe oublié ».',
});

const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config } = app;
  const refreshTtlMs = config.REFRESH_TOKEN_TTL_HOURS * 60 * 60 * 1000;

  // Émet un jeton d'accès + un jeton de rafraîchissement (stocké haché)
  async function issueTokens(
    trx: typeof db,
    payload: AccessTokenPayload,
    userAgent: string | undefined,
    sharedDevice: boolean,
  ) {
    const refreshToken = generateRefreshToken();
    await trx.insertInto('refresh_tokens').values({
      user_id: payload.sub,
      token_hash: hashToken(refreshToken),
      expires_at: new Date(Date.now() + refreshTtlMs),
      user_agent: userAgent?.slice(0, 256) ?? null,
      shared_device: sharedDevice,
    }).execute();
    return {
      accessToken: app.jwt.sign(payload),
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
      sharedDevice,
    };
  }

  // Mode cookie : jeton dans le cookie, retiré du corps de la réponse.
  // Appareil partagé : cookie de session (sans durée), effacé à la fermeture du navigateur.
  function deliver<T extends { refreshToken: string }>(
    reply: FastifyReply, tokens: T, useCookie: boolean, sharedDevice: boolean,
  ) {
    if (!useCookie) return tokens;
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      ...(sharedDevice ? {} : { maxAge: config.REFRESH_TOKEN_TTL_HOURS * 60 * 60 }),
    });
    const { refreshToken: _omitted, ...rest } = tokens;
    return rest;
  }

  const clearCookie = (reply: FastifyReply) => reply.clearCookie(REFRESH_COOKIE, { path: '/' });

  // Jeton présenté : corps d'abord, sinon cookie
  function presentedToken(request: FastifyRequest<{ Body: { refreshToken?: string } }>) {
    if (request.body?.refreshToken) return { token: request.body.refreshToken, fromCookie: false };
    const cookie = request.cookies[REFRESH_COOKIE];
    return cookie ? { token: cookie, fromCookie: true } : null;
  }

  app.post('/auth/login', {
    config: { rateLimit: { max: config.LOGIN_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({
        email: Type.String({ minLength: 3, maxLength: 254 }),
        password: Type.String({ minLength: 1, maxLength: 1024 }),
        // token : jeton de rafraîchissement dans la réponse ; cookie : dans un cookie httpOnly
        session: Type.Union([Type.Literal('token'), Type.Literal('cookie')], { default: 'token' }),
        // Ordinateur ou tablette de la résidence utilisés par plusieurs employés
        sharedDevice: Type.Boolean({ default: false }),
      }),
      response: {
        200: Type.Union([LoginBody, MfaChallengeBody]),
        401: ErrorBody,
        429: ErrorBody,
      },
    },
  }, async (request, reply) => {
    const email = request.body.email.trim().toLowerCase();
    const user = await db.selectFrom('users as u')
      .leftJoin('residences as r', 'r.id', 'u.residence_id')
      .select(['u.id', 'u.email', 'u.password_hash', 'u.first_name', 'u.last_name', 'u.role',
               'u.residence_id', 'u.is_active', 'u.locked_until', 'u.mfa_enabled_at', 'r.is_active as residence_active'])
      .where(sql<string>`lower(u.email)`, '=', email)
      .executeTakeFirst();

    // Compte bloqué : refusé sans même vérifier le mot de passe
    if (user?.locked_until && user.locked_until > new Date()) {
      await audit(db, {
        action: 'login_failed', entity: 'user', entityId: user.id,
        residenceId: user.residence_id, details: { email, reason: 'locked' }, ip: request.ip,
      });
      const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000);
      return reply.code(429).send(accountLocked(minutes));
    }

    let reason: string | null = null;
    if (!user) {
      await burnVerifyTime(request.body.password);
      reason = 'unknown_email';
    } else if (user.password_hash === null) {
      // Invitation pas encore acceptée : aucun mot de passe choisi
      await burnVerifyTime(request.body.password);
      reason = 'not_activated';
    } else if (!(await verifyPassword(user.password_hash, request.body.password))) {
      reason = 'bad_password';
    } else if (!user.is_active || (user.residence_id !== null && user.residence_active === false)) {
      reason = 'inactive';
    }

    if (!user || reason) {
      // Mauvais mot de passe : compteur du compte ; au maximum, blocage et remise à zéro
      const lockedNow = user && reason === 'bad_password' ? await registerFailure(user.id) : false;
      await audit(db, {
        action: 'login_failed', entity: 'user', entityId: user?.id,
        residenceId: user?.residence_id, details: { email, reason, ...(lockedNow ? { locked: true } : {}) },
        ip: request.ip,
      });
      if (lockedNow) return reply.code(429).send(accountLocked(config.LOGIN_LOCK_MINUTES));
      // Même réponse dans tous les cas : ne révèle pas si le compte existe
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    // Responsable, admin : deuxième étape (code de l'application d'authentification).
    // Le compteur d'échecs n'est PAS remis à zéro : les mauvais codes s'y ajoutent.
    if (MFA_ROLES.includes(user.role as Role)) {
      const challenge: MfaTokenPayload = {
        sub: user.id, rid: user.residence_id, role: user.role as Role, typ: 'mfa',
        ses: request.body.session, sd: request.body.sharedDevice,
      };
      return {
        mfa: user.mfa_enabled_at ? 'required' as const : 'setup' as const,
        mfaToken: app.jwt.sign(challenge, { expiresIn: `${MFA_CHALLENGE_MINUTES}m` }),
        expiresIn: MFA_CHALLENGE_MINUTES * 60,
      };
    }

    return completeLogin(reply, user.id, request.body.session === 'cookie', request.body.sharedDevice, request.ip,
      request.headers['user-agent']);
  });

  // Échec de connexion (mauvais mot de passe ou mauvais code) : compteur du
  // compte ; au maximum, blocage et remise à zéro. Renvoie true si bloqué.
  async function registerFailure(userId: string): Promise<boolean> {
    const max = config.LOGIN_MAX_ATTEMPTS;
    const row = await db.updateTable('users')
      .set({
        failed_login_count: sql<number>`CASE WHEN failed_login_count + 1 >= ${max} THEN 0 ELSE failed_login_count + 1 END`,
        locked_until: sql<Date | null>`CASE WHEN failed_login_count + 1 >= ${max}
          THEN now() + make_interval(mins => ${config.LOGIN_LOCK_MINUTES}) ELSE locked_until END`,
      })
      .where('id', '=', userId)
      .returning(['locked_until'])
      .executeTakeFirstOrThrow();
    return row.locked_until !== null && row.locked_until > new Date();
  }

  // Connexion réussie : sessions, journal, réponse
  async function completeLogin(reply: FastifyReply, userId: string, useCookie: boolean, sharedDevice: boolean,
    ip: string, userAgent: string | undefined, details?: Record<string, string | number>) {
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'first_name', 'last_name', 'role', 'residence_id'])
      .where('id', '=', userId).executeTakeFirstOrThrow();
    const payload: AccessTokenPayload = { sub: user.id, rid: user.residence_id, role: user.role as Role };
    const tokens = await db.transaction().execute(async (trx) => {
      await trx.updateTable('users')
        .set({ last_login_at: new Date(), failed_login_count: 0, locked_until: null })
        .where('id', '=', user.id).execute();
      await audit(trx, {
        action: 'login', entity: 'user', entityId: user.id, userId: user.id,
        residenceId: user.residence_id, ip, ...(details ? { details } : {}),
      });
      return issueTokens(trx, payload, userAgent, sharedDevice);
    });
    return {
      ...deliver(reply, tokens, useCookie, sharedDevice),
      user: {
        id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
        role: user.role, residenceId: user.residence_id,
      },
    };
  }

  // ------------------------------------------------- Double authentification
  //
  // Étape 2 de la connexion (jeton « mfa » de 10 min, reçu à l'étape 1) :
  //   POST /auth/mfa/verify  { mfaToken, code }   code à 6 chiffres ou code de secours
  //   POST /auth/mfa/setup   { mfaToken }         première fois : secret + code QR
  //   POST /auth/mfa/enable  { mfaToken, code }   confirme l'application → codes de secours + session
  // Connecté :
  //   GET  /auth/mfa                              état (activée, codes de secours restants)
  //   POST /auth/mfa/backup-codes { code }        nouvelle série de codes de secours

  function readChallenge(token: string): MfaTokenPayload {
    try {
      const payload = app.jwt.verify<MfaTokenPayload>(token);
      if (payload.typ === 'mfa') return payload;
    } catch {
      // expiré ou falsifié
    }
    throw new HttpError(401, 'mfa_expired', 'Étape de vérification expirée : se reconnecter.');
  }

  async function challengedUser(challenge: MfaTokenPayload) {
    const user = await db.selectFrom('users as u')
      .leftJoin('residences as r', 'r.id', 'u.residence_id')
      .select(['u.id', 'u.email', 'u.role', 'u.residence_id', 'u.is_active', 'u.locked_until', 'u.mfa_secret',
               'u.mfa_enabled_at', 'u.mfa_last_step', 'r.is_active as residence_active'])
      .where('u.id', '=', challenge.sub).executeTakeFirst();
    if (!user || !user.is_active || (user.residence_id !== null && user.residence_active === false)) {
      throw new HttpError(401, 'mfa_expired', 'Étape de vérification expirée : se reconnecter.');
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new HttpError(429, 'account_locked', accountLocked(Math.ceil((user.locked_until.getTime() - Date.now()) / 60_000)).message);
    }
    return user;
  }

  async function failedCode(user: { id: string; residence_id: string | null }, ip: string) {
    const locked = await registerFailure(user.id);
    await audit(db, {
      action: 'login_failed', entity: 'user', entityId: user.id, residenceId: user.residence_id,
      details: { reason: 'bad_mfa_code', ...(locked ? { locked: true } : {}) }, ip,
    });
    if (locked) throw new HttpError(429, 'account_locked', accountLocked(config.LOGIN_LOCK_MINUTES).message);
    throw new HttpError(401, 'invalid_mfa_code', 'Code invalide ou déjà utilisé.');
  }

  async function storeBackupCodes(trx: typeof db, userId: string): Promise<string[]> {
    await trx.updateTable('mfa_backup_codes').set({ revoked_at: sql<Date>`now()` })
      .where('user_id', '=', userId).where('used_at', 'is', null).where('revoked_at', 'is', null).execute();
    const codes = generateBackupCodes();
    await trx.insertInto('mfa_backup_codes')
      .values(codes.map((c) => ({ user_id: userId, code_hash: hashBackupCode(c) }))).execute();
    return codes;
  }

  const remainingBackupCodes = async (userId: string) => {
    const { n } = await db.selectFrom('mfa_backup_codes').select((c) => c.fn.countAll<string>().as('n'))
      .where('user_id', '=', userId).where('used_at', 'is', null).where('revoked_at', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(n);
  };

  const MfaCode = Type.String({ minLength: 6, maxLength: 20 });

  app.post('/auth/mfa/verify', {
    config: { rateLimit: { max: config.LOGIN_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({ mfaToken: Type.String({ minLength: 1, maxLength: 2000 }), code: MfaCode }),
      response: { 200: Type.Intersect([LoginBody, Type.Object({ backupCodesRemaining: Type.Integer() })]), 401: ErrorBody, 429: ErrorBody },
    },
  }, async (request, reply) => {
    const challenge = readChallenge(request.body.mfaToken);
    const user = await challengedUser(challenge);
    if (!user.mfa_enabled_at || !user.mfa_secret) throw new HttpError(409, 'mfa_not_enabled', 'Double authentification à configurer.');

    let method: 'totp' | 'backup';
    if (looksLikeBackupCode(request.body.code)) {
      const used = await db.updateTable('mfa_backup_codes').set({ used_at: sql<Date>`now()` })
        .where('user_id', '=', user.id).where('code_hash', '=', hashBackupCode(request.body.code))
        .where('used_at', 'is', null).where('revoked_at', 'is', null)
        .returning('id').executeTakeFirst();
      if (!used) return failedCode(user, request.ip);
      method = 'backup';
    } else {
      const step = verifyTotp(decryptSecret(config, user.mfa_secret), request.body.code,
        user.mfa_last_step === null ? null : Number(user.mfa_last_step));
      if (step === null) return failedCode(user, request.ip);
      // Pas de rejeu : un code accepté ne sert plus (mise à jour conditionnelle)
      const claimed = await db.updateTable('users').set({ mfa_last_step: String(step) })
        .where('id', '=', user.id)
        .where((eb) => eb.or([eb('mfa_last_step', 'is', null), eb('mfa_last_step', '<', String(step))]))
        .returning('id').executeTakeFirst();
      if (!claimed) return failedCode(user, request.ip);
      method = 'totp';
    }
    const result = await completeLogin(reply, user.id, challenge.ses === 'cookie', challenge.sd, request.ip,
      request.headers['user-agent'], { mfa: method });
    return { ...result, backupCodesRemaining: await remainingBackupCodes(user.id) };
  });

  app.post('/auth/mfa/setup', {
    schema: {
      body: Type.Object({ mfaToken: Type.String({ minLength: 1, maxLength: 2000 }) }),
      response: { 200: Type.Object({ secret: Type.String(), otpauthUrl: Type.String(), qrSvg: Type.String() }), 401: ErrorBody },
    },
  }, async (request) => {
    const user = await challengedUser(readChallenge(request.body.mfaToken));
    if (user.mfa_enabled_at) throw new HttpError(409, 'mfa_already_enabled', 'Double authentification déjà activée.');
    // Nouveau secret à chaque demande ; il ne vaut qu'une fois confirmé (enable)
    const secret = generateSecret();
    await db.updateTable('users').set({ mfa_secret: encryptSecret(config, secret), mfa_last_step: null })
      .where('id', '=', user.id).execute();
    const url = otpauthUrl(config.MFA_ISSUER, user.email, secret);
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, otpauthUrl: url, qrSvg };
  });

  app.post('/auth/mfa/enable', {
    config: { rateLimit: { max: config.LOGIN_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({ mfaToken: Type.String({ minLength: 1, maxLength: 2000 }), code: MfaCode }),
      response: { 200: Type.Intersect([LoginBody, Type.Object({ backupCodes: Type.Array(Type.String()) })]), 401: ErrorBody },
    },
  }, async (request, reply) => {
    const challenge = readChallenge(request.body.mfaToken);
    const user = await challengedUser(challenge);
    if (user.mfa_enabled_at) throw new HttpError(409, 'mfa_already_enabled', 'Double authentification déjà activée.');
    if (!user.mfa_secret) throw new HttpError(409, 'mfa_setup_first', 'Afficher d’abord le code QR.');
    const step = verifyTotp(decryptSecret(config, user.mfa_secret), request.body.code, null);
    if (step === null) return failedCode(user, request.ip);

    const backupCodes = await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ mfa_enabled_at: sql<Date>`now()`, mfa_last_step: String(step) })
        .where('id', '=', user.id).execute();
      await audit(trx, {
        action: 'mfa_enabled', entity: 'user', entityId: user.id, userId: user.id,
        residenceId: user.residence_id, ip: request.ip,
      });
      return storeBackupCodes(trx, user.id);
    });
    const result = await completeLogin(reply, user.id, challenge.ses === 'cookie', challenge.sd, request.ip,
      request.headers['user-agent'], { mfa: 'setup' });
    return { ...result, backupCodes };
  });

  app.get('/auth/mfa', {
    preHandler: authenticate,
    schema: {
      response: {
        200: Type.Object({
          required: Type.Boolean(),
          enabled: Type.Boolean(),
          enabledAt: Type.Union([Type.String(), Type.Null()]),
          backupCodesRemaining: Type.Integer(),
        }),
      },
    },
  }, async (request) => {
    const user = await db.selectFrom('users').select(['id', 'role', 'mfa_enabled_at'])
      .where('id', '=', request.user.sub).executeTakeFirstOrThrow();
    return {
      required: MFA_ROLES.includes(user.role as Role),
      enabled: user.mfa_enabled_at !== null,
      enabledAt: user.mfa_enabled_at?.toISOString() ?? null,
      backupCodesRemaining: await remainingBackupCodes(user.id),
    };
  });

  app.post('/auth/mfa/backup-codes', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({ code: MfaCode }),
      response: { 200: Type.Object({ backupCodes: Type.Array(Type.String()) }), 401: ErrorBody },
    },
  }, async (request) => {
    if (request.assistance) throw new HttpError(403, 'assistance_read_only', 'Accès d’assistance : consultation seulement.');
    const user = await db.selectFrom('users').select(['id', 'residence_id', 'mfa_secret', 'mfa_enabled_at', 'mfa_last_step'])
      .where('id', '=', request.user.sub).executeTakeFirstOrThrow();
    if (!user.mfa_enabled_at || !user.mfa_secret) throw new HttpError(409, 'mfa_not_enabled', 'Double authentification non activée.');
    const step = verifyTotp(decryptSecret(config, user.mfa_secret), request.body.code,
      user.mfa_last_step === null ? null : Number(user.mfa_last_step));
    if (step === null) return failedCode(user, request.ip);
    const backupCodes = await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ mfa_last_step: String(step) }).where('id', '=', user.id).execute();
      await audit(trx, {
        action: 'mfa_backup_codes', entity: 'user', entityId: user.id, userId: user.id,
        residenceId: user.residence_id, details: { count: BACKUP_CODE_COUNT }, ip: request.ip,
      });
      return storeBackupCodes(trx, user.id);
    });
    return { backupCodes };
  });

  app.post('/auth/refresh', {
    schema: { body: RefreshTokenInput, response: { 200: TokensBody, 401: ErrorBody } },
  }, async (request, reply) => {
    const presented = presentedToken(request);
    if (!presented) return reply.code(401).send(INVALID_REFRESH);
    const tokenHash = hashToken(presented.token);

    // Le résultat est renvoyé (pas d'exception) pour que la révocation
    // en cas de réutilisation soit bien validée (COMMIT).
    const result = await db.transaction().execute(async (trx) => {
      const row = await trx.selectFrom('refresh_tokens as t')
        .innerJoin('users as u', 'u.id', 't.user_id')
        .leftJoin('residences as r', 'r.id', 'u.residence_id')
        .select(['t.id', 't.revoked_at', 't.rotated_at', 't.expires_at', 't.shared_device', 'u.id as user_id', 'u.role',
                 'u.residence_id', 'u.is_active', 'r.is_active as residence_active'])
        .where('t.token_hash', '=', tokenHash)
        .forUpdate('t')   // deux rafraîchissements simultanés : le second attend
        .executeTakeFirst();

      if (!row) return null;
      const active = row.is_active && (row.residence_id === null || row.residence_active !== false);
      const issue = () => issueTokens(trx, { sub: row.user_id, rid: row.residence_id, role: row.role as Role },
        request.headers['user-agent'], row.shared_device);

      // Remplacé à l'instant : même navigateur dont la réponse s'est perdue
      // (rechargement pendant le renouvellement). Nouvelle session, pas d'alerte.
      const graceUntil = row.rotated_at ? row.rotated_at.getTime() + ROTATION_GRACE_SECONDS * 1000 : 0;
      if (row.revoked_at !== null && row.rotated_at !== null && Date.now() < graceUntil) {
        if (row.expires_at <= new Date() || !active) return null;
        return { tokens: await issue(), sharedDevice: row.shared_device };
      }

      if (row.revoked_at !== null) {
        await trx.updateTable('refresh_tokens').set({ revoked_at: new Date() })
          .where('user_id', '=', row.user_id).where('revoked_at', 'is', null).execute();
        await audit(trx, {
          action: 'refresh_reuse', entity: 'user', entityId: row.user_id, userId: row.user_id,
          residenceId: row.residence_id, details: { token_id: row.id }, ip: request.ip,
        });
        return null;
      }

      if (row.expires_at <= new Date() || !active) {
        await trx.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('id', '=', row.id).execute();
        return null;
      }
      const now = new Date();
      await trx.updateTable('refresh_tokens').set({ revoked_at: now, rotated_at: now }).where('id', '=', row.id).execute();
      return { tokens: await issue(), sharedDevice: row.shared_device };
    });

    if (!result) {
      if (presented.fromCookie) clearCookie(reply);
      return reply.code(401).send(INVALID_REFRESH);
    }
    return deliver(reply, result.tokens, presented.fromCookie, result.sharedDevice);
  });

  app.post('/auth/logout', {
    schema: { body: RefreshTokenInput },
  }, async (request, reply) => {
    const presented = presentedToken(request);
    clearCookie(reply);
    if (!presented) return reply.code(204).send();
    const revoked = await db.updateTable('refresh_tokens').set({ revoked_at: new Date() })
      .where('token_hash', '=', hashToken(presented.token))
      .where('revoked_at', 'is', null)
      .returning(['user_id'])
      .executeTakeFirst();
    if (revoked) {
      await audit(db, {
        action: 'logout', entity: 'user', entityId: revoked.user_id, userId: revoked.user_id, ip: request.ip,
      });
    }
    return reply.code(204).send();
  });

  app.get('/auth/me', {
    preHandler: authenticate,
    schema: { response: { 200: UserBody, 401: ErrorBody } },
  }, async (request, reply) => {
    const user = await db.selectFrom('users')
      .select(['id', 'email', 'first_name', 'last_name', 'role', 'residence_id', 'is_active'])
      .where('id', '=', request.user.sub)
      .executeTakeFirst();
    if (!user || !user.is_active) {
      return reply.code(401).send({ error: 'inactive_account', message: 'Compte désactivé.' });
    }
    return {
      id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
      role: user.role, residenceId: user.residence_id,
    };
  });
};

export default authRoutes;
