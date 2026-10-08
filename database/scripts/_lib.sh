#!/usr/bin/env bash
# Fonctions communes aux scripts d'exploitation (exécutés depuis l'hôte).
set -Eeuo pipefail
# Git Bash (Windows) : ne pas convertir /chemin en C:/Program Files/Git/chemin.
# Les chemins passés à docker sont ceux du conteneur.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
DB="$(grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2 || true)"
DB="${DB:-residence}"

dc()        { docker compose "$@"; }
on()        { local svc="$1"; shift; docker compose exec -T -u postgres "$svc" "$@"; }
sql()       { local svc="$1"; shift; on "$svc" psql -X -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
is_standby(){ [ "$(sql "$1" -tAc 'SELECT pg_is_in_recovery()' 2>/dev/null)" = "t" ]; }
say()       { printf '\n\033[1m%s\033[0m\n' "$*"; }
# Principal actuel : pg-primary, ou pg-replica après une bascule
primary_svc(){
  if on pg-primary pg_isready -q 2>/dev/null && ! is_standby pg-primary; then echo pg-primary; else echo pg-replica; fi
}
