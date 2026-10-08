-- =====================================================================
-- 0002_privileges.sql — Droits : tables futures et colonnes sensibles
--
--   * Droits par défaut : toute table créée par app_migrator dans une
--     migration future est accessible à l'API (SELECT / INSERT / UPDATE,
--     jamais DELETE), sans GRANT à répéter.
--     app_readonly n'en reçoit PAS par défaut : chaque migration choisit
--     explicitement ce qu'il peut lire (une table sensible reste fermée).
--   * app_readonly ne lit plus les hachages de mots de passe
--     (users.password_hash) ni les notes réservées infirmière /
--     responsable (residents.restricted_notes).
--
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO app_user;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    REVOKE SELECT ON users, residents FROM app_readonly;
    GRANT SELECT (id, residence_id, email, first_name, last_name, role,
                  is_active, last_login_at, created_at, updated_at)
      ON users TO app_readonly;
    GRANT SELECT (id, residence_id, first_name, last_name, room, birth_date,
                  emergency_contact, special_instructions, status,
                  admitted_at, left_at, created_at, updated_at)
      ON residents TO app_readonly;
  END IF;
END $$;

COMMIT;
