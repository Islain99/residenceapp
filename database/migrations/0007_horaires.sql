-- =====================================================================
-- 0007_horaires.sql — Horaires du personnel
--
--   * shift_types : quarts types de la résidence (Jour, Soir, Nuit…), en
--     heure locale. Fin ≤ début = le quart finit le lendemain (nuit).
--   * shifts : un employé, un jour, un quart type. Les heures sont copiées
--     du quart type et peuvent être ajustées pour ce jour-là (exception).
--     Retirer un employé de l'horaire = cancelled_at, aucune suppression.
--   * Heures locales (type time), sans fuseau : un horaire se lit à l'heure
--     de la résidence.
-- Droits : app_user par défaut (0002, sans DELETE) ; app_readonly ci-dessous.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

CREATE TABLE shift_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id uuid NOT NULL REFERENCES residences(id),
  label        text NOT NULL CHECK (length(btrim(label)) > 0),
  start_time   time NOT NULL,
  end_time     time NOT NULL CHECK (end_time <> start_time),
  sort_order   int  NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  CONSTRAINT shift_types_label_key UNIQUE (residence_id, label),
  CONSTRAINT shift_types_residence_id_key UNIQUE (residence_id, id)
);

CREATE TABLE shifts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  residence_id  uuid NOT NULL REFERENCES residences(id),
  user_id       uuid NOT NULL,
  shift_type_id uuid NOT NULL,
  work_date     date NOT NULL,                      -- jour où le quart commence
  start_time    time NOT NULL,
  end_time      time NOT NULL CHECK (end_time <> start_time),
  notes         text,
  created_by    uuid NOT NULL,
  cancelled_at  timestamptz,                        -- retiré de l'horaire
  cancelled_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shifts_user_fk      FOREIGN KEY (residence_id, user_id)       REFERENCES users (residence_id, id),
  CONSTRAINT shifts_type_fk      FOREIGN KEY (residence_id, shift_type_id) REFERENCES shift_types (residence_id, id),
  CONSTRAINT shifts_author_fk    FOREIGN KEY (residence_id, created_by)    REFERENCES users (residence_id, id),
  CONSTRAINT shifts_cancelled_fk FOREIGN KEY (residence_id, cancelled_by)  REFERENCES users (residence_id, id),
  CONSTRAINT shifts_cancel_consistency CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL))
);
-- Un employé n'a qu'une fois le même quart le même jour
CREATE UNIQUE INDEX shifts_one_per_type ON shifts (user_id, work_date, shift_type_id) WHERE cancelled_at IS NULL;
CREATE INDEX shifts_residence_date ON shifts (residence_id, work_date) WHERE cancelled_at IS NULL;
CREATE TRIGGER shifts_updated BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Quarts types par défaut pour les résidences existantes (modifiables ensuite)
INSERT INTO shift_types (residence_id, label, start_time, end_time, sort_order)
SELECT r.id, t.label, t.start_time, t.end_time, t.sort_order
FROM residences r
CROSS JOIN (VALUES ('Jour', time '07:00', time '15:00', 1),
                   ('Soir', time '15:00', time '23:00', 2),
                   ('Nuit', time '23:00', time '07:00', 3)) AS t(label, start_time, end_time, sort_order);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON shift_types, shifts TO app_readonly;
  END IF;
END $$;

COMMIT;
