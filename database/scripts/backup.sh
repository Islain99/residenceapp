#!/usr/bin/env bash
# backup.sh [full|diff|incr] — lance une sauvegarde pgBackRest depuis le principal.
#   full : complète (1 fois par semaine)
#   diff : différentielle depuis la dernière complète (1 fois par jour)
#   incr : incrémentale depuis la dernière sauvegarde
# Les WAL sont archivés en continu : entre deux sauvegardes, on peut
# restaurer à n'importe quelle minute.
source "$(dirname "$0")/_lib.sh"
TYPE="${1:-diff}"
case "$TYPE" in full|diff|incr) ;; *) echo "Usage : $0 [full|diff|incr]"; exit 1 ;; esac

SVC=pg-primary
if is_standby pg-primary 2>/dev/null || ! on pg-primary pg_isready -q 2>/dev/null; then
  SVC=pg-replica   # après une bascule, le principal est pg-replica
fi
say "Sauvegarde $TYPE sur $SVC"
on "$SVC" pgbackrest --stanza=residence --type="$TYPE" backup
on "$SVC" pgbackrest --stanza=residence info
