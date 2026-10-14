// Dernier recours : réinitialise la double authentification d'un compte (par
// exemple le seul administrateur a perdu son téléphone et ses codes de secours).
// Les autres cas passent par la plateforme (un autre administrateur).
//   npm run mfa:reset -- courriel@exemple.ca
// Sur Railway : dans le service de l'API, « railway ssh » puis la même commande.
import pg from 'pg';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage : npm run mfa:reset -- <courriel>');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(); } catch { /* pas de .env */ }
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL
     WHERE lower(email) = $1 RETURNING id, residence_id`, [email]);
  if (rows.length === 0) {
    console.error(`Aucun compte : ${email}`);
    process.exitCode = 1;
    await client.query('ROLLBACK');
  } else {
    const { id, residence_id } = rows[0];
    await client.query(`UPDATE mfa_backup_codes SET revoked_at = now()
      WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, [id]);
    await client.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    await client.query(`INSERT INTO audit_log (action, entity, entity_id, residence_id, details)
      VALUES ('mfa_reset', 'user', $1, $2, '{"by":"script"}')`, [id, residence_id]);
    await client.query('COMMIT');
    console.log(`Double authentification réinitialisée pour ${email} : à reconfigurer à la prochaine connexion.`);
  }
} finally {
  await client.end();
}
