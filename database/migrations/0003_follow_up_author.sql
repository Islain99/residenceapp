-- =====================================================================
-- 0003_follow_up_author.sql — Auteur des suivis
--
-- follow_ups n'enregistrait pas qui avait créé le suivi. Colonne
-- facultative : les suivis existants n'en ont pas.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

ALTER TABLE follow_ups
  ADD COLUMN created_by uuid,
  ADD CONSTRAINT follow_ups_created_fk
    FOREIGN KEY (residence_id, created_by) REFERENCES users (residence_id, id);

-- Suivis d'un employé (« mes suivis »)
CREATE INDEX follow_ups_assigned_open ON follow_ups (residence_id, assigned_to) WHERE closed_at IS NULL;

COMMIT;
