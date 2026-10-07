#!/usr/bin/env bash
# =====================================================================
# failback.sh — RETOUR À LA NORMALE après une bascule.
# Situation de départ : pg-replica est le principal (après failover.sh),
# pg-primary est arrêté ou supprimé.
#
#  1. Recrée pg-primary comme réplica de pg-replica (copie complète).
#  2. Attend qu'il soit à jour.
#  3. [Fenêtre de maintenance : arrêter l'API] Arrêt propre de pg-replica :
#     tous les WAL sont transmis, aucune perte.
#  4. Promeut pg-primary en principal.
#  5. Reconstruit pg-replica comme réplica (rebuild-replica.sh).
#  Durée d'interruption : environ 1 minute.
# =====================================================================
source "$(dirname "$0")/_lib.sh"
PROJECT="$(docker compose config --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])' 2>/dev/null || basename "$PWD")"
OVERRIDE=(-f docker-compose.yml -f docker/failback.override.yml)

if is_standby pg-replica; then echo "pg-replica n'est pas principal : rien à faire."; exit 1; fi

say "1/5 Recréation de pg-primary comme réplica de pg-replica"
dc stop pg-primary >/dev/null 2>&1 || true
dc rm -f pg-primary >/dev/null 2>&1 || true
docker volume rm "${PROJECT}_pg-primary-data" >/dev/null 2>&1 || true
sql pg-replica -qc "SELECT pg_drop_replication_slot('primary_back') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='primary_back')"
sql pg-replica -qc "SELECT pg_create_physical_replication_slot('primary_back')"
# Le principal actuel n'attend pas pg-primary : on lève la dépendance
docker compose "${OVERRIDE[@]}" up -d --no-deps pg-primary

say "2/5 Attente de la synchronisation"
for i in $(seq 1 90); do
  lag="$(sql pg-replica -tAc "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) FROM pg_stat_replication WHERE application_name='primary_back'" 2>/dev/null || true)"
  [ "$lag" = "0" ] && break
  sleep 2
done
[ "$lag" = "0" ] || { echo "pg-primary n'a pas rattrapé son retard : arrêt."; exit 1; }

if [ "${1:-}" != "--yes" ]; then
  read -r -p "3/5 Arrêter l'API maintenant, puis taper 'oui' pour continuer : " ok
  [ "$ok" = "oui" ] || { echo "Annulé (pg-primary reste réplica)."; exit 1; }
fi

say "3/5 Arrêt propre de pg-replica (transmet ses derniers WAL)"
dc stop pg-replica
sleep 3

say "4/5 Promotion de pg-primary"
sql pg-primary -tAc "SELECT pg_promote(wait => true, wait_seconds => 60)"
sql pg-primary -qc "CHECKPOINT"
# Redémarre pg-primary avec sa configuration normale
docker compose up -d --no-deps pg-primary
sleep 3
sql pg-primary -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN 'ÉCHEC' ELSE 'OK : pg-primary est le principal' END"
sql pg-primary -qc "SELECT pg_drop_replication_slot('primary_back') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='primary_back')"

say "5/5 Reconstruction de pg-replica"
"$(dirname "$0")/rebuild-replica.sh"

echo
echo "Remettre DATABASE_URL de l'API sur le port 5432, redémarrer l'API, puis : scripts/backup.sh full"
