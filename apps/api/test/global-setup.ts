// Avant les tests : recrée la base « residence_test » à neuf (migrations +
// données fictives) dans le serveur principal Docker. Les tests ne touchent
// jamais la base de développement « residence ».
//
// Passe par « docker compose exec » (superutilisateur dans le conteneur) :
// aucun mot de passe d'administration côté API.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DB = 'residence_test';

const DATABASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../database');
const SERVICE = 'pg-primary';

function compose(...args: string[]): string {
  try {
    return execFileSync('docker', ['compose', '-f', resolve(DATABASE_DIR, 'docker-compose.yml'), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`Préparation de la base de test : « docker compose ${args.join(' ')} » a échoué.\n` +
      `${e.stderr ?? e.message}\n(La base Docker doit être démarrée : cd database && docker compose up -d)`);
  }
}

const psql = (db: string, ...commands: string[]) =>
  compose('exec', '-T', '-u', 'postgres', SERVICE, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db,
    ...commands.flatMap((c) => ['-c', c]));

export default function setup(): void {
  const started = Date.now();

  // Base vide, mêmes droits que la base de développement (init/10-roles.sh)
  psql('postgres',
    `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`,
    `CREATE DATABASE ${TEST_DB} OWNER app_migrator`,
    `REVOKE ALL ON DATABASE ${TEST_DB} FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${TEST_DB} TO app_user, app_readonly`);
  psql(TEST_DB, 'ALTER SCHEMA public OWNER TO app_migrator');

  // Migrations et données fictives du dépôt (pas celles de l'image, possiblement anciennes)
  // En root : « docker compose cp » dépose les fichiers en root
  compose('exec', '-T', SERVICE, 'rm', '-rf', '/tmp/test-db');
  compose('exec', '-T', SERVICE, 'mkdir', '-p', '/tmp/test-db');
  compose('cp', resolve(DATABASE_DIR, 'migrations'), `${SERVICE}:/tmp/test-db/migrations`);
  compose('cp', resolve(DATABASE_DIR, 'init/20-migrate.sh'), `${SERVICE}:/tmp/test-db/20-migrate.sh`);
  compose('cp', resolve(DATABASE_DIR, 'seed/seed.sql'), `${SERVICE}:/tmp/test-db/seed.sql`);
  compose('exec', '-T', '-u', 'postgres', '-e', `POSTGRES_DB=${TEST_DB}`, '-e', 'MIGRATIONS_DIR=/tmp/test-db/migrations',
    SERVICE, 'bash', '/tmp/test-db/20-migrate.sh');
  compose('exec', '-T', '-u', 'postgres', SERVICE, 'bash', '-c',
    `{ echo 'SET ROLE app_migrator;'; cat /tmp/test-db/seed.sql; } | psql -X -q -v ON_ERROR_STOP=1 -d ${TEST_DB}`);

  console.log(`[tests] base ${TEST_DB} recréée en ${((Date.now() - started) / 1000).toFixed(1)} s`);
}
