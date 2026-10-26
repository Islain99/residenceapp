-- =====================================================================
-- 0014_features.sql — Fonctionnalités activables par résidence
--
-- L'administration de la plateforme règle, pour chaque résidence, le niveau
-- d'accès de chaque module (journal, résidents, agenda…) :
--   off  = masqué, read = consultation, full = complet (lire et écrire).
-- Le catalogue des modules, leurs valeurs par défaut et leurs dépendances
-- sont dans le code (apps/api/src/lib/features.ts). Un réglage ne donne
-- jamais plus que ce que le rôle permet déjà dans l'application.
--
--   * residence_features : niveau d'un module pour un rôle de la résidence.
--     Sans ligne : valeur par défaut (le comportement d'avant).
--     Revenir à la valeur par défaut = mettre level à NULL (pas de DELETE).
--   * user_features : exception pour une personne (remplace le réglage de son
--     rôle pour ce module). Retirée : revoked_at (l'historique reste). Une
--     seule exception en cours par personne et par module.
--
-- Chaque changement est aussi inscrit au journal d'audit (feature_update).
-- Droits : app_user par défaut (0002, sans DELETE) ; app_readonly : aucun.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

CREATE TABLE residence_features (
  residence_id uuid NOT NULL REFERENCES residences(id),
  feature      text NOT NULL CHECK (feature ~ '^[a-z][a-zA-Z]{1,40}$'),
  role         text NOT NULL CHECK (role IN ('prepose', 'infirmiere', 'responsable')),
  level        text CHECK (level IN ('off', 'read', 'full')),   -- NULL : valeur par défaut
  updated_by   uuid REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (residence_id, feature, role)
);

CREATE TABLE user_features (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id uuid NOT NULL REFERENCES residences(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  feature      text NOT NULL CHECK (feature ~ '^[a-z][a-zA-Z]{1,40}$'),
  level        text NOT NULL CHECK (level IN ('off', 'read', 'full')),
  reason       text CHECK (length(reason) <= 200),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_by   uuid REFERENCES users(id),
  revoked_at   timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('removed', 'role_changed', 'replaced'))
);
CREATE UNIQUE INDEX user_features_current ON user_features (user_id, feature) WHERE revoked_at IS NULL;
CREATE INDEX user_features_residence ON user_features (residence_id) WHERE revoked_at IS NULL;

COMMIT;
