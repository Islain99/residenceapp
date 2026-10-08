#!/usr/bin/env bash
# =====================================================================
# restore-test.sh ["AAAA-MM-JJ HH:MM:SS"] — restaure les sauvegardes dans
# un serveur SÉPARÉ (pg-restore, port 5434), sans toucher à la production.
#   sans argument : jusqu'au dernier WAL archivé (test mensuel)
#   avec une date : état exact de la base à cet instant (erreur humaine)
# Heure locale de Montréal par défaut.
# Ensuite : consulter sur localhost:5434, récupérer les données utiles,
# puis supprimer :  docker compose --profile restore rm -sf pg-restore
# (JAMAIS « down -v » : supprimerait aussi le volume des sauvegardes)
# =====================================================================
source "$(dirname "$0")/_lib.sh"
PROJECT="$(docker compose config --format json | python3 -c 'import sys,json;print(json.load(sys.stdin)["name"])' 2>/dev/null || basename "$PWD")"

TARGET="${1:-}"   # converti en heure de Montréal par le conteneur

say "Nettoyage d'une restauration précédente"
dc --profile restore rm -sf pg-restore >/dev/null 2>&1 || true
docker volume rm "${PROJECT}_pg-restore-data" >/dev/null 2>&1 || true

LABEL="jusqu'au dernier WAL archivé"; [ -n "$TARGET" ] && LABEL="à l'instant $TARGET (heure de Montréal)"
say "Restauration $LABEL"
RESTORE_TARGET="$TARGET" dc --profile restore up -d pg-restore

for i in $(seq 1 90); do
  if on pg-restore pg_isready -q 2>/dev/null && ! is_standby pg-restore; then
    say "Copie restaurée disponible sur localhost:5434"
    sql pg-restore -c "SELECT (SELECT count(*) FROM notes) AS notes,
                              (SELECT max(created_at) FROM notes) AS derniere_note,
                              (SELECT count(*) FROM residents) AS residents"
    echo "Supprimer après usage : docker compose --profile restore rm -sf pg-restore && docker volume rm ${PROJECT}_pg-restore-data"
    exit 0
  fi
  sleep 2
done
echo "Restauration non terminée après 3 min : docker compose logs pg-restore"; exit 1
