// Connexion, rafraîchissement, déconnexion, profil courant.
//
// Jeton d'accès : JWT court (ACCESS_TOKEN_TTL_MINUTES), envoyé dans
//   Authorization: Bearer <jeton>.
// Jeton de rafraîchissement : aléatoire, longue durée, à usage unique.
//   Chaque /auth/refresh le révoque et en remet un nouveau (rotation).
//   Un jeton déjà révoqué présenté de nouveau = vol probable : toutes les
//   sessions de l'utilisateur sont révoquées.
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { audit } from '../lib/audit.js';
import { burnVerifyTime, verifyPassword } from '../lib/passwords.js';
import { generateRefreshToken, hashToken } from '../lib/tokens.js';
import { authenticate, type AccessTokenPayload, type Role } from '../auth.js';

const ErrorBody = Type.Object({ error: Type.String(), message: Type.String() });

const UserBody = Type.Object({
  id: Type.String(),
  email: Type.String(),
  firstName: Type.String(),
  lastName: Type.String(),
  role: Type.String(),
  residenceId: Type.Union([Type.String(), Type.Null()]),
});

const TokensBody = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.Optional(Type.String()),   // absent en mode cookie
  expiresIn: Type.Integer(),   // durée de vie du jeton d'accès, en secondes
});

// Jeton dans le corps (application mobile) ou, s'il est absent, dans le cookie (navigateur)
const RefreshTokenInput = Type.Object({
  refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

// Mode cookie (navigateur) : le jeton de rafraîchissement est déposé dans un
// cookie httpOnly, illisible par le JavaScript de la page (un script injecté
// ne peut pas le voler). SameSite=Strict : jamais envoyé depuis un autre site.
export const REFRESH_COOKIE = 'refresh_token';

const INVALID_CREDENTIALS = { error: 'invalid_credentials', message: 'Courriel ou mot de passe invalide.' };
const INVALID_REFRESH = { error: 'invalid_refresh_token', message: 'Session expirée : se reconnecter.' };

const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config } = app;
  const refreshTtlMs = config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

  // Émet un jeton d'accès + un jeton de rafraîchissement (stocké haché)
  async function issueTokens(
    trx: typeof db,
    payload: AccessTokenPayload,
    userAgent: string | undefined,
  ) {
    const refreshToken = generateRefreshToken();
    await trx.insertInto('refresh_tokens').values({
      user_id: payload.sub,
      token_hash: hashToken(refreshToken),
      expires_at: new Date(Date.now() + refreshTtlMs),
      user_agent: userAgent?.slice(0, 256) ?? null,
    }).execute();
    return {
      accessToken: app.jwt.sign(payload),
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
    };
  }

  // Mode cookie : jeton dans le cookie, retiré du corps de la réponse
  function deliver<T extends { refreshToken: string }>(reply: FastifyReply, tokens: T, useCookie: boolean) {
    if (!useCookie) return tokens;
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
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
      }),
      response: {
        200: Type.Intersect([TokensBody, Type.Object({ user: UserBody })]),
        401: ErrorBody,
      },
    },
  }, async (request, reply) => {
    const email = request.body.email.trim().toLowerCase();
    const user = await db.selectFrom('users as u')
      .leftJoin('residences as r', 'r.id', 'u.residence_id')
      .select(['u.id', 'u.email', 'u.password_hash', 'u.first_name', 'u.last_name', 'u.role',
               'u.residence_id', 'u.is_active', 'r.is_active as residence_active'])
      .where(sql<string>`lower(u.email)`, '=', email)
      .executeTakeFirst();

    let reason: string | null = null;
    if (!user) {
      await burnVerifyTime(request.body.password);
      reason = 'unknown_email';
    } else if (!(await verifyPassword(user.password_hash, request.body.password))) {
      reason = 'bad_password';
    } else if (!user.is_active || (user.residence_id !== null && user.residence_active === false)) {
      reason = 'inactive';
    }

    if (!user || reason) {
      await audit(db, {
        action: 'login_failed', entity: 'user', entityId: user?.id,
        residenceId: user?.residence_id, details: { email, reason }, ip: request.ip,
      });
      // Même réponse dans tous les cas : ne révèle pas si le compte existe
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    const payload: AccessTokenPayload = { sub: user.id, rid: user.residence_id, role: user.role as Role };
    const tokens = await db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ last_login_at: new Date() }).where('id', '=', user.id).execute();
      await audit(trx, {
        action: 'login', entity: 'user', entityId: user.id, userId: user.id,
        residenceId: user.residence_id, ip: request.ip,
      });
      return issueTokens(trx, payload, request.headers['user-agent']);
    });

    return {
      ...deliver(reply, tokens, request.body.session === 'cookie'),
      user: {
        id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name,
        role: user.role, residenceId: user.residence_id,
      },
    };
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
        .select(['t.id', 't.revoked_at', 't.expires_at', 'u.id as user_id', 'u.role',
                 'u.residence_id', 'u.is_active', 'r.is_active as residence_active'])
        .where('t.token_hash', '=', tokenHash)
        .forUpdate('t')   // deux rafraîchissements simultanés : le second attend
        .executeTakeFirst();

      if (!row) return null;

      if (row.revoked_at !== null) {
        await trx.updateTable('refresh_tokens').set({ revoked_at: new Date() })
          .where('user_id', '=', row.user_id).where('revoked_at', 'is', null).execute();
        await audit(trx, {
          action: 'refresh_reuse', entity: 'user', entityId: row.user_id, userId: row.user_id,
          residenceId: row.residence_id, details: { token_id: row.id }, ip: request.ip,
        });
        return null;
      }

      await trx.updateTable('refresh_tokens').set({ revoked_at: new Date() }).where('id', '=', row.id).execute();
      const active = row.is_active && (row.residence_id === null || row.residence_active !== false);
      if (row.expires_at <= new Date() || !active) return null;

      return issueTokens(trx, { sub: row.user_id, rid: row.residence_id, role: row.role as Role },
        request.headers['user-agent']);
    });

    if (!result) {
      if (presented.fromCookie) clearCookie(reply);
      return reply.code(401).send(INVALID_REFRESH);
    }
    return deliver(reply, result, presented.fromCookie);
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
