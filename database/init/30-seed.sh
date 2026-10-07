#!/usr/bin/env bash
# 30-seed.sh — charge les données fictives seulement si SEED=true
set -Eeuo pipefail
if [ "${SEED:-false}" = "true" ]; then
  { echo "SET ROLE app_migrator;"; cat "${SEED_FILE:-/seed/seed.sql}"; } | \
    psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-residence}"
else
  echo "[seed] ignoré (SEED != true)"
fi
