#!/usr/bin/env bash
# migrate.sh — applique les nouvelles migrations (migrations/*.sql) sur le
# principal. Le réplica les reçoit automatiquement par la réplication.
# Les fichiers sont copiés dans le conteneur : pas besoin de reconstruire l'image.
source "$(dirname "$0")/_lib.sh"
SVC="$(primary_svc)"
say "Migrations sur $SVC"
docker compose cp migrations/. "$SVC":/migrations/
# Le script du dépôt, pas celui de l'image (qui peut dater d'une construction antérieure)
docker compose cp init/20-migrate.sh "$SVC":/tmp/20-migrate.sh
docker compose exec -T -u postgres -e POSTGRES_DB="$DB" "$SVC" bash /tmp/20-migrate.sh
