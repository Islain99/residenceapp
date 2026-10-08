// Donne un vrai mot de passe (Argon2id) aux comptes des données fictives
// (database/seed/seed.sql, password_hash = '!seed'). Développement seulement.
//   npm run seed:passwords                  → mot de passe : Residence2026!
//   SEED_USER_PASSWORD=... npm run seed:passwords
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { hashPassword } from '../src/lib/passwords.js';

const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('Refusé : NODE_ENV=production.');
  process.exit(1);
}

const password = process.env.SEED_USER_PASSWORD ?? 'Residence2026!';
const db = createDb(config.DATABASE_URL);
try {
  const result = await db.updateTable('users')
    .set({ password_hash: await hashPassword(password) })
    .where('password_hash', '=', '!seed')
    .executeTakeFirst();
  console.log(`${result.numUpdatedRows} compte(s) mis à jour. Mot de passe : ${password}`);
} finally {
  await db.destroy();
}
