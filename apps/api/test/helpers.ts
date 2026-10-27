// Préparation commune des tests d'intégration. Base : « residence_test »,
// recréée par global-setup.ts ; même serveur et même compte (app_user) que
// DATABASE_URL, seul le nom de la base change.
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { MemoryMailer } from '../src/lib/mailer.js';
import { currentStep, encryptSecret, totp } from '../src/lib/mfa.js';
import { MemoryPushSender } from '../src/lib/notifier.js';
import { hashPassword } from '../src/lib/passwords.js';
import { TEST_DB } from './global-setup.js';

export const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Residence2026!';
export const RESIDENCE_A = '00000000-0000-4000-8000-000000000001';   // seed.sql
export const RESIDENCE_B = '00000000-0000-4000-8000-0000000000b0';   // créée par les tests

// Courriels gardés en mémoire (app.mailer.outbox), jamais envoyés
export async function buildTestApp(overrides: Parameters<typeof loadConfig>[0] = {}): Promise<App> {
  const config = loadConfig({ NODE_ENV: 'test', LOGIN_RATE_LIMIT_MAX: 1000, ...overrides });
  const url = new URL(config.DATABASE_URL);
  url.pathname = `/${TEST_DB}`;
  const mailer = new MemoryMailer();
  const app = await buildApp(config, createDb(url.toString()), mailer, new MemoryPushSender());
  mailers.set(app, mailer);
  // Comptes fictifs « !seed » → mot de passe de développement (comme npm run seed:passwords)
  await app.db.updateTable('users').set({ password_hash: await hashPassword(PASSWORD) })
    .where('password_hash', '=', '!seed').execute();
  // Responsables et admin fictifs : double authentification déjà configurée
  // (secret connu des tests)
  await app.db.updateTable('users')
    .set({ mfa_secret: encryptSecret(config, TEST_MFA_SECRET), mfa_enabled_at: new Date() })
    .where('email', 'in', ['responsable@exemple.test', 'responsable2@exemple.test', 'admin@exemple.test'])
    .where('mfa_enabled_at', 'is', null)
    .execute();
  return app;
}

// Secret TOTP des comptes fictifs (et de ceux configurés pendant les tests)
export const TEST_MFA_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const mfaSecrets = new Map<string, string>();
export const mfaSecretOf = (email: string) => mfaSecrets.get(email.toLowerCase()) ?? TEST_MFA_SECRET;

// Code à 6 chiffres valable maintenant. Les tests se connectent souvent
// plusieurs fois dans les mêmes 30 s : le « dernier pas utilisé » est effacé
// pour que le code courant reste acceptable (la protection contre le rejeu est
// testée à part, dans mfa.test.ts).
export async function currentCode(app: App, email: string): Promise<string> {
  await app.db.updateTable('users').set({ mfa_last_step: null }).where('email', '=', email.toLowerCase()).execute();
  return totp(mfaSecretOf(email), currentStep());
}

// Connexion complète (mot de passe, puis code ou configuration de la double
// authentification si le rôle l'exige). Renvoie la réponse finale.
export async function passwordLogin(app: App, email: string, password: string, extra: object = {}) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password, ...extra } });
  if (res.statusCode !== 200) return res;
  const body = res.json();
  if (body.mfa === 'required') {
    return app.inject({ method: 'POST', url: '/auth/mfa/verify', payload: { mfaToken: body.mfaToken, code: await currentCode(app, email) } });
  }
  if (body.mfa === 'setup') {
    const setup = await app.inject({ method: 'POST', url: '/auth/mfa/setup', payload: { mfaToken: body.mfaToken } });
    const { secret } = setup.json();
    mfaSecrets.set(email.toLowerCase(), secret);
    return app.inject({ method: 'POST', url: '/auth/mfa/enable', payload: { mfaToken: body.mfaToken, code: totp(secret, currentStep()) } });
  }
  return res;
}

// Deuxième résidence (une employée, une catégorie) pour vérifier l'isolation.
// Créée au premier fichier de tests qui en a besoin.
export async function ensureResidenceB(app: App): Promise<void> {
  const exists = await app.db.selectFrom('residences').select('id').where('id', '=', RESIDENCE_B).executeTakeFirst();
  if (exists) return;
  await app.db.transaction().execute(async (trx) => {
    await trx.insertInto('residences').values({ id: RESIDENCE_B, name: 'Résidence B (tests)', type: 'RPA' }).execute();
    await trx.insertInto('users').values({
      residence_id: RESIDENCE_B, email: 'prepose-b@exemple.test', password_hash: await hashPassword(PASSWORD),
      first_name: 'Test', last_name: 'Résidence B', role: 'prepose',
    }).execute();
    await trx.insertInto('note_categories').values({ residence_id: RESIDENCE_B, label: 'Divers' }).execute();
  });
}

export async function loginAs(app: App, email: string): Promise<string> {
  const res = await passwordLogin(app, email, PASSWORD);
  if (res.statusCode !== 200) throw new Error(`Connexion impossible pour ${email} : ${res.body}`);
  return res.json().accessToken;
}

const mailers = new WeakMap<App, MemoryMailer>();
export const outbox = (app: App) => mailers.get(app)!.outbox;
// Fournisseur de courriel qui refuse (le temps d'un test)
export const testMailer = (app: App) => mailers.get(app)!;

// Notifications push envoyées (après app.notifier.flush())
export const pushSender = (app: App) => app.notifier.sender as MemoryPushSender;

// Jeton contenu dans le lien d'un courriel (…/mot-de-passe#<jeton>)
export function tokenFromMail(text: string): string {
  const match = /mot-de-passe#([\w-]+)/.exec(text);
  if (!match) throw new Error(`Aucun lien dans le courriel :
${text}`);
  return match[1]!;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

// Comptes connectés par nom court (« prepose1 » → prepose1@exemple.test), et
// appel d'API avec le jeton de l'un d'eux.
export async function loginAll(app: App, names: string[]): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  for (const name of names) tokens[name] = await loginAs(app, `${name}@exemple.test`);
  return tokens;
}

export function caller(app: App, tokens: Record<string, string>) {
  return (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: bearer(tokens[who]!) });
}

// Identifiants utiles des données fictives (résidence A)
export async function seedIds(app: App) {
  const category = await app.db.selectFrom('note_categories').select('id')
    .where('residence_id', '=', RESIDENCE_A).orderBy('sort_order').executeTakeFirstOrThrow();
  const resident = await app.db.selectFrom('residents').select('id')
    .where('residence_id', '=', RESIDENCE_A).orderBy('last_name').executeTakeFirstOrThrow();
  const users = await app.db.selectFrom('users').select(['id', 'email']).execute();
  const userId = (name: string) => users.find((u) => u.email === `${name}@exemple.test`)!.id;
  return { categoryId: category.id, residentId: resident.id, userId };
}
