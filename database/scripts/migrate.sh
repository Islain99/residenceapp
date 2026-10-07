#!/usr/bin/env bash
# migrate.sh — applique les nouvelles migrations (migrations/*.sql) sur le
# principal. Le réplica les reçoit automatiquement par la réplication.
# Les fichiers sont copiés dans le conteneur : pas besoin de reconstruire l'image.
source "$(dirname "$0")/_lib.sh"
SVC=pg-primary; is_standby pg-primary 2>/dev/null && SVC=pg-replica
docker compose cp migrations/. "$SVC":/migrations/
docker compose exec -T -u postgres -e POSTGRES_DB="$DB" "$SVC" /docker-entrypoint-initdb.d/20-migrate.sh
