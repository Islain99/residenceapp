#!/usr/bin/env bash
# =====================================================================
# node-entrypoint.sh — démarre un nœud PostgreSQL selon NODE_ROLE :
#   primary  : comportement normal de l'image officielle (initdb + init/*.sh)
#   replica  : si le volume est vide, copie le principal (pg_basebackup)
#              puis démarre en lecture seule (standby)
#   restore  : si le volume est vide, restaure depuis pgBackRest
#              (à RESTORE_TARGET si fourni) puis démarre SANS archivage
# =====================================================================
set -Eeuo pipefail

NODE_ROLE="${NODE_ROLE:-primary}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export PGDATA

log() { echo "[node-entrypoint:${NODE_ROLE}] $*"; }

prepare_datadir() {
  mkdir -p "$PGDATA"
  if [ "$(id -u)" = "0" ]; then chown postgres:postgres "$PGDATA"; fi
  chmod 700 "$PGDATA"
}

as_postgres() {
  if [ "$(id -u)" = "0" ]; then gosu postgres "$@"; else "$@"; fi
}

case "$NODE_ROLE" in
  primary)
    ;;

  replica)
    : "${PRIMARY_HOST:?PRIMARY_HOST requis}"
    : "${REPLICATION_PASSWORD:?REPLICATION_PASSWORD requis}"
    SLOT="${REPLICATION_SLOT:-replica1}"
    PRIMARY_PORT="${PRIMARY_PORT:-5432}"
    # Mot de passe de réplication dans un .pgpass réécrit à chaque démarrage,
    # hors du volume de données (jamais dans la ligne de commande ni les logs)
    PGPASSFILE="${PGPASSFILE_REPLICA:-/var/lib/postgresql/.pgpass-replica}"
    echo "${PRIMARY_HOST}:${PRIMARY_PORT}:*:replicator:${REPLICATION_PASSWORD}" > "$PGPASSFILE"
    chmod 600 "$PGPASSFILE"
    if [ "$(id -u)" = "0" ]; then chown postgres:postgres "$PGPASSFILE"; fi
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      log "volume vide : copie initiale depuis ${PRIMARY_HOST} (slot ${SLOT})"
      until as_postgres pg_isready -h "$PRIMARY_HOST" -p "$PRIMARY_PORT" -q; do
        log "en attente du principal…"; sleep 2
      done
      prepare_datadir
      as_postgres pg_basebackup \
        -d "host=${PRIMARY_HOST} port=${PRIMARY_PORT} user=replicator application_name=${SLOT} passfile=${PGPASSFILE}" \
        -D "$PGDATA" -X stream -S "$SLOT" -R -c fast
      log "copie initiale terminée ; démarrage en mode réplica"
    fi
    ;;

  restore)
    if [ ! -s "$PGDATA/PG_VERSION" ]; then
      prepare_datadir
      ARGS=(--stanza=residence --pg1-path="$PGDATA")
      if [ -n "${RESTORE_TARGET:-}" ]; then
        TARGET="$RESTORE_TARGET"
        # Heure sans fuseau = heure de Montréal ; pgBackRest exige un décalage (-04 / -05)
        if ! [[ "$TARGET" =~ [+-][0-9]{2}(:?[0-9]{2})?$ ]]; then
          TARGET="$(TZ="${RESTORE_TZ:-America/Toronto}" date -d "$TARGET" '+%Y-%m-%d %H:%M:%S%z')"
        fi
        log "restauration à l'instant : ${TARGET}"
        ARGS+=(--type=time "--target=${TARGET}" --target-action=promote)
      else
        log "restauration jusqu'au dernier WAL archivé"
        ARGS+=(--type=default)
      fi
      as_postgres pgbackrest "${ARGS[@]}" restore
      # Une copie restaurée ne doit JAMAIS écrire dans le dépôt de production
      echo "archive_mode = off" >> "$PGDATA/postgresql.auto.conf"
    fi
    ;;

  *)
    log "NODE_ROLE inconnu : ${NODE_ROLE}"; exit 1 ;;
esac

exec docker-entrypoint.sh "$@"
