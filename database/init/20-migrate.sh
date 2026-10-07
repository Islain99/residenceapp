#!/usr/bin/env bash
# =====================================================================
# 20-migrate.sh — applique les migrations SQL, dans l'ordre, en tant
# que app_migrator. Réutilisable plus tard : scripts/migrate.sh
# n'applique que les versions absentes de schema_migrations.
# =====================================================================
set -Eeuo pipefail
DB="${POSTGRES_DB:-residence}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

for f in "$MIGRATIONS_DIR"/*.sql; do
  version="$(basename "$f" .sql)"
  applied="$(psql -tA --username "${POSTGRES_USER:-postgres}" --dbname "$DB" -c \
    "SELECT 1 FROM pg_tables WHERE tablename='schema_migrations'" )"
  if [ "$applied" = "1" ]; then
    applied="$(psql -tA --username "${POSTGRES_USER:-postgres}" --dbname "$DB" -c \
      "SELECT 1 FROM schema_migrations WHERE version='${version}'")"
  else
    applied=""
  fi
  if [ "$applied" = "1" ]; then
    echo "[migrate] ${version} déjà appliquée"
    continue
  fi
  echo "[migrate] application de ${version}"
  # SET ROLE : les objets appartiennent à app_migrator, pas au superutilisateur
  { echo "SET ROLE app_migrator;"; cat "$f"; } | \
    psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "$DB" -q
done
