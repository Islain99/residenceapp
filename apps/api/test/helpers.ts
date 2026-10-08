// Préparation commune des tests d'intégration. Base : « residence_test »,
// recréée par global-setup.ts ; même serveur et même compte (app_user) que
// DATABASE_URL, seul le nom de la base change.
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { MemoryMailer } from '../src/lib/mailer.js';
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
  const app = await buildApp(config, createDb(url.toString()), new MemoryMailer());
  // Comptes fictifs « !seed » → mot de passe de développement (comme npm run seed:passwords)
  await app.db.updateTable('users').set({ password_hash: await hashPassword(PASSWORD) })
    .where('password_hash', '=', '!seed').execute();
  return app;
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
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`Connexion impossible pour ${email} : ${res.body}`);
  return res.json().accessToken;
}

export const outbox = (app: App) => (app.mailer as MemoryMailer).outbox;

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
