#!/bin/sh
# Planification de la sauvegarde : chaque jour dès HEURE (heure de Paris, défaut 3 h).
# Une nuit manquée (VM ou NAS éteint) est rattrapée dès que le service tourne ; après un échec, une heure d'attente.
set -u
HEURE="${HEURE:-3}"
CIBLE="${CIBLE:-/nas}"
echo "Sauvegarde planifiée chaque jour à $HEURE h."
while :; do
  heure="$(date +%H | sed 's/^0//')"
  if [ "${heure:-0}" -ge "$HEURE" ] && [ "$(readlink "$CIBLE/derniere" 2>/dev/null)" != "$(date +%F)" ]; then
    /app/sauvegarder.sh || sleep 3600
  fi
  sleep 300
done
