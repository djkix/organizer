#!/bin/sh
# Une sauvegarde vers le NAS (décision 28) : base, puis audio, puis configuration de la stack, dans un dossier daté.
# Sept jours gardés ; un fichier audio inchangé est un lien physique vers celui de la veille. Sans chiffrement.
# Une tentative ratée ne supprime rien. Chaque tentative est inscrite dans la table sauvegarde, lue par la veille.
# Usage : /app/sauvegarder.sh (lancé chaque nuit par planifier.sh, ou à la main). Sort en 0 si tout a réussi.
set -u
CIBLE="${CIBLE:-/nas}"
AUDIO="${AUDIO:-/data/audio}"
PILE="${PILE:-/stack}"
GARDER="${GARDER:-7}"
: "${DATABASE_URL:?DATABASE_URL manquante}"
JOUR="${AUJOURDHUI:-$(date +%F)}"
DEBUT="$(date +%s)"
DEBUT_LISIBLE="$(date -Iseconds)"
TMP="$CIBLE/.en-cours"
MESSAGE=""
umask 022

# Une seule sauvegarde à la fois (planifiée et à la main partagent le /tmp du conteneur) ; rien n'est inscrit.
exec 9> "${VERROU:-/tmp/sauvegarde.verrou}"
flock -n 9 || { echo "Sauvegarde déjà en cours : rien n'est fait." >&2; exit 1; }

# Message technique seulement : jamais de contenu de capture.
echouer() { MESSAGE="étape $1 (code $2)"; return 1; }

sauvegarder() {
  rm -rf "$TMP" && mkdir -p "$TMP/base" "$TMP/config" || echouer base $? || return
  # La base d'abord : tout fichier qu'elle référence sera dans l'audio copié ensuite.
  # Une table verrouillée ne bloque pas la nuit : pg_dump abandonne au bout de 10 minutes.
  pg_dump -Fc --lock-wait-timeout=10min --dbname="$DATABASE_URL" -f "$TMP/base/organizer.dump" || echouer base $? || return
  # Sans propriétaire ni groupe : le NAS les écrase (squash) ; la restauration remet 1000.
  set -- -rlt
  [ -d "$CIBLE/derniere/audio" ] && set -- "$@" --link-dest="$CIBLE/derniere/audio"
  rsync "$@" "$AUDIO/" "$TMP/audio/" || echouer audio $? || return
  { cp "$PILE/compose.yaml" "$PILE/.env" "$TMP/config/" && cp -R "$PILE/secrets" "$TMP/config/"; } || echouer config $? || return
  {
    echo "version : ${ORGANIZER_VERSION:-inconnue}"
    echo "début : $DEBUT_LISIBLE"
    echo "fin : $(date -Iseconds)"
    echo "base : $(wc -c < "$TMP/base/organizer.dump") octets"
    echo "fichiers audio : $(find "$TMP/audio" -type f | wc -l)"
  } > "$TMP/sauvegarde.txt" || echouer config $? || return
  # Une deuxième sauvegarde le même jour remplace celle du jour.
  if [ -e "$CIBLE/$JOUR" ]; then
    rm -rf "$CIBLE/.remplace" && mv "$CIBLE/$JOUR" "$CIBLE/.remplace" || echouer rotation $? || return
  fi
  mv "$TMP" "$CIBLE/$JOUR" || echouer rotation $? || return
  rm -rf "$CIBLE/.remplace"
  # Lien relatif : lisible depuis File Station comme depuis le conteneur.
  ln -sfn "$JOUR" "$CIBLE/derniere" || echouer rotation $? || return
  ls -d "$CIBLE"/????-??-?? | sort -r | tail -n +"$((GARDER + 1))" | while read -r vieux; do
    rm -rf "$vieux"
  done
}

if sauvegarder; then
  REUSSIE=true
  echo "Sauvegarde du $JOUR réussie."
else
  REUSSIE=false
  echo "Sauvegarde en échec : $MESSAGE." >&2
fi
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "INSERT INTO sauvegarde (debut, fin, reussie, message) \
VALUES (to_timestamp($DEBUT) AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC', $REUSSIE, '$MESSAGE')" > /dev/null \
  || echo "Inscription de la sauvegarde impossible : la veille alertera si rien ne réussit en 36 h." >&2
[ "$REUSSIE" = true ]
