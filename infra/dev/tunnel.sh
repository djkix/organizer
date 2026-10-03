#!/bin/sh
# Démarre Postgres et Valkey de dev sur la VM Docker, puis ouvre le tunnel SSH.
# Laisser tourner dans un terminal pendant le développement et les tests.
set -eu
HOTE="${ORGANIZER_SSH:-kix@192.168.1.201}"
ICI="$(cd "$(dirname "$0")" && pwd)"

ssh "$HOTE" 'mkdir -p ~/organizer-dev && cat > ~/organizer-dev/compose.yaml' < "$ICI/compose.yaml"
ssh "$HOTE" 'docker compose -f ~/organizer-dev/compose.yaml up -d --wait'
echo "Tunnel ouvert : Postgres 127.0.0.1:55432, Valkey 127.0.0.1:56379. Ctrl-C pour fermer."
exec ssh -N -o ExitOnForwardFailure=yes -L 55432:127.0.0.1:55432 -L 56379:127.0.0.1:56379 "$HOTE"
