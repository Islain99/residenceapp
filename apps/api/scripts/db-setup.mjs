// Préparation d'une base PostgreSQL hébergée (Railway, Amazon RDS…), sans Docker.
// Même résultat que database/init/ du conteneur local : rôles, droits,
// migrations, et données fictives si demandé. Idempotent : à chaque
// déploiement, seules les nouvelles migrations s'appliquent.
//
//   npm run db:setup        (étape « pre-deploy » de l'hébergeur)
//
// Variables :
//   DATABASE_ADMIN_URL  compte administrateur de la base (Railway : postgres ;
//                       RDS : compte maître, non superutilisateur, suffit)
//   DATABASE_URL        compte de l'API (app_user) : son mot de passe est repris d'ici
//   READONLY_PASSWORD   facultatif : active le compte app_readonly (rapports)
//   SEED_DEMO=true      données FICTIVES, seulement si la base n'a aucune résidence
//   SEED_PASSWORD       mot de passe des comptes fictifs (12 caractères min.)
//   MIGRATIONS_DIR, SEED_FILE  par défaut : ../../database/migrations et ../../database/seed/seed.sql
//
// Écrit en JavaScript (pas TypeScript) : tourne avec « node » seul, sans les
// outils de développement, sur un serveur de production.
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? resolve(here, '../../../database/migrations');
const SEED_FILE = process.env.SEED_FILE ?? resolve(here, '../../../database/seed/seed.sql');
const LOCK_ID = 4_206_2026;   // verrou consultatif : deux déploiements simultanés ne migrent pas en même temps

try { process.loadEnvFile(); } catch { /* pas de .env : environnement seulement */ }

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[db:setup] variable ${name} manquante.`);
    process.exit(1);
  }
  return value;
}

const adminUrl = required('DATABASE_ADMIN_URL');
const appUrl = new URL(required('DATABASE_URL'));
const appPassword = decodeURIComponent(appUrl.password);
if (decodeURIComponent(appUrl.username) !== 'app_user' || !appPassword) {
  console.error('[db:setup] DATABASE_URL doit utiliser le compte app_user avec un mot de passe.');
  process.exit(1);
}
const seedDemo = process.env.SEED_DEMO === 'true';
const seedPassword = process.env.SEED_PASSWORD ?? '';
if (seedDemo && seedPassword.length < 12) {
  console.error('[db:setup] SEED_DEMO=true : SEED_PASSWORD de 12 caractères minimum requis.');
  process.exit(1);
}

const log = (message) => console.log(`[db:setup] ${message}`);
const client = new pg.Client({ connectionString: adminUrl });
await client.connect();

const exists = async (sql, params = []) => (await client.query(sql, params)).rowCount > 0;
const ident = (name) => client.escapeIdentifier(name);
const literal = (value) => client.escapeLiteral(value);

try {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  const { rows: [info] } = await client.query('SELECT current_database() AS db, current_user AS me');
  const db = ident(info.db);
  log(`base ${info.db}, compte ${info.me}`);

  // 1. Rôles (mots de passe : jamais dans les journaux)
  if (!await exists("SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator'")) {
    await client.query('CREATE ROLE app_migrator NOLOGIN');   // utilisé par SET ROLE seulement
    log('rôle app_migrator créé');
  }
  if (!await exists("SELECT 1 FROM pg_roles WHERE rolname = 'app_user'")) {
    await client.query(`CREATE ROLE app_user LOGIN PASSWORD ${literal(appPassword)} CONNECTION LIMIT 50`);
    log('rôle app_user créé');
  } else {
    await client.query(`ALTER ROLE app_user WITH LOGIN PASSWORD ${literal(appPassword)}`);
  }
  if (!await exists("SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly'")) {
    await client.query('CREATE ROLE app_readonly NOLOGIN CONNECTION LIMIT 5');
    log('rôle app_readonly créé');
  }
  if (process.env.READONLY_PASSWORD) {
    await client.query(`ALTER ROLE app_readonly WITH LOGIN PASSWORD ${literal(process.env.READONLY_PASSWORD)}`);
  }
  // L'administrateur doit pouvoir agir en tant que app_migrator (RDS : pas superutilisateur)
  await client.query(`GRANT app_migrator TO ${ident(info.me)}`).catch(() => {});

  // 2. Base et schéma appartiennent à app_migrator ; personne d'autre ne s'y connecte
  await client.query(`ALTER DATABASE ${db} OWNER TO app_migrator`);
  await client.query('ALTER SCHEMA public OWNER TO app_migrator');
  await client.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${db} TO app_user, app_readonly`);
  await client.query("ALTER ROLE app_user SET statement_timeout = '15s'");
  await client.query("ALTER ROLE app_user SET idle_in_transaction_session_timeout = '60s'");
  await client.query('ALTER ROLE app_readonly SET default_transaction_read_only = on');

  // 3. Migrations, dans l'ordre, en tant que app_migrator
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const hasTable = await exists("SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'schema_migrations'");
  const applied = new Set(hasTable
    ? (await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version)
    : []);
  let count = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query('SET ROLE app_migrator');
      await client.query(sql);   // chaque fichier gère sa propre transaction (BEGIN … COMMIT)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [version]);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`migration ${version} : ${err.message}`);
    } finally {
      await client.query('RESET ROLE');
    }
    log(`migration ${version} appliquée`);
    count++;
  }
  if (count === 0) log('schéma à jour');

  // 4. Données fictives (démo) : seulement sur une base sans résidence
  if (seedDemo) {
    if (await exists('SELECT 1 FROM residences')) {
      log('données fictives : déjà présentes (ou base réelle), rien à faire');
    } else {
      await client.query('SET ROLE app_migrator');
      try {
        await client.query(await readFile(SEED_FILE, 'utf8'));
      } finally {
        await client.query('RESET ROLE');
      }
      const passwordHash = await hash(seedPassword, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      const { rowCount } = await client.query(
        "UPDATE users SET password_hash = $1 WHERE password_hash = '!seed'", [passwordHash]);
      log(`données fictives chargées, ${rowCount} compte(s) avec SEED_PASSWORD`);
    }
  }
  log('terminé');
} catch (err) {
  console.error(`[db:setup] échec : ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
  await client.end();
}
