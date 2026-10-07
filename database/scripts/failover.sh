#!/usr/bin/env bash
# =====================================================================
# failover.sh — BASCULE : le réplica devient le principal.
# À utiliser quand pg-primary est en panne (ou pour un exercice).
#
#  1. Arrête pg-primary s'il répond encore (évite deux principaux).
#  2. Promeut pg-replica en principal (lecture + écriture).
#  3. Rappelle de pointer l'API vers le port 5433.
# =====================================================================
source "$(dirname "$0")/_lib.sh"

if ! on pg-replica pg_isready -q; then
  echo "pg-replica ne répond pas : bascule impossible. Restaurer depuis les sauvegardes (README)."; exit 1
fi
if ! is_standby pg-replica; then
  echo "pg-replica est déjà principal : rien à faire."; exit 0
fi

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Confirmer la bascule vers pg-replica ? (oui/non) " ok
  [ "$ok" = "oui" ] || { echo "Annulé."; exit 1; }
fi

say "1/3 Arrêt de pg-primary (s'il tourne encore)"
dc stop pg-primary || true
# Empêche Docker de le relancer tout seul : deux principaux = données divergentes
dc rm -f pg-primary >/dev/null 2>&1 || true

say "2/3 Promotion de pg-replica"
sql pg-replica -tAc "SELECT pg_promote(wait => true, wait_seconds => 60)"
# Point de contrôle immédiat : sans lui, une sauvegarde lancée juste après
# la promotion échoue (« WAL timeline 2 does not match pg_control timeline 1 »)
sql pg-replica -qc "CHECKPOINT"
sql pg-replica -tAc "SELECT CASE WHEN pg_is_in_recovery() THEN 'ÉCHEC : encore en réplica' ELSE 'OK : pg-replica est le principal' END"

say "3/3 À faire maintenant"
cat <<'TXT'
  - API : DATABASE_URL -> port 5433 (localhost:5433), puis redémarrer l'API.
  - Lancer une sauvegarde complète sur le nouveau principal :
        scripts/backup.sh full
  - Tant que l'ancien principal n'est pas reconstruit, il n'y a PLUS de
    réplica : reconstruire dès que possible (README, « Retour à la normale »).
  - NE PAS relancer l'ancien volume pg-primary tel quel.
TXT
