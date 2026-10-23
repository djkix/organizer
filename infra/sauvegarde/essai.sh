#!/bin/sh
# Essai du script de sauvegarde, dans l'image : faux pg_dump et psql, cible, audio et pile factices dans /tmp.
# Usage : docker run --rm --entrypoint sh ghcr.io/djkix/organizer-sauvegarde:essai /app/essai.sh
set -u
R=/tmp/essai-sauvegarde
rm -rf "$R"
mkdir -p "$R/bin" "$R/nas" "$R/audio/prive/2026/10" "$R/pile/secrets"

cat > "$R/bin/pg_dump" <<'EOF'
#!/bin/sh
[ "${FAUX_PG_ECHEC:-0}" = 1 ] && exit 1
echo "$*" > "${0%/bin/pg_dump}/pg_dump.args"
while [ $# -gt 0 ]; do
  if [ "$1" = -f ]; then echo dump > "$2"; exit 0; fi
  shift
done
exit 1
EOF
cat > "$R/bin/psql" <<EOF
#!/bin/sh
[ "\${FAUX_PSQL_ECHEC:-0}" = 1 ] && exit 2
echo "\$*" >> "$R/sql.log"
EOF
chmod +x "$R/bin/pg_dump" "$R/bin/psql"
echo compose > "$R/pile/compose.yaml"
echo env > "$R/pile/.env"
echo secret > "$R/pile/secrets/s"
echo a > "$R/audio/a.ogg"
echo p > "$R/audio/prive/2026/10/p.ogg"

echec() { echo "ÉCHEC : $1" >&2; cat "$R/out.log" >&2; exit 1; }
nuit() {
  AUJOURDHUI="$1" CIBLE="$R/nas" AUDIO="${AUDIO_ESSAI:-$R/audio}" PILE="$R/pile" DATABASE_URL=postgresql://faux \
    PATH="$R/bin:$PATH" /app/sauvegarder.sh > "$R/out.log" 2>&1
}
inode() { stat -c %i "$1"; }
dates() { ls -d "$R/nas"/????-??-?? 2>/dev/null | sed 's|.*/||' | tr '\n' ' '; }

# première nuit
nuit 2026-10-01 || echec "première nuit : code $?"
for f in base/organizer.dump audio/a.ogg audio/prive/2026/10/p.ogg config/compose.yaml config/.env config/secrets/s sauvegarde.txt; do
  [ -f "$R/nas/2026-10-01/$f" ] || echec "première nuit : $f absent"
done
[ "$(readlink "$R/nas/derniere")" = 2026-10-01 ] || echec "première nuit : lien derniere"
grep -q true "$R/sql.log" || echec "première nuit : tentative non inscrite"
grep -q -- '--lock-wait-timeout=10min' "$R/pg_dump.args" || echec "pg_dump sans délai d'attente des verrous"

# fichier inchangé : lien physique
echo b > "$R/audio/b.ogg"
nuit 2026-10-02 || echec "deuxième nuit : code $?"
[ "$(inode "$R/nas/2026-10-01/audio/a.ogg")" = "$(inode "$R/nas/2026-10-02/audio/a.ogg")" ] || echec "fichier inchangé : pas de lien physique"
[ -f "$R/nas/2026-10-02/audio/b.ogg" ] && [ ! -e "$R/nas/2026-10-01/audio/b.ogg" ] || echec "nouveau fichier"

# fichier disparu : absent du jour, présent la veille
rm "$R/audio/a.ogg"
nuit 2026-10-03 || echec "troisième nuit : code $?"
[ ! -e "$R/nas/2026-10-03/audio/a.ogg" ] && [ -f "$R/nas/2026-10-02/audio/a.ogg" ] || echec "fichier disparu"

# même jour : remplacé
nuit 2026-10-03 || echec "même jour : code $?"
[ "$(dates)" = "2026-10-01 2026-10-02 2026-10-03 " ] || echec "même jour : $(dates)"
[ ! -e "$R/nas/.remplace" ] || echec "même jour : .remplace laissé"

# sept jours
for j in 04 05 06 07 08 09 10; do nuit "2026-10-$j" || echec "nuit du $j : code $?"; done
[ "$(dates)" = "2026-10-04 2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-10 " ] || echec "sept jours : $(dates)"

# échec de l'audio : rien n'est supprimé
AUDIO_ESSAI="$R/absent" nuit 2026-10-11 && echec "échec de l'audio : code 0"
[ "$(dates)" = "2026-10-04 2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-10 " ] || echec "échec de l'audio : $(dates)"
[ "$(readlink "$R/nas/derniere")" = 2026-10-10 ] || echec "échec de l'audio : lien derniere"
tail -1 "$R/sql.log" | grep -q false || echec "échec de l'audio : non inscrit"
tail -1 "$R/sql.log" | grep -q 'étape audio' || echec "échec de l'audio : message"

# échec de la base
FAUX_PG_ECHEC=1 nuit 2026-10-11 && echec "échec de la base : code 0"
tail -1 "$R/sql.log" | grep -q 'étape base' || echec "échec de la base : message"

# reste d'une tentative interrompue
mkdir -p "$R/nas/.en-cours/vieux"
nuit 2026-10-11 || echec "après interruption : code $?"
[ ! -e "$R/nas/.en-cours" ] || echec "reste d'une tentative interrompue"
[ "$(dates)" = "2026-10-05 2026-10-06 2026-10-07 2026-10-08 2026-10-09 2026-10-10 2026-10-11 " ] || echec "après interruption : $(dates)"

# inscription impossible : code de sortie de la sauvegarde conservé
FAUX_PSQL_ECHEC=1 nuit 2026-10-12 || echec "inscription impossible : code $?"
[ -d "$R/nas/2026-10-12" ] || echec "inscription impossible : dossier absent"

# déjà en cours : une deuxième tentative s'arrête sans toucher à rien
lignes="$(wc -l < "$R/sql.log")"
mkdir -p "$R/nas/.en-cours/temoin"
(
  exec 9> "$R/verrou"
  flock -n 9 || exit 3
  VERROU="$R/verrou" nuit 2026-10-13 && exit 1
  exit 0
) || echec "déjà en cours : la deuxième tentative a tourné"
grep -q 'déjà en cours' "$R/out.log" || echec "déjà en cours : message"
[ -d "$R/nas/.en-cours/temoin" ] || echec "déjà en cours : .en-cours supprimé"
[ ! -e "$R/nas/2026-10-13" ] || echec "déjà en cours : dossier créé"
[ "$(wc -l < "$R/sql.log")" = "$lignes" ] || echec "déjà en cours : tentative inscrite"

rm -rf "$R"
echo "Essai de la sauvegarde réussi."
