#!/usr/bin/env bash
# status.sh — état des deux serveurs, retard du réplica, dernières sauvegardes.
source "$(dirname "$0")/_lib.sh"

for svc in pg-primary pg-replica; do
  if ! on "$svc" pg_isready -q 2>/dev/null; then
    say "$svc : ARRÊTÉ ou injoignable"; continue
  fi
  if is_standby "$svc"; then say "$svc : RÉPLICA (lecture seule)"; else say "$svc : PRINCIPAL (lecture + écriture)"; fi
done

# Le principal actuel met à jour le battement ; le réplica montre son retard
PRIMARY=""; REPLICA=""
for svc in pg-primary pg-replica; do
  on "$svc" pg_isready -q 2>/dev/null || continue
  if is_standby "$svc"; then REPLICA="$svc"; else PRIMARY="$svc"; fi
done

if [ -n "$PRIMARY" ]; then
  sql "$PRIMARY" -qc "UPDATE ops_heartbeat SET at = now()"
  say "Réplication vue depuis $PRIMARY"
  sql "$PRIMARY" -c "
    SELECT application_name AS replica, client_addr, state, sync_state,
           pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS retard_octets,
           replay_lag AS retard_temps
    FROM pg_stat_replication;"
  sql "$PRIMARY" -c "
    SELECT slot_name, active, wal_status,
           pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS wal_retenus
    FROM pg_replication_slots;"
fi

if [ -n "$REPLICA" ]; then
  sleep 1
  say "Retard mesuré sur $REPLICA"
  sql "$REPLICA" -c "
    SELECT now() - at AS retard_battement,
           pg_last_xact_replay_timestamp() AS derniere_transaction_rejouee
    FROM ops_heartbeat;"
fi

say "Sauvegardes (pgBackRest)"
on "${PRIMARY:-pg-primary}" pgbackrest --stanza=residence info
