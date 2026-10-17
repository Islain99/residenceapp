-- =====================================================================
-- 0012_profile.sql — Profil de l'utilisateur
--
--   * users.phone        : téléphone, facultatif, tel que saisi (chiffres,
--                          espaces, + ( ) . -). Modifié par la personne elle-même.
--   * users.avatar       : avatar illustré choisi dans la galerie, « style:nom »
--                          (ex. lorelei:aurore). Dessiné par l'interface
--                          (DiceBear) : aucune image n'est stockée. NULL : initiales.
--   * users.avatar_color : couleur du fond de l'avatar (ou du rond avec les
--                          initiales), parmi une palette fixe (NULL : couleur
--                          choisie d'après l'id).
-- Prénom et nom existent déjà (0001) ; le courriel et le rôle restent gérés
-- par la responsable (ou l'administration de la plateforme).
-- Droits : app_user lit et modifie déjà users (0001) ; app_readonly lit users.
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN phone text CHECK (phone ~ '^[0-9 +().-]{7,30}$'),
  ADD COLUMN avatar text CHECK (avatar ~ '^(lorelei|notionists):[a-z]{2,20}$'),
  ADD COLUMN avatar_color text CHECK (avatar_color IN
    ('teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'green', 'slate'));

COMMIT;
