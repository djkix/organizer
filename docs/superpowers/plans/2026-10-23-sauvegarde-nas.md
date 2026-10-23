# Sauvegarde quotidienne vers le NAS — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque nuit, copier la base, l'audio et la configuration de la stack dans `<dossier du NAS>/AAAA-MM-JJ/` sur le NAS, garder sept jours, et alerter l'admin en cas d'échec.

**Architecture:** Un nouveau service `sauvegarde` (image Alpine : client PostgreSQL 17, rsync, tzdata) monte le NAS en volume NFS déclaré dans le compose. Deux scripts POSIX : `sauvegarder.sh` fait une sauvegarde et l'inscrit dans une nouvelle table `sauvegarde` ; `planifier.sh` boucle et la lance chaque jour après 3 h. La veille de l'API lit la table et produit les alertes admin par le chemin existant.

**Tech Stack:** sh (BusyBox), rsync `--link-dest`, `pg_dump -Fc`, Prisma 6 (migration additive), NestJS (veille existante), Vitest, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-23-sauvegarde-nas-design.md`

## Global Constraints

- NAS `<IP du NAS>`, dossier partagé `<partage>`, sous-dossier `<dossier>`. NFS, squash total : ne jamais conserver propriétaire ni groupe (`rsync -rlt`).
- Contenu d'un dossier daté : `base/organizer.dump`, `audio/`, `config/compose.yaml`, `config/.env`, `config/secrets/`, `sauvegarde.txt`. Lien `derniere` vers le plus récent réussi.
- Ordre : base, puis audio, puis configuration.
- Sept dossiers datés au plus ; la rotation ne supprime qu'après une nuit réussie ; une deuxième sauvegarde le même jour remplace celle du jour.
- 3 h, heure de Paris (`TZ=Europe/Paris`). Une nuit manquée est rattrapée dès que le service tourne.
- Pas de chiffrement. Audio privé et secrets compris.
- Réseau `core` seulement. Utilisateur `1000:1000`, racine en lecture seule, `tmpfs /tmp`, journal JSON comme les autres services.
- Aucun service ne dépend de `sauvegarde`.
- Alertes : admin seul, chemin existant (file `alertes`). Échec de la dernière tentative ; aucune réussite depuis 36 h. Aucun texte de capture dans les messages ni les journaux.
- Messages en français ; `CHANGELOG.md` (« Non publié ») mis à jour dans chaque commit.
- Version visée : 1.11.0.

## Review Focus

1. **NAS injoignable au moment de la sauvegarde** (montage NFS « soft » qui rend la main en erreur) : la tentative échoue, rien n'est supprimé, une ligne `reussie = false` est écrite, l'alerte part. → test `échec de l'audio : rien n'est supprimé` (tâche 3).
2. **Base injoignable pendant l'inscription du résultat** : le script ne plante pas en boucle, il journalise et réessaie à la tentative suivante ; la veille finit par alerter (36 h). → test `inscription impossible : code de sortie de la sauvegarde conservé` (tâche 3).
3. **Fichier audio purgé par la rotation entre deux nuits** : il disparaît du dossier du jour, reste dans les précédents. → test `fichier disparu : absent du jour, présent la veille` (tâche 3).
4. **Premier démarrage, table vide** : aucune alerte tant qu'aucune sauvegarde n'a jamais tourné (la mise en service lance une sauvegarde à la main). → test `table vide : rien` (tâche 2).
5. **Reste d'une tentative interrompue** (`.en-cours` laissé par un arrêt du conteneur) : supprimé au début de la tentative suivante, jamais compté parmi les sept. → test `reste d'une tentative interrompue` (tâche 3).

---

### Task 1 : Reconnaissance du NAS depuis la VM (manuelle)

Aucun code. Fixe le chemin d'export que les tâches 4 et 6 utilisent. Commandes à lancer sur la VM Docker (`ssh user@<IP de la VM>`), avec l'accord de djkix.

- [ ] **Step 1 : Relever l'export**

Run: `showmount -e <IP du NAS>` (sinon `docker run --rm alpine sh -c 'apk add -q nfs-utils && showmount -e <IP du NAS>'`)
Expected: une ligne `/volumeN/<partage>` autorisée pour `<IP de la VM>`. Noter `N`.

- [ ] **Step 2 : Créer le dossier `organizer`** dans File Station, sous `<dossier du NAS>/`.

