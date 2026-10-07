#!/usr/bin/env bash
# Fonctions communes aux scripts d'exploitation (exécutés depuis l'hôte).
set -Eeuo pipefail
cd "$(dirname "$0")/.."
DB="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2 || true)"
DB="${DB:-residence}"

dc()        { docker compose "$@"; }
on()        { local svc="$1"; shift; docker compose exec -T -u postgres "$svc" "$@"; }
sql()       { local svc="$1"; shift; on "$svc" psql -X -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
is_standby(){ [ "$(sql "$1" -tAc 'SELECT pg_is_in_recovery()' 2>/dev/null)" = "t" ]; }
say()       { printf '\n\033[1m%s\033[0m\n' "$*"; }
