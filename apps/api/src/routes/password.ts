// Mot de passe : demande de réinitialisation, vérification d'un lien,
// choix du mot de passe (invitation ou réinitialisation).
//
//   POST /auth/password/forgot  { email }            → 204 dans tous les cas
//   POST /auth/password/check   { token }            → à qui est ce lien ?
//   POST /auth/password/reset   { token, password }  → 204, sessions fermées
import { Type, type FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'kysely';
import { findOpenToken, invalidateAccountTokens, issueAccountToken, resetMail } from '../lib/account-tokens.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { hashPassword } from '../lib/passwords.js';

export const PASSWORD_MIN_LENGTH = 10;

const TokenInput = Type.String({ minLength: 20, maxLength: 200 });
const invalidLink = () => badRequest('invalid_token', 'Ce lien est invalide ou a expiré. Demandez-en un nouveau.');

const passwordRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, config, mailer } = app;

  // Même réponse que le courriel existe ou non : ne révèle pas qui a un compte
  app.post('/auth/password/forgot', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: Type.Object({ email: Type.String({ minLength: 3, maxLength: 254 }) }) },
  }, async (request, reply) => {
    const email = request.body.email.trim().toLowerCase();
    const user = await db.selectFrom('users').select(['id', 'email', 'first_name', 'residence_id'])
      .where(sql<string>`lower(email)`, '=', email).where('is_active', '=', true)
      .executeTakeFirst();
    if (user) {
      try {
        await db.transaction().execute(async (trx) => {
          const token = await issueAccountToken(trx, user.id, 'reset', null);
          await audit(trx, {
            action: 'password_reset_requested', entity: 'user', entityId: user.id,
            residenceId: user.residence_id, ip: request.ip,
          });
          await mailer.send(resetMail(config, { email: user.email, firstName: user.first_name }, token));
        });
      } catch (err) {
        request.log.error({ err }, 'envoi du courriel de réinitialisation impossible');
      }
    }
    return reply.code(204).send();
  });

  app.post('/auth/password/check', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({ token: TokenInput }),
      response: {
        200: Type.Object({
          purpose: Type.Union([Type.Literal('invite'), Type.Literal('reset')]),
          email: Type.String(),
          firstName: Type.String(),
        }),
      },
    },
  }, async (request) => {
    const row = await findOpenToken(db, request.body.token).executeTakeFirst();
    if (!row) throw invalidLink();
    return { purpose: row.purpose as 'invite' | 'reset', email: row.email, firstName: row.first_name };
  });

  app.post('/auth/password/reset', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: Type.Object({
        token: TokenInput,
        password: Type.String({ minLength: PASSWORD_MIN_LENGTH, maxLength: 200 }),
      }),
    },
  }, async (request, reply) => {
    const { token, password } = request.body;
    const passwordHash = await hashPassword(password);
    await db.transaction().execute(async (trx) => {
      const row = await findOpenToken(trx, token).forUpdate('t').executeTakeFirst();
      if (!row) throw invalidLink();
      if (password.trim().toLowerCase() === row.email.toLowerCase()) {
        throw badRequest('weak_password', 'Le mot de passe ne peut pas être votre courriel.');
      }

      await trx.updateTable('users').set({ password_hash: passwordHash }).where('id', '=', row.user_id).execute();
      await invalidateAccountTokens(trx, row.user_id);       // ce lien et tout autre lien ouvert
      // Toutes les sessions ouvertes sont fermées (ex. : appareil perdu ou volé)
      await trx.updateTable('refresh_tokens').set({ revoked_at: new Date() })
        .where('user_id', '=', row.user_id).where('revoked_at', 'is', null).execute();
      await audit(trx, {
        action: row.purpose === 'invite' ? 'account_activated' : 'password_reset',
        entity: 'user', entityId: row.user_id, userId: row.user_id, residenceId: row.residence_id, ip: request.ip,
      });
    });
    return reply.code(204).send();
  });
};

export default passwordRoutes;
