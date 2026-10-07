-- =====================================================================
-- 0001_init.sql — Schéma initial (V1 : journal, relève, dossier résident)
-- PostgreSQL 16
--
-- Principes :
--   * residence_id sur chaque table (isolation multi-résidences).
--   * Clés étrangères composées (residence_id, id) : la base elle-même
--     refuse qu'une note d'une résidence pointe vers un résident, un
--     employé ou une catégorie d'une autre résidence.
--   * Aucune suppression de note : correction = nouvelle version,
--     retrait = statut « annulee » avec motif.
--   * audit_log en ajout seul (trigger + droits).
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() (natif en 13+, gardé par sécurité)
CREATE EXTENSION IF NOT EXISTS unaccent;   -- recherche insensible aux accents

-- Configuration de recherche plein texte française, sans accents
CREATE TEXT SEARCH CONFIGURATION fr_unaccent (COPY = french);
ALTER TEXT SEARCH CONFIGURATION fr_unaccent
  ALTER MAPPING FOR hword, hword_part, word WITH unaccent, french_stem;

-- ---------------------------------------------------------------------
-- Fonction utilitaire : updated_at automatique
-- ---------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Résidences
-- ---------------------------------------------------------------------
CREATE TABLE residences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('RPA','RI')),
  timezone    text NOT NULL DEFAULT 'America/Toronto',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER residences_updated BEFORE UPDATE ON residences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Employés (utilisateurs)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id  uuid REFERENCES residences(id),    -- NULL uniquement pour l'admin plateforme
  email         text NOT NULL,
  password_hash text NOT NULL,                      -- Argon2id, jamais le mot de passe
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  role          text NOT NULL CHECK (role IN ('prepose','infirmiere','responsable','admin')),
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_admin_no_residence
    CHECK ((role = 'admin') = (residence_id IS NULL)),
  CONSTRAINT users_residence_id_key UNIQUE (residence_id, id)
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE TRIGGER users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Jetons de rafraîchissement (révocables : déconnexion, compte désactivé)
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,                 -- SHA-256 du jeton, jamais le jeton
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_agent  text
);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- Résidents
-- ---------------------------------------------------------------------
CREATE TABLE residents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id         uuid NOT NULL REFERENCES residences(id),
  first_name           text NOT NULL,
  last_name            text NOT NULL,
  room                 text,
  birth_date           date,
  emergency_contact    text,
  special_instructions text,                        -- consignes particulières (visibles par tous)
  restricted_notes     text,                        -- réservé infirmière / responsable
  status               text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','parti')),
  admitted_at          date,
  left_at              date,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT residents_left_after_admit CHECK (left_at IS NULL OR admitted_at IS NULL OR left_at >= admitted_at),
  CONSTRAINT residents_residence_id_key UNIQUE (residence_id, id)
);
CREATE INDEX residents_list ON residents (residence_id, status, last_name, first_name);
CREATE TRIGGER residents_updated BEFORE UPDATE ON residents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Catégories de notes
-- ---------------------------------------------------------------------
CREATE TABLE note_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id uuid NOT NULL REFERENCES residences(id),
  label        text NOT NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  CONSTRAINT note_categories_label_key UNIQUE (residence_id, label),
  CONSTRAINT note_categories_residence_id_key UNIQUE (residence_id, id)
);

-- ---------------------------------------------------------------------
-- Notes (journal de bord) — entité centrale
-- ---------------------------------------------------------------------
CREATE TABLE notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id  uuid NOT NULL REFERENCES residences(id),
  author_id     uuid NOT NULL,
  resident_id   uuid,                               -- NULL = note générale
  category_id   uuid NOT NULL,
  occurred_at   timestamptz NOT NULL,               -- moment de l'événement
  description   text NOT NULL CHECK (length(btrim(description)) > 0),
  intervention  text,
  is_priority   boolean NOT NULL DEFAULT false,     -- consigne prioritaire
  is_positive   boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','annulee')),
  cancel_reason text,
  cancelled_by  uuid,
  cancelled_at  timestamptz,
  search        tsvector GENERATED ALWAYS AS (
                  to_tsvector('fr_unaccent', description || ' ' || coalesce(intervention, ''))
                ) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_author_fk   FOREIGN KEY (residence_id, author_id)   REFERENCES users (residence_id, id),
  CONSTRAINT notes_resident_fk FOREIGN KEY (residence_id, resident_id) REFERENCES residents (residence_id, id),
  CONSTRAINT notes_category_fk FOREIGN KEY (residence_id, category_id) REFERENCES note_categories (residence_id, id),
  CONSTRAINT notes_cancel_fk   FOREIGN KEY (residence_id, cancelled_by) REFERENCES users (residence_id, id),
  CONSTRAINT notes_cancel_consistency CHECK (
    (status = 'active'  AND cancel_reason IS NULL AND cancelled_at IS NULL) OR
    (status = 'annulee' AND cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT notes_residence_id_key UNIQUE (residence_id, id)
);
CREATE INDEX notes_residence_time ON notes (residence_id, occurred_at DESC);
CREATE INDEX notes_resident_time  ON notes (residence_id, resident_id, occurred_at DESC) WHERE resident_id IS NOT NULL;
CREATE INDEX notes_created        ON notes (residence_id, created_at);           -- relève « depuis mon dernier quart »
CREATE INDEX notes_priority       ON notes (residence_id) WHERE is_priority AND status = 'active';
CREATE INDEX notes_search         ON notes USING gin (search);
CREATE TRIGGER notes_updated BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Historique des corrections
CREATE TABLE note_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id uuid NOT NULL,
  note_id      uuid NOT NULL,
  edited_by    uuid NOT NULL,
  previous     jsonb NOT NULL,                      -- contenu avant correction
  edited_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_versions_note_fk FOREIGN KEY (residence_id, note_id)   REFERENCES notes (residence_id, id),
  CONSTRAINT note_versions_user_fk FOREIGN KEY (residence_id, edited_by) REFERENCES users (residence_id, id)
);
CREATE INDEX note_versions_note ON note_versions (note_id, edited_at);

