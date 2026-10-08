import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './types.js';

export type Database = Kysely<DB>;

// Colonnes « date » (naissance, admission…) : chaîne AAAA-MM-JJ telle quelle.
// Par défaut, pg en fait une Date à minuit heure locale (décalage d'un jour possible).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

// Connexion en tant que app_user : pas de DELETE, audit en ajout seul
// (droits définis dans database/migrations).
export function createDb(connectionString: string): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: 10 }),
    }),
  });
}
