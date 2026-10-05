#!/bin/sh
# Essai de fumée des images dans la topologie réelle (infra/docker-compose.yml), secrets factices.
# Usage : infra/image/essai.sh [étiquette]   (défaut : essai ; images ghcr.io/djkix/organizer-*:<étiquette> déjà construites)
# Ne touche à aucune stack existante : projet « organizer-essai », dossier temporaire, tout est retiré à la fin.
# Plage d'adresses : l'essai réécrit 10.201.x en 10.211.x (compose et squid.conf, montée sur l'image sortie) pour ne
# pas chevaucher les réseaux de la stack de production sur la même VM. Le port 7070 de 127.0.0.1 doit être libre.
set -eu
ETIQUETTE="${1:-essai}"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
TRAVAIL="$(mktemp -d)"
PROJET=organizer-essai
URL=http://127.0.0.1:7070

dc() { docker compose -p "$PROJET" --project-directory "$TRAVAIL" -f "$TRAVAIL/compose.yaml" -f "$TRAVAIL/essai.yaml" "$@"; }
nettoyer() { dc down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$TRAVAIL"; }
trap nettoyer EXIT
trap 'exit 130' INT TERM
echec() { echo "ÉCHEC : $1" >&2; dc ps -a >&2 || true; dc logs --no-color --tail 40 >&2 || true; exit 1; }
entete() { curl -sS -D - -o /dev/null "$URL$1" | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }
statut() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }

