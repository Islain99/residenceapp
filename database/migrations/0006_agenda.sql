-- =====================================================================
-- 0006_agenda.sql — Agenda de la résidence
--
-- Rendez-vous d'un résident (médecin, transport, visite…) ou de la
-- résidence elle-même (activité, réunion…), resident_id NULL.
--   * Clés étrangères composées (residence_id, …) : un rendez-vous ne peut
--     viser un résident ou un employé d'une autre résidence.
--   * Aucune suppression : un rendez-vous annulé garde son motif.
-- Droits : app_user par défaut (0002, sans DELETE) ; app_readonly ci-dessous.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

CREATE TABLE appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id  uuid NOT NULL REFERENCES residences(id),
  resident_id   uuid,                                   -- NULL : rendez-vous de la résidence
  kind          text NOT NULL CHECK (kind IN ('medical', 'transport', 'visite', 'activite', 'reunion', 'autre')),
  title         text NOT NULL CHECK (length(btrim(title)) > 0),
  location      text,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz,
  details       text,                                   -- préparation, accompagnement, à jeun…
  status        text NOT NULL DEFAULT 'prevu' CHECK (status IN ('prevu', 'annule')),
  cancel_reason text,
  cancelled_by  uuid,
  cancelled_at  timestamptz,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_resident_fk FOREIGN KEY (residence_id, resident_id) REFERENCES residents (residence_id, id),
  CONSTRAINT appointments_author_fk   FOREIGN KEY (residence_id, created_by)  REFERENCES users (residence_id, id),
  CONSTRAINT appointments_cancel_fk   FOREIGN KEY (residence_id, cancelled_by) REFERENCES users (residence_id, id),
  CONSTRAINT appointments_end_after_start CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT appointments_cancel_consistency CHECK (
    (status = 'prevu'  AND cancel_reason IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL) OR
    (status = 'annule' AND cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  )
);
CREATE INDEX appointments_residence_time ON appointments (residence_id, starts_at);
CREATE INDEX appointments_resident_time  ON appointments (residence_id, resident_id, starts_at) WHERE resident_id IS NOT NULL;
CREATE TRIGGER appointments_updated BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON appointments TO app_readonly;
  END IF;
END $$;

COMMIT;
