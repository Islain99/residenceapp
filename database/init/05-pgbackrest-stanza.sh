#!/usr/bin/env bash
# 05-pgbackrest-stanza.sh — crée le dépôt de sauvegarde (stanza) AVANT tout
# le reste, pour que l'archivage des WAL fonctionne dès la création du schéma.
set -Eeuo pipefail
pgbackrest --stanza=residence stanza-create
echo "[init] dépôt pgBackRest créé"
