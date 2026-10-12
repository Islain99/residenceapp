-- =====================================================================
-- 0008_note_reads_logic.sql — Lectures : auteur, corrections de fond
--
--   * notes.content_edited_at : moment de la dernière correction « de fond »
--     (texte, intervention, résident, heure, ou passage en consigne
--     prioritaire). Une lecture antérieure à cette date :
--       - ne compte plus pour une consigne prioritaire (à relire) ;
--       - est signalée « modifiée depuis votre lecture » pour une note ordinaire.
--     Pas de suppression de lectures : app_user n'a aucun DELETE (0002).
--   * L'auteur d'une note l'a lue : rattrapage pour les notes existantes
--     (l'API enregistre désormais la lecture de l'auteur à la création).
--
-- Droits : app_user par défaut (0002). app_readonly lit déjà notes (0001).
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

ALTER TABLE notes ADD COLUMN content_edited_at timestamptz;

INSERT INTO note_reads (residence_id, note_id, user_id, read_at)
SELECT n.residence_id, n.id, n.author_id, n.created_at
FROM notes n
ON CONFLICT (note_id, user_id) DO NOTHING;

COMMIT;