-- ---------------------------------------------------------------------
-- Suivis (actions à faire issues d'une note)
-- ---------------------------------------------------------------------
CREATE TABLE follow_ups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id uuid NOT NULL,
  note_id      uuid NOT NULL,
  description  text NOT NULL,
  assigned_to  uuid,                                -- NULL = toute l'équipe
  due_at       timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  closed_by    uuid,
  closing_note text,
  CONSTRAINT follow_ups_note_fk     FOREIGN KEY (residence_id, note_id)     REFERENCES notes (residence_id, id),
  CONSTRAINT follow_ups_assigned_fk FOREIGN KEY (residence_id, assigned_to) REFERENCES users (residence_id, id),
  CONSTRAINT follow_ups_closed_fk   FOREIGN KEY (residence_id, closed_by)   REFERENCES users (residence_id, id),
  CONSTRAINT follow_ups_close_consistency CHECK ((closed_at IS NULL) = (closed_by IS NULL))
);
CREATE INDEX follow_ups_open ON follow_ups (residence_id, due_at) WHERE closed_at IS NULL;
CREATE INDEX follow_ups_note ON follow_ups (note_id);

-- ---------------------------------------------------------------------
-- Confirmations de lecture et relèves
-- ---------------------------------------------------------------------
CREATE TABLE note_reads (
  residence_id uuid NOT NULL,
  note_id      uuid NOT NULL,
  user_id      uuid NOT NULL,
  read_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id),
  CONSTRAINT note_reads_note_fk FOREIGN KEY (residence_id, note_id) REFERENCES notes (residence_id, id),
  CONSTRAINT note_reads_user_fk FOREIGN KEY (residence_id, user_id) REFERENCES users (residence_id, id)
);

CREATE TABLE handovers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id    uuid NOT NULL,
  user_id         uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handovers_user_fk FOREIGN KEY (residence_id, user_id) REFERENCES users (residence_id, id)
);
CREATE INDEX handovers_last ON handovers (user_id, acknowledged_at DESC);

-- ---------------------------------------------------------------------
-- Journal d'audit — ajout seul
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  residence_id uuid,
  user_id      uuid,
  action       text NOT NULL,     -- create, update, cancel, view, login, login_failed…
  entity       text NOT NULL,     -- note, resident, user…
  entity_id    uuid,
  details      jsonb,             -- jamais de contenu clinique complet ici
  ip           inet,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_residence_time ON audit_log (residence_id, at DESC);
CREATE INDEX audit_log_entity         ON audit_log (entity, entity_id);

CREATE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log est en ajout seul (% interdit)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- ---------------------------------------------------------------------
-- Table technique : contrôle de santé de la réplication
-- (une ligne mise à jour par le script de vérification)
-- ---------------------------------------------------------------------
CREATE TABLE ops_heartbeat (
  id  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ops_heartbeat DEFAULT VALUES;

-- ---------------------------------------------------------------------
-- Droits du compte applicatif (app_user)
--   * Lecture / ajout / modification sur les tables métier.
--   * AUCUN DELETE : on annule, on ne supprime pas.
--   * audit_log : INSERT + SELECT seulement.
-- Le rôle app_user est créé par init/10-roles.sh (hors migration).
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE ON
      residences, users, refresh_tokens, residents, note_categories,
      notes, note_versions, follow_ups, note_reads, handovers
      TO app_user;
    GRANT SELECT, INSERT ON audit_log TO app_user;
    GRANT SELECT ON ops_heartbeat TO app_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT USAGE ON SCHEMA public TO app_readonly;
    GRANT SELECT ON
      residences, users, residents, note_categories, notes, note_versions,
      follow_ups, note_reads, handovers, audit_log, ops_heartbeat
      TO app_readonly;   -- pas refresh_tokens
  END IF;
END $$;

CREATE TABLE schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('0001_init');

COMMIT;
