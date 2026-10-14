-- =====================================================================
-- 0011_security_push.sql — Sessions, double authentification, notifications
--
--   * refresh_tokens.rotated_at : le jeton a été remplacé par un nouveau
--     (rotation normale). Présenté de nouveau dans les 30 secondes (deux
--     rechargements rapprochés, réponse perdue), ce n'est pas un vol : l'API
--     remet une session au lieu de fermer toutes les sessions.
--   * Double authentification (TOTP, RFC 6238) obligatoire pour les
--     responsables et les administrateurs de la plateforme :
--       users.mfa_secret       secret chiffré (AES-256-GCM, clé de l'API)
--       users.mfa_enabled_at   date d'activation (NULL : à configurer)
--       users.mfa_last_step    dernier pas de 30 s accepté (pas de rejeu)
--       mfa_backup_codes       codes de secours, hachés, à usage unique
--   * Notifications push (Web Push) :
--       push_subscriptions        un abonnement par appareil et par personne
--       notification_preferences  ce que chacun veut recevoir
--       follow_ups.due_notified_at  rappel d'échéance déjà envoyé
--
-- Rien n'est supprimé : un abonnement désactivé garde disabled_at, un code
-- de secours remplacé garde revoked_at.
-- Droits : app_user par défaut (0002, sans DELETE) ; app_readonly : aucun
-- (ni les nouvelles tables, ni les nouvelles colonnes de users).
-- =====================================================================

BEGIN;

ALTER TABLE refresh_tokens ADD COLUMN rotated_at timestamptz;

ALTER TABLE users
  ADD COLUMN mfa_secret     text,
  ADD COLUMN mfa_enabled_at timestamptz,
  ADD COLUMN mfa_last_step  bigint,
  ADD CONSTRAINT users_mfa_consistency CHECK (mfa_enabled_at IS NULL OR mfa_secret IS NOT NULL);

CREATE TABLE mfa_backup_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  code_hash  text NOT NULL,                       -- SHA-256 du code, jamais le code
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at    timestamptz,
  revoked_at timestamptz                          -- remplacé par une nouvelle série
);
CREATE INDEX mfa_backup_codes_open ON mfa_backup_codes (user_id) WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id),
  endpoint     text NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND length(endpoint) <= 1000),
  p256dh       text NOT NULL CHECK (length(p256dh) <= 200),
  auth         text NOT NULL CHECK (length(auth) <= 100),
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  failures     int NOT NULL DEFAULT 0,
  disabled_at  timestamptz
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (user_id) WHERE disabled_at IS NULL;

CREATE TABLE notification_preferences (
  user_id        uuid PRIMARY KEY REFERENCES users(id),
  messages       boolean NOT NULL DEFAULT true,
  announcements  boolean NOT NULL DEFAULT true,
  priority_notes boolean NOT NULL DEFAULT true,
  follow_ups     boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE follow_ups ADD COLUMN due_notified_at timestamptz;
CREATE INDEX follow_ups_due_reminder ON follow_ups (due_at) WHERE closed_at IS NULL AND due_notified_at IS NULL;

-- Responsables et admins : nouvelle connexion obligatoire, avec la double
-- authentification (sessions expirées, pas révoquées : ce n'est pas un vol)
UPDATE refresh_tokens SET expires_at = now()
WHERE revoked_at IS NULL AND expires_at > now()
  AND user_id IN (SELECT id FROM users WHERE role IN ('responsable', 'admin'));

COMMIT;
