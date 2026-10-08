-- =====================================================================
-- 0004_account_tokens.sql — Invitations et réinitialisation de mot de passe
--
--   * users.password_hash devient facultatif : NULL = invitation pas
--     encore acceptée (l'employé n'a pas choisi son mot de passe ; aucune
--     connexion possible).
--   * account_tokens : liens à usage unique envoyés par courriel
--     (invitation 72 h, réinitialisation 1 h). Seul le SHA-256 du jeton
--     est stocké, jamais le jeton.
-- Droits de app_user : droits par défaut (0002), pas de DELETE.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE account_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  purpose     text NOT NULL CHECK (purpose IN ('invite', 'reset')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,                         -- utilisé ou remplacé par un lien plus récent
  created_by  uuid REFERENCES users(id),           -- NULL : demande « mot de passe oublié »
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_tokens_user_open ON account_tokens (user_id) WHERE used_at IS NULL;

COMMIT;
