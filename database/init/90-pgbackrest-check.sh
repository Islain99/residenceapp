#!/usr/bin/env bash
# 90-pgbackrest-check.sh — vérifie que l'archivage des WAL fonctionne.
# La première sauvegarde complète se lance ensuite avec : scripts/backup.sh full
set -Eeuo pipefail
pgbackrest --stanza=residence check
echo "[init] archivage des WAL vérifié"
