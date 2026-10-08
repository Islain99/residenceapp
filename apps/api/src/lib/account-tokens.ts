// Liens à usage unique envoyés par courriel : invitation (choisir son mot de
// passe) et réinitialisation (mot de passe oublié). Seul le SHA-256 du jeton
// est stocké ; le jeton voyage dans le fragment de l'adresse (#…), qui n'est
// jamais envoyé à un serveur ni noté dans un journal.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Config } from '../config.js';
import type { DB } from '../db/types.js';
import { linkMail, type Mail } from './mailer.js';
import { generateRefreshToken, hashToken } from './tokens.js';

type Db = Kysely<DB> | Transaction<DB>;
export type Purpose = 'invite' | 'reset';

const TTL_HOURS: Record<Purpose, number> = { invite: 72, reset: 1 };

// Nouveau lien ; les liens encore ouverts de cet utilisateur ne valent plus rien
export async function issueAccountToken(db: Db, userId: string, purpose: Purpose, createdBy: string | null): Promise<string> {
  await invalidateAccountTokens(db, userId);
  const token = generateRefreshToken();
  await db.insertInto('account_tokens').values({
    user_id: userId,
    purpose,
    token_hash: hashToken(token),
    expires_at: sql<Date>`now() + make_interval(hours => ${TTL_HOURS[purpose]})`,
    created_by: createdBy,
  }).execute();
  return token;
}

export async function invalidateAccountTokens(db: Db, userId: string): Promise<void> {
  await db.updateTable('account_tokens').set({ used_at: sql<Date>`now()` })
    .where('user_id', '=', userId).where('used_at', 'is', null).execute();
}

// Lien encore valable (non utilisé, non expiré, compte actif), verrouillé pour l'utiliser
export function findOpenToken(db: Db, token: string) {
  return db.selectFrom('account_tokens as t')
    .innerJoin('users as u', 'u.id', 't.user_id')
    .select(['t.id', 't.purpose', 't.user_id', 'u.email', 'u.first_name', 'u.residence_id'])
    .where('t.token_hash', '=', hashToken(token))
    .where('t.used_at', 'is', null)
    .where('t.expires_at', '>', sql<Date>`now()`)
    .where('u.is_active', '=', true);
}

const passwordLink = (config: Config, token: string) => `${config.APP_URL.replace(/\/$/, '')}/mot-de-passe#${token}`;

export function inviteMail(config: Config, to: { email: string; firstName: string }, token: string,
  invitedBy: string, residence: string): Mail {
  return linkMail(
    to.email,
    `Votre accès au journal de bord — ${residence}`,
    [
      `Bonjour ${to.firstName},`,
      `${invitedBy} vous a créé un accès au journal de bord de ${residence}.`,
      'Pour l’activer, choisissez votre mot de passe. Le lien est valable 72 heures.',
    ],
    { label: 'Choisir mon mot de passe', url: passwordLink(config, token) },
    'Si vous n’attendiez pas ce message, vous pouvez l’ignorer.',
  );
}

export function resetMail(config: Config, to: { email: string; firstName: string }, token: string): Mail {
  return linkMail(
    to.email,
    'Réinitialiser votre mot de passe — Journal de bord',
    [
      `Bonjour ${to.firstName},`,
      'Vous avez demandé à changer votre mot de passe. Le lien est valable 1 heure et ne sert qu’une fois.',
    ],
    { label: 'Choisir un nouveau mot de passe', url: passwordLink(config, token) },
    'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.',
  );
}
