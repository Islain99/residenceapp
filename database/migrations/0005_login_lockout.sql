-- =====================================================================
-- 0005_login_lockout.sql — Blocage d'un compte, sessions « appareil partagé »
--
-- Blocage temporaire :
-- Après LOGIN_MAX_ATTEMPTS mauvais mots de passe d'affilée (5 par défaut),
-- le compte est bloqué LOGIN_LOCK_MINUTES (15 par défaut), quelle que soit
-- l'adresse IP. Une connexion réussie ou un nouveau mot de passe remet le
-- compteur à zéro.
--
-- Pourquoi par compte et pas seulement par adresse IP : dans une résidence,
-- tout le personnel passe par le même Wi-Fi (même adresse IP), alors qu'un
-- attaquant peut changer d'adresse.
--
-- Appareil partagé : la session (jeton de rafraîchissement) est marquée
-- pour que le cookie reste un cookie de session (effacé à la fermeture du
-- navigateur) à chaque renouvellement, pas seulement à la connexion.
--
-- app_user : droits déjà accordés sur users (0001). app_readonly : n'a pas
-- besoin de ces colonnes (droits par colonne, 0002).
-- La version est enregistrée dans schema_migrations par 20-migrate.sh.
-- =====================================================================

BEGIN;

ALTER TABLE users
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  ADD COLUMN locked_until       timestamptz;

ALTER TABLE refresh_tokens
  ADD COLUMN shared_device boolean NOT NULL DEFAULT false;

COMMIT;
