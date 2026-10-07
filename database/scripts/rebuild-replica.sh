#!/usr/bin/env bash
# =====================================================================
# rebuild-replica.sh — recrée le serveur de reprise à partir du principal.
# Usage :
#   scripts/rebuild-replica.sh          (cas normal : pg-primary est le principal)
# Utile quand le réplica est corrompu, trop en retard (slot perdu),
# ou après un retour à la normale.
# ATTENTION : efface le volume du réplica.
# =====================================================================
source "$(dirname "$0")/_lib.sh"
PROJECT="$(docker compose config --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])' 2>/dev/null || basename "$PWD")"

if is_standby pg-primary; then
  echo "pg-primary n'est pas principal : refus."; exit 1
fi

say "Arrêt et suppression du réplica"
dc stop pg-replica || true
dc rm -f pg-replica || true
docker volume rm "${PROJECT}_pg-replica-data" 2>/dev/null || true

say "Recréation du slot de réplication"
sql pg-primary -qc "SELECT pg_drop_replication_slot('replica1') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name='replica1')"
sql pg-primary -qc "SELECT pg_create_physical_replication_slot('replica1')"

say "Démarrage du nouveau réplica (copie complète)"
dc up -d pg-replica
for i in $(seq 1 60); do
  if on pg-replica pg_isready -q 2>/dev/null && is_standby pg-replica; then
    say "Réplica prêt"; exec "$(dirname "$0")/status.sh"
  fi
  sleep 2
done
echo "Le réplica n'est pas prêt après 2 min : voir docker compose logs pg-replica"; exit 1
