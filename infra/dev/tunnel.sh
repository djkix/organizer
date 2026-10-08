#!/bin/sh
# Crée Postgres et Valkey de test sur la VM Docker, ouvre le tunnel SSH, et supprime tout à la fermeture.
# La stack « organizer-dev » n'existe que le temps des tests : elle ne contient que des données fabriquées,
# et vit hors de /opt/stacks : elle n'apparaît jamais dans Dockge à côté de la production « organizer ».
# Laisser tourner dans un terminal pendant le développement et les tests ; Ctrl-C pour fermer et nettoyer.
set -eu
HOTE="${ORGANIZER_SSH:-kix@192.168.1.201}"
ICI="$(cd "$(dirname "$0")" && pwd)"
PILE=organizer-dev  # dans le dossier personnel de la VM, hors de /opt/stacks : Dockge ne la voit jamais

nettoyer() {
  trap - EXIT INT TERM
  echo "Fermeture : suppression de la stack de test organizer-dev (conteneurs et volume)."
  ssh "$HOTE" "docker compose -f $PILE/compose.yaml down -v --remove-orphans >/dev/null 2>&1; rm -rf $PILE" || true
}

ssh "$HOTE" "mkdir -p $PILE && cat > $PILE/compose.yaml" < "$ICI/compose.yaml"
trap nettoyer EXIT INT TERM
ssh "$HOTE" "docker compose -f $PILE/compose.yaml up -d --wait"
echo "Tunnel ouvert : Postgres 127.0.0.1:55432, Valkey 127.0.0.1:56379. Ctrl-C pour fermer."
ssh -N -o ExitOnForwardFailure=yes -L 55432:127.0.0.1:55432 -L 56379:127.0.0.1:56379 "$HOTE"