mkdir -p "$TRAVAIL/secrets"
printf '0:faux' > "$TRAVAIL/secrets/telegram_bot_token"
printf 'secret-essai' > "$TRAVAIL/secrets/telegram_webhook_secret"
printf 'cle-essai' > "$TRAVAIL/secrets/gemini_api_key"
printf 'secret-essai' > "$TRAVAIL/secrets/google_client_secret"
head -c 32 /dev/urandom | base64 | tr -d '\n' > "$TRAVAIL/secrets/agenda_cle"
chmod 644 "$TRAVAIL"/secrets/*
sed 's/10\.201\./10.211./g' "$RACINE/infra/docker-compose.yml" > "$TRAVAIL/compose.yaml"
sed 's/10\.201\./10.211./g' "$RACINE/infra/sortie/squid.conf" > "$TRAVAIL/squid.conf"
cat > "$TRAVAIL/essai.yaml" <<'EOF'
services:
  sortie:
    volumes:
      - ./squid.conf:/etc/squid/squid.conf:ro
EOF
cat > "$TRAVAIL/.env" <<EOF
ORGANIZER_VERSION=$ETIQUETTE
POSTGRES_PASSWORD=essai
NPM_IP=127.0.0.1
IP_PUBLICATION=127.0.0.1
DOMAINE_BOT=bot.essai
DOMAINE_APP=organizer.essai
GOOGLE_CLIENT_ID=essai.apps.googleusercontent.com
EOF

dc up -d || echec "démarrage de la stack"
i=0
until curl -fsS "$URL/api/sante" 2>/dev/null | grep -q '"ok":true'; do
  i=$((i + 1)); [ "$i" -lt 60 ] || echec "la stack ne répond pas sur /api/sante"; sleep 3
done
[ "$(dc ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | grep '^migrate ')" = "migrate exited 0" ] || echec "migrations"

# Scheduler : démarré, non root, racine en lecture seule
i=0
until dc logs --no-color scheduler 2>/dev/null | grep -q 'Scheduler démarré'; do
  i=$((i + 1)); [ "$i" -lt 20 ] || echec "le scheduler ne démarre pas"; sleep 3
done
[ "$(dc exec -T scheduler id -u)" = 1000 ] || echec "scheduler en root"
dc exec -T scheduler sh -c 'touch /essai' 2>/dev/null && echec "scheduler : racine inscriptible"

# Volume audio : inscriptible par l'API (uid 1000), lisible par le worker
dc exec -T api sh -c 'touch /data/audio/.essai && rm /data/audio/.essai' || echec "volume audio non inscriptible"
dc exec -T worker test -r /data/audio || echec "volume audio illisible par le worker"

# Coquille, repli, en-têtes
curl -sS "$URL/" -o "$TRAVAIL/index.html" || echec "coquille injoignable"
[ "$(statut "$URL/prive/enregistrer")" = 200 ] || echec "repli index.html"
EMPREINTE="$(node "$RACINE/apps/web/scripts/entetes.mjs" empreintes "$TRAVAIL/index.html" | head -1)"
[ -n "$EMPREINTE" ] || echec "aucun script en ligne dans la coquille servie"
entete / content-security-policy | grep -qF "$EMPREINTE" || echec "CSP sans l'empreinte du script de la coquille servie"
entete / content-security-policy | grep -qF "frame-ancestors 'none'" || echec "frame-ancestors"
[ "$(entete / cache-control)" = "no-cache" ] || echec "index.html doit être no-cache"
[ "$(entete /sw.js cache-control)" = "no-cache" ] || echec "sw.js doit être no-cache"
IMMUABLE="$(grep -o '/_app/immutable/[^"]*\.js' "$TRAVAIL/index.html" | head -1)"
entete "$IMMUABLE" cache-control | grep -q immutable || echec "_app/immutable doit être immutable"
entete /manifest.webmanifest content-type | grep -q '^application/manifest+json' || echec "type du manifeste"
entete / permissions-policy | grep -qF 'microphone=(self)' || echec "Permissions-Policy"
entete / permissions-policy | grep -qF 'publickey-credentials-get=(self)' || echec "Permissions-Policy : empreinte"
[ "$(entete / referrer-policy)" = "no-referrer" ] || echec "Referrer-Policy"
[ "$(entete / x-content-type-options)" = "nosniff" ] || echec "nosniff"

# API derrière Caddy
[ "$(entete /api/session/moi cache-control)" = "no-store" ] || echec "/api doit être no-store"
[ "$(statut "$URL/api/session/moi")" = 401 ] || echec "/api/session/moi sans session"
curl -sS -X POST "$URL/api/session/empreinte/options" | grep -qF '"rpId":"organizer.essai"' || echec "options d'empreinte : identifiant de RP"

# Retour OAuth sans état : toujours vers Réglages, jamais une erreur
[ "$(curl -sS -o /dev/null -w '%{redirect_url}' "$URL/api/agenda/retour?state=x&code=y")" = "$URL/reglages?agenda=expire" ] || echec "retour OAuth"

# Webhook : seulement sur le domaine du bot, secret vérifié
[ "$(statut -X POST "$URL/telegram/webhook")" = 404 ] || echec "webhook ouvert sur le domaine principal"
CODE="$(statut -X POST -H 'Host: bot.essai' -H 'X-Telegram-Bot-Api-Secret-Token: faux' -H 'content-type: application/json' -d '{"update_id":1}' "$URL/telegram/webhook")"
[ "$CODE" = 401 ] || echec "webhook sans secret valide : $CODE au lieu de 401"

# Sortie : par le proxy seulement, vers la liste fermée seulement
dc exec -T api node apps/api/dist/cli.mjs essai-sortie https://api.telegram.org | grep -q '^joignable' || echec "api : Telegram devrait être joignable"
dc exec -T api node apps/api/dist/cli.mjs essai-sortie https://example.com | grep -q '^refusé' || echec "api : example.com devrait être refusé"
dc exec -T worker node apps/worker/dist/sonde.mjs sortie https://generativelanguage.googleapis.com | grep -q '^joignable' || echec "worker : Gemini devrait être joignable"
dc exec -T worker node apps/worker/dist/sonde.mjs sortie https://api.telegram.org | grep -q '^refusé' || echec "worker : Telegram devrait être refusé"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://www.googleapis.com | grep -q '^joignable' || echec "scheduler : Google Agenda devrait être joignable"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://oauth2.googleapis.com | grep -q '^joignable' || echec "scheduler : OAuth Google devrait être joignable"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://generativelanguage.googleapis.com | grep -q '^refusé' || echec "scheduler : Gemini devrait être refusé"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://example.com | grep -q '^refusé' || echec "scheduler : example.com devrait être refusé"
dc exec -T worker node apps/worker/dist/sonde.mjs sortie https://www.googleapis.com | grep -q '^refusé' || echec "worker : Google Agenda devrait être refusé"
dc exec -T api node apps/api/dist/cli.mjs essai-sortie https://oauth2.googleapis.com | grep -q '^refusé' || echec "api : OAuth Google devrait être refusé"
dc exec -T scheduler node -e "fetch('https://www.googleapis.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))" \
  || echec "scheduler : sortie directe possible sans le proxy"
dc exec -T api node -e "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))" \
  || echec "api : sortie directe possible sans le proxy"
dc exec -T api ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus || echec "ffmpeg sans libopus"

echo "Essai de fumée réussi."
