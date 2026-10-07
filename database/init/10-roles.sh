#!/usr/bin/env bash
# =====================================================================
# 10-roles.sh — exécuté UNE fois, à la création du serveur principal.
# Crée les rôles, ouvre la réplication, crée le slot du réplica.
#
#   postgres      superutilisateur (administration seulement)
#   app_migrator  propriétaire du schéma, applique les migrations
#   app_user      compte de l'API : pas de DELETE, audit en ajout seul
#   app_readonly  lecture seule (rapports, support)
#   replicator    réplication uniquement
# =====================================================================
set -Eeuo pipefail

: "${MIGRATOR_PASSWORD:?MIGRATOR_PASSWORD requis}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD requis}"
: "${READONLY_PASSWORD:?READONLY_PASSWORD requis}"
: "${REPLICATION_PASSWORD:?REPLICATION_PASSWORD requis}"
DB="${POSTGRES_DB:-residence}"

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "$DB" \
     -v migrator_pw="$MIGRATOR_PASSWORD" \
     -v app_pw="$APP_DB_PASSWORD" \
     -v ro_pw="$READONLY_PASSWORD" \
     -v repl_pw="$REPLICATION_PASSWORD" \
     -v db="$DB" <<'SQL'
CREATE ROLE app_migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE app_user     LOGIN PASSWORD :'app_pw'  CONNECTION LIMIT 50;
CREATE ROLE app_readonly LOGIN PASSWORD :'ro_pw'   CONNECTION LIMIT 5;
CREATE ROLE replicator   LOGIN REPLICATION PASSWORD :'repl_pw' CONNECTION LIMIT 5;

ALTER DATABASE :"db" OWNER TO app_migrator;
ALTER SCHEMA public OWNER TO app_migrator;
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO app_user, app_readonly;

-- Délais de sécurité pour l'API
ALTER ROLE app_user SET statement_timeout = '15s';
ALTER ROLE app_user SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE app_readonly SET default_transaction_read_only = on;

-- Slot de réplication : le principal garde les WAL tant que le réplica ne les a pas reçus
SELECT pg_create_physical_replication_slot('replica1');

-- Statistiques des requêtes (diagnostic de performance)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON pg_stat_statements, pg_stat_statements_info FROM PUBLIC;
SQL

# Autoriser la réplication depuis le réseau Docker (mot de passe SCRAM obligatoire)
cat >> "$PGDATA/pg_hba.conf" <<'HBA'

# --- Réplication vers le serveur de reprise ---
host  replication  replicator  all  scram-sha-256
HBA

echo "[init] rôles, slot 'replica1' et accès de réplication créés"
