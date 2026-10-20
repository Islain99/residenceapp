// Liens à usage unique envoyés par courriel : invitation (choisir son mot de
// passe) et réinitialisation (mot de passe oublié). Seul le SHA-256 du jeton
// est stocké ; le jeton voyage dans le fragment de l'adresse (#…), qui n'est
// jamais envoyé à un serveur ni noté dans un journal.
import { sql, type Kysely, type Transaction } from 'kysely';
import type { Config } from '../config.js';
import type { DB } from '../db/types.js';
import { asLocale, MAIL_TEXT } from './locale.js';
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

// Destinataire : le courriel part dans la langue de son compte (users.locale)
interface Recipient { email: string; firstName: string; locale: string | null }

// invitedBy, place : null = l'administration de la plateforme
export function inviteMail(config: Config, to: Recipient, token: string,
  invitedBy: string | null, place: string | null): Mail {
  const locale = asLocale(to.locale);
  const m = MAIL_TEXT[locale];
  const where = place ?? m.invite.platformPlace;
  return linkMail(
    to.email,
    m.invite.subject(where),
    [m.hello(to.firstName), m.invite.body(invitedBy ?? m.invite.platformSender, where), m.invite.validity],
    { label: m.invite.button, url: passwordLink(config, token) },
    m.invite.footer,
    locale,
  );
}

export function resetMail(config: Config, to: Recipient, token: string): Mail {
  const locale = asLocale(to.locale);
  const m = MAIL_TEXT[locale];
  return linkMail(
    to.email,
    m.reset.subject,
    [m.hello(to.firstName), m.reset.body],
    { label: m.reset.button, url: passwordLink(config, token) },
    m.reset.footer,
    locale,
  );
}

// Avis après un changement de mot de passe (Mon profil)
export function passwordChangedMail(config: Config, to: Recipient): Mail {
  const locale = asLocale(to.locale);
  const m = MAIL_TEXT[locale];
  return linkMail(
    to.email,
    m.passwordChanged.subject,
    [m.hello(to.firstName), m.passwordChanged.body, m.passwordChanged.warning],
    { label: m.passwordChanged.button, url: `${config.APP_URL.replace(/\/$/, '')}/mot-de-passe-oublie` },
    m.passwordChanged.footer,
    locale,
  );
}
