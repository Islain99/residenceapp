-- =====================================================================
-- 0010_platform.sql — Administration de la plateforme
--
-- L'administrateur de la plateforme (users.role = 'admin', sans résidence)
-- gère les résidences et leurs responsables, jamais leur contenu.
--
-- Accès d'assistance (assistance_grants) : seule la responsable d'une
-- résidence peut l'accorder, pour une durée limitée. Pendant cette durée,
-- l'administrateur peut CONSULTER la résidence (lecture seule, messagerie
-- exclue) ; chaque consultation est inscrite au journal d'audit de la
-- résidence. La responsable peut retirer l'accès à tout moment.
-- Rien n'est supprimé : un accès retiré garde revoked_at / revoked_by.
--
-- Droits : app_user par défaut (0002, sans DELETE) ; app_readonly : aucun.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

CREATE TABLE assistance_grants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id uuid NOT NULL REFERENCES residences(id),
  granted_by   uuid NOT NULL,
  reason       text CHECK (reason IS NULL OR length(reason) <= 500),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES users(id),           -- la responsable ou l'administrateur
  CONSTRAINT assistance_grants_granter_fk FOREIGN KEY (residence_id, granted_by) REFERENCES users (residence_id, id),
  CONSTRAINT assistance_grants_duration CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '7 days'),
  CONSTRAINT assistance_grants_revoke_consistency CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX assistance_grants_residence ON assistance_grants (residence_id, granted_at DESC);
CREATE INDEX assistance_grants_open ON assistance_grants (expires_at) WHERE revoked_at IS NULL;

-- Journal de la plateforme : actions des administrateurs et événements
-- sans résidence (connexion refusée pour un courriel inconnu…)
CREATE INDEX audit_log_user_time ON audit_log (user_id, at DESC);
CREATE INDEX audit_log_platform_time ON audit_log (id DESC) WHERE residence_id IS NULL;

-- Sécurité : comptes bloqués
CREATE INDEX users_locked ON users (locked_until) WHERE locked_until IS NOT NULL;

COMMIT;
