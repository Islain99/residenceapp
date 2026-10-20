-- =====================================================================
-- 0013_locale.sql — Langue de chaque compte (interface bilingue)
--
--   * users.locale : « fr » (par défaut, Charte de la langue française) ou
--     « en ». Choisie sur la page de connexion ou dans « Mon profil » ; à
--     l'invitation, par la personne qui invite. Les courriels (invitation,
--     mot de passe) et les notifications push partent dans cette langue.
-- Droits : app_user lit et modifie déjà users (0001) ; app_readonly lit users.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

ALTER TABLE users ADD COLUMN locale text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en'));

COMMIT;