- [ ] **Step 3 : Essai d'écriture, de lien physique, de lien symbolique, de renommage et de suppression en uid 1000**

```bash
docker volume create --driver local --opt type=nfs --opt o=addr=<IP du NAS>,nfsvers=4.1,soft,timeo=150,retrans=3 \
  --opt device=:/volumeN/<partage>/<dossier> essai-nas
docker run --rm --user 1000:1000 -v essai-nas:/n alpine sh -c \
  'cd /n && mkdir t && echo a > t/f && ln t/f t/g && [ "$(stat -c %i t/f)" = "$(stat -c %i t/g)" ] && ln -s t l && mv t u && rm -rf u l && echo OK'
docker volume rm essai-nas
```

Expected: `OK`. Si `nfsvers=4.1` échoue, réessayer avec `nfsvers=3` et retenir la version qui marche. Si les inodes diffèrent, arrêter : `--link-dest` ne servirait à rien, revenir vers djkix.

- [ ] **Step 4 : Reporter** la valeur de `NAS_CHEMIN` (`:/volumeN/<partage>/<dossier>`) et la version NFS dans les défauts de la tâche 4.

---

### Task 2 : Table `sauvegarde` et alertes de la veille

**Files:**
- Create: `packages/db/prisma/migrations/20261023120000_sauvegarde/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (modèle `Sauvegarde`, après `Alerte`)
- Modify: `apps/api/src/veille/veille.ts` (`Mesures`, `SEUILS`, `constater`)
- Modify: `apps/api/src/veille/mesures.ts` (`mesurer`, `formaterMesures`)
- Test: `apps/api/test/veille.test.ts`, `apps/api/test/mesures.test.ts`

**Interfaces:**
- Produces (table, utilisée par la tâche 3) : `sauvegarde(id uuid PK DEFAULT gen_random_uuid(), debut timestamp(3) NOT NULL, fin timestamp(3) NOT NULL, reussie boolean NOT NULL, message text NOT NULL)`, index sur `fin`. Horodatages en UTC sans fuseau, comme le reste de la base.
- Produces (TS) : `Mesures` gagne `derniereSauvegarde: { fin: Date; reussie: boolean; message: string } | null` et `derniereSauvegardeReussie: Date | null`. `SEUILS` gagne `sauvegardeHeures: 36`.

- [ ] **Step 1 : Écrire les tests de `constater`** dans `veille.test.ts` (ajouter les deux champs à `BASE`, valeurs `null`) :

```ts
describe('constater : sauvegarde', () => {
  const ok = { fin: new Date('2026-10-16T01:05:00Z'), reussie: true, message: '' };
  it('table vide : rien', () => {
    expect(cles({ derniereSauvegarde: null, derniereSauvegardeReussie: null })).toEqual([]);
  });
  it('dernière tentative en échec : une alerte avec son message', () => {
    const [c] = constater({ ...BASE, derniereSauvegarde: { fin: T, reussie: false, message: 'étape audio (code 23)' }, derniereSauvegardeReussie: ok.fin }, T);
    expect(c).toEqual({ cle: 'sauvegarde-echec', message: 'Sauvegarde en échec : étape audio (code 23).' });
  });
  it('aucune réussite depuis 36 h', () => {
    const il36h = new Date(T.getTime() - 36 * 3600_000);
    expect(cles({ derniereSauvegarde: { ...ok, fin: il36h }, derniereSauvegardeReussie: il36h })).toEqual([]);
    const plus = new Date(il36h.getTime() - 60_000);
    const [c] = constater({ ...BASE, derniereSauvegarde: { ...ok, fin: plus }, derniereSauvegardeReussie: plus }, T);
    expect(c).toEqual({ cle: 'sauvegarde-absente', message: 'Aucune sauvegarde réussie depuis 36 h.' });
  });
  it('échecs répétés sans réussite : les deux constats', () => {
    expect(cles({ derniereSauvegarde: { fin: T, reussie: false, message: 'x' }, derniereSauvegardeReussie: new Date('2026-10-10T00:00:00Z') }))
      .toEqual(['sauvegarde-echec', 'sauvegarde-absente']);
  });
  it('jamais réussie, dernière tentative ratée il y a plus de 36 h', () => {
    const vieux = new Date(T.getTime() - 37 * 3600_000);
    expect(cles({ derniereSauvegarde: { fin: vieux, reussie: false, message: 'x' }, derniereSauvegardeReussie: null }))
      .toEqual(['sauvegarde-echec', 'sauvegarde-absente']);
    expect(cles({ derniereSauvegarde: { fin: T, reussie: false, message: 'x' }, derniereSauvegardeReussie: null }))
      .toEqual(['sauvegarde-echec']);
  });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm vitest run apps/api/test/veille.test.ts`
Expected: FAIL (champs inconnus, constats absents).

- [ ] **Step 3 : Implémenter** dans `veille.ts` : les deux champs, `sauvegardeHeures: 36`, et les deux constats avec exactement les messages des tests. « Absente » se mesure depuis `derniereSauvegardeReussie`, ou, si elle est nulle, depuis `derniereSauvegarde.fin` ; table vide : rien. (Approximation assumée : sans réussite, on mesure depuis la dernière tentative ratée, pas la première ; avec un échec par heure, l'alerte « échec » part de toute façon.)

- [ ] **Step 4 : Migration et modèle.** `migration.sql` : en-tête de commentaire comme les migrations voisines (« Sauvegarde vers le NAS (1.11.0) : une ligne par tentative, écrite par le service sauvegarde. Migration additive. »), puis la table et l'index. Modèle Prisma `Sauvegarde` avec `@@map("sauvegarde")`, `id String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid`, champs mappés en snake_case comme `Alerte`.

Run: `pnpm db migrate dev --name sauvegarde` puis renommer le dossier produit en `20261023120000_sauvegarde` si besoin, et `pnpm db migrate status`.
Expected: « Database schema is up to date ».

- [ ] **Step 5 : Test de `mesurer`** dans `mesures.test.ts` : avec deux lignes (`reussie: true` à `fin = t-2h`, `reussie: false` à `fin = t-1h`, message `'x'`), `m.derniereSauvegarde` vaut `{ fin: t-1h, reussie: false, message: 'x' }` et `m.derniereSauvegardeReussie` vaut `t-2h` ; sans ligne, les deux sont `null`. `formaterMesures` contient `dernière sauvegarde réussie : ` suivi de la date ISO ou de `-`.

- [ ] **Step 6 : Implémenter `mesurer`** : deux `findFirst` sur `sauvegarde` triés par `fin desc` (le second filtré sur `reussie: true`). `viderBase` doit vider la nouvelle table : vérifier `packages/db` (`@organizer/db/test`) et l'y ajouter si la liste est explicite.

- [ ] **Step 7 : Lancer**

Run: `pnpm vitest run apps/api/test/veille.test.ts apps/api/test/mesures.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8 : Commit** avec la ligne de `CHANGELOG.md`, rubrique Ajouté : « Table `sauvegarde` (migration additive) et alertes admin de la veille : dernière sauvegarde en échec, aucune réussie depuis 36 h ; `cli veille` montre la dernière réussite (2026-10-23). »

---

### Task 3 : Scripts et image `sauvegarde`

**Files:**
- Create: `infra/sauvegarde/sauvegarder.sh`, `infra/sauvegarde/planifier.sh`, `infra/sauvegarde/essai.sh`
- Modify: `infra/image/Dockerfile` (cible `sauvegarde`)
- Modify: `.github/workflows/ci.yml` (les trois boucles `for cible in …` gagnent `sauvegarde` ; une étape « Essai du script de sauvegarde » après la construction)

**Interfaces:**
- Consumes : la table `sauvegarde` (tâche 2).
- Produces (tâche 4) : image `ghcr.io/djkix/organizer-sauvegarde`, commande par défaut `planifier.sh`, commande manuelle `/app/sauvegarder.sh`. Variables lues, avec ces défauts : `CIBLE=/nas`, `AUDIO=/data/audio`, `PILE=/stack` (contient `compose.yaml`, `.env`, `secrets/`), `GARDER=7`, `DATABASE_URL` (obligatoire), `ORGANIZER_VERSION` (posée par l'image), `HEURE=3`. Pour l'essai seulement : `AUJOURDHUI` (AAAA-MM-JJ) remplace la date du jour.
- `sauvegarder.sh` sort en 0 si tout a réussi, 1 sinon.

`sauvegarder.sh`, dans cet ordre :
1. `set -eu`, `umask 022`. Supprimer `$CIBLE/.en-cours` s'il existe, puis le recréer.
2. `pg_dump -Fc --dbname="$DATABASE_URL" -f .en-cours/base/organizer.dump`.
3. `rsync -rlt --delete [--link-dest="$CIBLE/derniere/audio" si ce dossier existe] "$AUDIO/" .en-cours/audio/`.
4. Copie de `$PILE/compose.yaml`, `$PILE/.env`, `$PILE/secrets/` dans `.en-cours/config/`.
5. `sauvegarde.txt` : version, début, fin (ISO, heure de Paris), taille de la base, nombre de fichiers audio.
6. Si `$CIBLE/$JOUR` existe, le déplacer en `.remplace` ; renommer `.en-cours` en `$JOUR` ; supprimer `.remplace` ; recréer `derniere` en lien symbolique **relatif** (`derniere -> $JOUR`, lisible depuis File Station et depuis le conteneur) ; supprimer les dossiers `????-??-??` au-delà des `$GARDER` plus récents (tri par nom).
7. Toute erreur d'une étape : message `étape <base|audio|config|rotation> (code <n>)`, sans autre contenu ; aucune suppression de dossier daté.
8. Dans tous les cas, inscrire la tentative : `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO sauvegarde (debut, fin, reussie, message) VALUES (to_timestamp(<début epoch>) AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC', <bool>, <message en littéral SQL>)"`. Si l'inscription échoue, l'écrire sur la sortie d'erreur et garder le code de sortie de la sauvegarde.
9. Une ligne de journal par tentative : `Sauvegarde du <jour> réussie.` ou `Sauvegarde en échec : <message>.`

`planifier.sh` : boucle infinie, toutes les 300 s : si l'heure locale est ≥ `$HEURE` et que `derniere` ne pointe pas sur le jour courant, lancer `sauvegarder.sh` ; après un échec, attendre 3600 s avant la tentative suivante. Au démarrage, journaliser `Sauvegarde planifiée chaque jour à <HEURE> h.`

- [ ] **Step 1 : Écrire `infra/sauvegarde/essai.sh`**, lancé dans l'image (`docker run --rm --entrypoint sh <image> /app/essai.sh`). Il crée sous `/tmp` une cible, un audio et une pile factices, met en tête du `PATH` des faux `pg_dump` (écrit un fichier, ou échoue si `FAUX_PG_ECHEC=1`) et `psql` (ajoute sa commande à `/tmp/sql.log`, ou échoue si `FAUX_PSQL_ECHEC=1`), puis vérifie, en sortant en 1 au premier écart :
  - `première nuit` : `2026-10-01/` contient `base/organizer.dump`, `audio/a.ogg`, `config/compose.yaml`, `config/.env`, `config/secrets/s`, `sauvegarde.txt` ; `derniere` pointe sur `2026-10-01` ; `sql.log` contient `true`.
  - `fichier inchangé : lien physique` : après la nuit du `2026-10-02`, `audio/a.ogg` a le même inode dans les deux dossiers ; un nouveau `b.ogg` n'existe que dans le second.
  - `fichier disparu : absent du jour, présent la veille` : `a.ogg` supprimé de l'audio avant la nuit du `2026-10-03` → absent de `2026-10-03/audio`, présent dans `2026-10-02/audio`.
  - `même jour : remplacé` : deux passages le `2026-10-03` → un seul dossier `2026-10-03`, pas de `.remplace`.
  - `sept jours` : après dix nuits du `2026-10-01` au `2026-10-10`, seuls `2026-10-04` à `2026-10-10` restent.
  - `échec de l'audio : rien n'est supprimé` : `AUDIO` pointé sur un dossier absent, nuit du `2026-10-11` → code 1, les sept dossiers intacts, `derniere` inchangé, `sql.log` contient `false` et `étape audio`.
  - `échec de la base` : `FAUX_PG_ECHEC=1` → code 1, message `étape base`.
  - `reste d'une tentative interrompue` : un `.en-cours/` laissé avant une nuit réussie → absent après, sept dossiers datés.
  - `inscription impossible : code de sortie de la sauvegarde conservé` : `FAUX_PSQL_ECHEC=1` sur une nuit réussie → code 0, dossier du jour présent.
  - Termine par `Essai de la sauvegarde réussi.`

- [ ] **Step 2 : Cible `sauvegarde` dans le Dockerfile**

```dockerfile
FROM ${ALPINE_IMAGE} AS sauvegarde
RUN apk upgrade --no-cache && apk add --no-cache postgresql17-client rsync tzdata tini
COPY infra/sauvegarde/sauvegarder.sh infra/sauvegarde/planifier.sh infra/sauvegarde/essai.sh /app/
ARG ORGANIZER_VERSION=dev
ENV ORGANIZER_VERSION=${ORGANIZER_VERSION} TZ=Europe/Paris
LABEL org.opencontainers.image.source=https://github.com/djkix/organizer
USER 1000:1000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/planifier.sh"]
```

Mettre à jour le commentaire d'en-tête du Dockerfile (« api, worker, scheduler, web, sortie, sauvegarde »).

- [ ] **Step 3 : Construire et lancer l'essai, vérifier l'échec**

Run: `docker build --target sauvegarde -f infra/image/Dockerfile -t organizer-sauvegarde:essai . && docker run --rm --entrypoint sh organizer-sauvegarde:essai /app/essai.sh`
Expected: FAIL (scripts absents ou vides).

- [ ] **Step 4 : Écrire `sauvegarder.sh` et `planifier.sh`** selon les interfaces ci-dessus (`#!/bin/sh`, exécutables).

- [ ] **Step 5 : Relancer**

Run: même commande qu'au step 3.
Expected: `Essai de la sauvegarde réussi.`

- [ ] **Step 6 : CI.** Ajouter `sauvegarde` aux trois boucles de `ci.yml` (construction, analyse Trivy, publication ; le titre « Construire les cinq images » devient « six »), et l'étape `docker run --rm --entrypoint sh ghcr.io/djkix/organizer-sauvegarde:essai /app/essai.sh` après la construction.

- [ ] **Step 7 : Commit** avec la ligne de `CHANGELOG.md`, rubrique Ajouté : « Image `organizer-sauvegarde` : chaque jour après 3 h, base, audio et configuration de la stack copiés dans un dossier daté, fichiers inchangés en liens physiques, sept jours gardés ; une tentative ratée ne supprime rien ; essai du script dans la CI (2026-10-23). »

---

### Task 4 : Service `sauvegarde` dans la stack et essai de fumée

**Files:**
- Modify: `infra/docker-compose.yml`
- Modify: `infra/image/essai.sh`
- Modify: `infra/.env.example` (trois variables facultatives, commentées)

**Interfaces:**
- Consumes : l'image et ses variables (tâche 3) ; `NAS_CHEMIN` et la version NFS (tâche 1).
- Produces : le service `sauvegarde` et le volume `nas` ; trois variables facultatives du `.env` : `NAS_TYPE` (défaut `nfs`), `NAS_OPTIONS` (défaut `addr=<IP du NAS>,nfsvers=4.1,soft,timeo=150,retrans=3`), `NAS_CHEMIN` (défaut relevé en tâche 1). L'essai les remplace par un montage local.

- [ ] **Step 1 : Essai de fumée d'abord.** Dans `infra/image/essai.sh` : créer `$TRAVAIL/nas` (`chmod 777`), ajouter au `.env` d'essai `NAS_TYPE=none`, `NAS_OPTIONS=bind`, `NAS_CHEMIN=$TRAVAIL/nas`. Après les contrôles du scheduler, ajouter :

```sh
# Sauvegarde : planifiée, non root, puis une sauvegarde à la main dans le dossier d'essai
dc logs --no-color sauvegarde 2>/dev/null | grep -q 'Sauvegarde planifiée' || echec "la sauvegarde n'est pas planifiée"
[ "$(dc exec -T sauvegarde id -u)" = 1000 ] || echec "sauvegarde en root"
dc exec -T sauvegarde /app/sauvegarder.sh || echec "sauvegarde à la main"
JOUR="$(date +%F)"
[ -s "$TRAVAIL/nas/$JOUR/base/organizer.dump" ] || echec "dump absent"
[ -f "$TRAVAIL/nas/$JOUR/config/secrets/agenda_cle" ] || echec "secrets absents"
[ "$(readlink "$TRAVAIL/nas/derniere")" = "$JOUR" ] || echec "lien derniere"
dc exec -T db psql -U organizer -d organizer -tAc 'SELECT reussie FROM sauvegarde ORDER BY fin DESC LIMIT 1' | grep -q '^t$' || echec "tentative non inscrite"
dc exec -T sauvegarde sh -c 'wget -qT5 -O- https://example.com' && echec "sauvegarde : sortie vers Internet possible"
```

Run: `infra/image/essai.sh essai` (images de la tâche 3 construites, Docker requis)
Expected: FAIL (`sauvegarde` inconnu).

- [ ] **Step 2 : Service et volume dans le compose**

```yaml
  # Sauvegarde vers le NAS (lot 2, décision 28) : chaque jour après 3 h, sept jours gardés, sans chiffrement.
  # Aucun service n'en dépend : NAS éteint, seul ce conteneur ne démarre pas.
  sauvegarde:
    <<: *app
    image: ghcr.io/djkix/organizer-sauvegarde:${ORGANIZER_VERSION:-latest}
    environment:
      TZ: Europe/Paris
      DATABASE_URL: postgresql://organizer:${POSTGRES_PASSWORD:?}@db:5432/organizer
    volumes:
      - audio:/data/audio:ro
      - ./compose.yaml:/stack/compose.yaml:ro
      - ./.env:/stack/.env:ro
      - ./secrets:/stack/secrets:ro
      - nas:/nas
    networks: [core]
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 128m
```

et, sous `volumes:` :

```yaml
  # NAS <IP du NAS>, dossier partagé <partage> (NFS, squash total). L'essai de fumée le remplace par un dossier local.
  nas:
    driver: local
    driver_opts:
      type: ${NAS_TYPE:-nfs}
      o: ${NAS_OPTIONS:-addr=<IP du NAS>,nfsvers=4.1,soft,timeo=150,retrans=3}
      device: ${NAS_CHEMIN:-<valeur de la tâche 1>}
```

`<<: *app` apporte `environment: *app-env` : remplacer par la seule liste ci-dessus (le service n'a besoin ni du proxy ni des prompts). Mettre à jour le commentaire d'en-tête du compose et celui du réseau `core`.

- [ ] **Step 3 : Relancer l'essai**

Run: `infra/image/essai.sh essai`
Expected: `Essai de fumée réussi.`

- [ ] **Step 4 : Commit** avec la ligne de `CHANGELOG.md`, rubrique Ajouté : « Service `sauvegarde` dans la stack, volume NFS vers le NAS (`NAS_TYPE`, `NAS_OPTIONS`, `NAS_CHEMIN` facultatifs) ; l'essai de fumée fait une sauvegarde complète dans un dossier local (2026-10-23). »

---

### Task 5 : Documents de référence et exploitation

**Files:**
- Modify: `docs/decisions.md`, `docs/cahier-des-charges.md`, `CLAUDE.md`, `docs/exploitation.md`, `README.md`, `CHANGELOG.md`

Un seul commit (règle de `CLAUDE.md` : décision, cahier et `CLAUDE.md` ensemble).

- [ ] **Step 1 : `docs/decisions.md`** : ligne 28, après la 27 : « Sauvegarde | Chaque jour après 3 h, vers le NAS `<IP du NAS>` (dossier partagé `<partage>`, `<dossier>`), en NFS. Base, audio (privé compris) et configuration de la stack (secrets compris), sept jours gardés, fichiers inchangés en liens physiques. Sans chiffrement ; L a accepté que ses enregistrements privés y soient copiés en clair. Décidé par djkix le 23 octobre 2026 ». Ligne 11 : « Sauvegarde vers le NAS au lot 2 (décision 28) ».
- [ ] **Step 2 : `docs/cahier-des-charges.md`** : table des décisions (11, nouvelle 28) ; objectif « Confidentialité » : « ne quittent jamais le réseau local et ne partent jamais vers Gemini » ; section Chiffrement : la ligne GPG devient « Sauvegardes : sans chiffrement, sur le NAS du réseau local (décision 28) » ; section Sauvegarde : remplacer « dump PostgreSQL quotidien chiffré GPG vers le NAS (VM N) » par la description de la décision 28 ; tables des services et des volumes (`sauvegarde`, volume `nas`, colonne Sauvegarde : « Quotidienne, NAS ») ; table Supervision (deux lignes : sauvegarde en échec, aucune réussite depuis 36 h, canal Réglages › Alertes techniques) ; limites mémoire (128 Mo pour la sauvegarde, total mis à jour) ; lot 2 : sauvegarde livrée en 1.11.0.
- [ ] **Step 3 : `CLAUDE.md`** : règle 5, ajouter « Une sauvegarde quotidienne, sans chiffrement, va sur le NAS (décision 28). » ; `infra/` dans l'arborescence mentionne `sauvegarde/` ; État du projet : une phrase sur la 1.11.0.
- [ ] **Step 4 : `docs/exploitation.md`** : service `sauvegarde` dans « La stack » ; variables `NAS_*` dans « Variables du `.env` » ; « Sauvegarde et restauration » réécrite : où sont les sauvegardes, lancer à la main (`vm docker compose exec sauvegarde /app/sauvegarder.sh`), lire l'état (`cli veille`, journal), restauration complète (les cinq étapes de la spec, avec les commandes : `stop api worker scheduler` ; `pg_restore --clean --if-exists` depuis le dump monté par un `docker run` du volume `organizer_nas` ; rsync de `audio/` vers `organizer_audio` puis `chown -R 1000:1000` ; reprise de `config/` ; `up -d --wait`) ; « Mettre à jour » : pour la 1.11.0, remplacer le compose, puis lancer une sauvegarde à la main ; un `up -d --wait` en erreur sur `sauvegarde` seul signale le NAS éteint, le reste tourne ; « Publier une version » : passer le paquet `organizer-sauvegarde` en public après sa première publication ; « Dépannage rapide » : NAS éteint, montage perdu.
- [ ] **Step 5 : `README.md`** : section Fonctionnalités, sous Réglages ou à part (« 💾 Sauvegarde ») ; table des services ; « À venir (lot 2) » sans la sauvegarde.
- [ ] **Step 6 : Vérifier la cohérence**

Run: `grep -n "GPG\|Synology\|VM N" docs/cahier-des-charges.md docs/decisions.md CLAUDE.md README.md docs/exploitation.md`
Expected: aucune ligne qui décrive encore une sauvegarde chiffrée ou vers « VM N ».

- [ ] **Step 7 : Commit** avec la ligne de `CHANGELOG.md`, rubrique Modifié : « Décision 28 : sauvegarde quotidienne vers le NAS, sans chiffrement, privé compris ; cahier des charges, `CLAUDE.md`, exploitation (restauration complète) et README à jour (2026-10-23). »

---

### Task 6 : Mise en service et essai de restauration (avec djkix)

Chaque étape touche la production ou le dépôt public : la faire seulement après l'accord de djkix.

- [ ] **Step 1 : Publier 1.11.0** selon « Publier une version » de `docs/exploitation.md` (CHANGELOG, étiquette `v1.11.0`, CI verte, paquet `organizer-sauvegarde` passé en public).
- [ ] **Step 2 : Mettre à jour la stack** selon « Mettre à jour » (copie de la base avant, nouveau compose, `pull`, `up -d --wait`).

Expected: `vm docker compose ps -a` montre `sauvegarde` « running » ; son journal contient `Sauvegarde planifiée chaque jour à 3 h.`

- [ ] **Step 3 : Première sauvegarde à la main**

Run: `vm docker compose exec sauvegarde /app/sauvegarder.sh`
Expected: `Sauvegarde du <jour> réussie.` ; le dossier daté apparaît dans File Station, avec `derniere`.

- [ ] **Step 4 : Essai de restauration**, sur la VM, sans toucher à la production : un `pgvector/pgvector:0.8.0-pg17` jetable sur un réseau jetable reçoit `pg_restore` du dump du NAS ; comparer `SELECT count(*) FROM capture` et `FROM item` avec la production. Copier `audio/` du NAS dans un volume jetable ; comparer nombre de fichiers et taille totale avec `organizer_audio` (`find … -type f | wc -l`, `du -sb`). Supprimer conteneur, réseau et volumes jetables.

Expected: mêmes nombres (à la marge des captures reçues depuis la sauvegarde).

- [ ] **Step 5 : Le lendemain**, vérifier un deuxième dossier daté, un fichier audio ancien au même inode dans les deux (`stat -c %i`), et aucune alerte dans Réglages.
- [ ] **Step 6 : Consigner** le résultat de l'essai dans `docs/exploitation.md` (date, nombres comparés) et `CHANGELOG.md`, puis commit.
