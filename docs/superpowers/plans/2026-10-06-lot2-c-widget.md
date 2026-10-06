# Lot 2-C — Widget Home Assistant silencieux : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sur l'écran d'accueil de L, un widget Home Assistant montre en permanence, sans jamais sonner ni notifier, ses urgences du jour (actions datées du jour, puis 1 à 3 fenêtres qui approchent), cinq lignes au plus, titres courts ; cocher une ligne dans le widget coche l'action dans Organizer.

**Architecture:** Le service `apps/scheduler` (déjà seul à joindre Google) gagne une boucle « widget » : chaque minute, pour chaque compte de `HA_LISTES`, il calcule les lignes voulues (même règle que la vue Aujourd'hui, bornée à 5 et filtrée par compte) et, si elles ont changé ou toutes les 5 minutes, réconcilie une liste « Local To-do » de Home Assistant par l'API REST de HA (`todo.get_items`, `todo.add_item`, `todo.remove_item`), avec un jeton d'accès longue durée en secret Docker. Le scheduler sort par le proxy `sortie` : Squid lui ouvre, en plus de Google, la seule adresse IPv4 privée et le seul port de Home Assistant (`HA_HOTE`), en HTTP `GET`/`POST`. L'application compagnon Android affiche la liste en widget.

**Tech Stack:** API REST de Home Assistant appelée par `fetch` (undici, par le proxy `sortie`), aucune bibliothèque HA ; Zod 4 ; Prisma 6 ; Node 22 ; Vitest 3 avec un faux Home Assistant en `node:http` ; Squid (Alpine) avec un script de démarrage `sh` ; Docker Compose.

**Spec:** `docs/cahier-des-charges.md` (« Le widget d'écran d'accueil », « Vues de l'application », « Types de rappels », « Règles de non-harcèlement », « Réseaux » et tableau des domaines, « Principes de configuration », « Supervision », « Lot 2 »), `docs/decisions.md` (décisions 5, 7, 8, 17, 23, 24), `CLAUDE.md` (règles produit 1 à 7, conventions, dépôt public), `docs/exploitation.md` (« Sortie vers Internet », « Changer un secret », « Supervision », « Mettre à jour », « Publier une version »).

**Suite :** rotation de l'audio, notifications push et canal Android `alarme`, fils, désambiguïsation, sauvegarde : sous-lots ultérieurs du lot 2, hors de ce plan.

## Global Constraints

- Décision 17 : « Widget d'accueil : Home Assistant, silencieux, surface principale de rappel, livré au lot 2 ». Règle de non-harcèlement 6 : « Le widget informe sans interrompre : c'est la seule surface où l'information vient à elle. »
- Décision 5 : « Sollicitations : aucune par défaut, alarme comprise ». Organizer n'écrit que la liste : aucune notification, aucun son, aucune automatisation HA fournie ou suggérée.
- Contenu : celui de la vue Aujourd'hui (« Actions datées du jour, plus 1 à 3 suggestions issues des fenêtres qui approchent »), borné par « Une vue qui dépasse cinq lignes sur l'écran d'accueil … est considérée comme un défaut » : **5 lignes au plus**, titre coupé à 40 caractères, heure murale `HH:MM` devant un rendez-vous `datee`.
- Règle produit 1 et décision 7 : **jamais une pensée** (« Ressortir une pensée : dans l'application seulement, jamais en notification ») ; règle produit 6 : **jamais une capture privée** ; la décision 8 (visibilité des pensées entre comptes) ne concerne pas le widget : celui d'un compte ne montre que **ses** actions.
- Règles produit 3 et 4 : aucun compteur, aucun pourcentage, aucune mention « en retard », aucune couleur d'alerte. On ne pose **jamais** d'échéance (`due_date`, `due_datetime`) sur un élément HA (HA colore une échéance passée).
- Réseaux : le scheduler reste sur `core` et `sortie` ; la seule ouverture nouvelle est Squid → `HA_HOTE` (adresse IPv4 privée `10/8`, `172.16/12` ou `192.168/16`, port explicite), depuis `10.201.2.12` seulement, méthodes `GET` et `POST`, jamais `CONNECT`. L'API et le worker n'obtiennent rien de nouveau. Aucun point d'entrée nouveau dans Organizer.
- Secrets : jeton HA dans le secret Docker `ha_jeton` (`HA_JETON_FILE`), lu par le seul scheduler, jamais journalisé ni cité dans une erreur ; journaux sans titre d'action (comptes, compteurs, statuts HTTP seulement).
- Supervision : alertes à l'administrateur seulement, par la file `alertes` existante et le `Signaleur` du scheduler (une alerte par constat) ; rien à L, jamais ; une panne de HA n'alerte qu'après 30 minutes.
- Idempotence : un tour rejoué sans changement ne fait qu'une lecture (ou rien) ; jamais de doublon dans la liste.
- Base : **aucune migration**. Tests sur la base de test (tunnel `infra/dev/tunnel.sh` ouvert). Aucun `migrate reset`.
- TypeScript strict, aucun `any` implicite ; toute réponse de HA est validée par Zod avant usage. Aucune dépendance npm nouvelle.
- Tests : aucun appel à un vrai Home Assistant ; un faux HA (`apps/scheduler/test/faux-ha.ts`). L'essai de fumée éprouve la vraie sortie par Squid vers un faux HA `busybox httpd`.
- Les détails de l'API HA marqués « à vérifier » dans ce plan ne sont pas vérifiés sur l'instance du homelab (aucun accès pendant la rédaction) : la tâche 7 les vérifie avant la mise en service.
- Dépôt public : aucun secret, aucun prénom réel (comptes de test `l`, `f`, `essai` ; « L » dans la documentation), aucune adresse électronique réelle, aucune capture réelle ; l'adresse de HA et les noms réels des comptes ne vont que dans le `.env` de la VM.
- Chaque commit met à jour `CHANGELOG.md` (rubrique sous « Non publié »), dans le même commit. Sujet en français, 3e personne (« Ajoute… », « Branche… »), puis exactement `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` en second `-m`. Rien n'est poussé sans l'accord de Franck.
- La CI reste verte : `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e Playwright, budget du bundle, construction des cinq images, Trivy, essai de fumée.

## Review Focus

1. **Minuit sans aucun changement en base** : à 00:01, le widget passe aux rendez-vous du nouveau jour sans attendre une capture (l'empreinte inclut le jour). Tests : tâche 2 (« le jour suit l'heure de Paris »), tâche 5 (« minuit »).
2. **Home Assistant arrêté des heures (mise à jour, VM 100 redémarrée), puis de retour** : aucune alerte avant 30 minutes, une seule ensuite, aucune rafale de requêtes (un essai par minute), la liste revient sans doublon. Test : tâche 5 (« injoignable »).
3. **Deux lignes au même titre** (« appeler le garage » deux fois dans la journée) et L en coche une dans le widget : une seule action cochée dans Organizer. Test : tâche 4.
4. **Un élément ajouté à la main par L (ou Franck) dans la liste HA**, coché ou non, même s'il porte le titre d'une ligne : jamais retiré, jamais pris pour un cochage. Test : tâche 4.
5. **Cloisonnement** : une pensée, une capture privée, une action faite ou archivée, une action du compte de Franck n'apparaissent jamais dans la liste de L ; chaque compte a sa liste. Tests : tâche 2, tâche 5 (« chaque compte sa liste »).

## Arbitrages du plan

Points que les décisions et le cahier ne tranchent pas, arrêtés ici (à rouvrir avec Franck si besoin) :

- **Pousser vers HA plutôt que laisser HA tirer.** Comparé :
  - *HA tire* un JSON signé exposé par Organizer (capteur REST ou `command_line`) : demande un point d'entrée nouveau, lisible depuis le réseau local (et publié par le Nginx Proxy Manager si le chemin passe par `/api`), un secret de plus côté API (le conteneur exposé à Internet), et surtout une automatisation HA en Jinja qui recopie le capteur dans une liste et pousse les cochages par un `rest_command` vers un second point d'entrée en écriture : logique hors du dépôt, intestable ici, fragile à chaque mise à jour de HA.
  - *Organizer pousse* par l'API REST de HA avec un jeton longue durée : aucune surface entrante nouvelle, toute la logique en TypeScript testée contre un faux HA, une seule règle Squid étroite (une adresse privée, un port, `GET`/`POST`, depuis le seul scheduler). Coût : le jeton HA n'est pas restreint à une entité (HA n'offre pas de jeton à portée limitée) ; il vit dans le seul conteneur qui n'est pas exposé à Internet, et l'utilisateur HA qui le porte est non administrateur.
  Retenu : **Organizer pousse**.
- **Le scheduler, pas l'API.** Le cahier dessinait `API → HA`. Le widget n'est pas un message vers L (il ne sonne pas) : la règle « l'API est le seul point d'envoi de messages vers L » ne s'applique pas. Le scheduler a déjà une sortie contrôlée, une boucle périodique et le `Signaleur` ; l'API, exposée à Internet, ne reçoit pas le jeton HA. Le cahier est corrigé en tâche 1.
- **HTTP sur le réseau local, vers `IP:port`.** HA écoute en HTTP sur `8123` ; le jeton passe en clair entre la VM 105 et la VM 100, sur le réseau local seulement (risque accepté et documenté ; si HA est déjà servi en HTTPS sur le réseau local, voir question ouverte 1). Le port et l'adresse sont dans le `.env` (`HA_HOTE`), jamais dans le dépôt ; Squid les reçoit par un script de démarrage qui les vérifie (IPv4 privée, port 1–65535) et les reporte dans `squid.conf` (racine en lecture seule : configuration effective dans `/tmp`).
- **Une liste par compte, dédiée.** `HA_LISTES=<compte>=todo.<liste>,…`. Le compte est le `nom` d'un utilisateur Organizer. Une liste de Franck est facultative (il peut ne pas l'inscrire).
- **Organizer est la source, HA un miroir.** Chaque élément qu'Organizer écrit porte la description `Organizer` ; Organizer ne retire, ne réordonne et ne lit que ces éléments. Un élément sans cette marque (ajouté à la main) n'est jamais touché. Pas d'échéance HA, pas de lien vers l'item.
- **Cocher dans le widget coche dans Organizer** (sens unique HA → Organizer, limité au cochage). Laisser L cocher puis défaire son geste au tour suivant serait une divergence muette et une perte de confiance ; l'ignorer laisserait une ligne cochée dans HA et ouverte dans l'application. Le cochage HA est donc pris : l'élément marqué et coché coche l'action de **même titre** parmi les lignes voulues (une seule, en cas de titres égaux), comme un cochage dans la PWA (`fait_le`, Google Agenda prévenu après 15 s), puis l'élément est retiré de HA. Rien d'autre n'est lu de HA : un titre renommé ou un élément supprimé dans HA est simplement réécrit au tour suivant. Si l'action n'est plus parmi les lignes (déjà faite, modifiée entre-temps), l'élément coché est retiré sans rien cocher. Un cochage dans le widget se défait dans la PWA (décocher).
- **Rafraîchissement** : un tour par minute ; pour chaque compte, les lignes et leur empreinte (jour + lignes) sont recalculées en base, sans appel à HA ; HA n'est lu que si l'empreinte a changé ou si la dernière lecture date de 5 minutes ou plus (ce qui ramasse les cochages du widget et répare une liste modifiée dans HA). Aucun signal ajouté dans l'API ni le worker : une capture apparaît dans le widget au plus une minute après son classement.
- **Réconciliation** : si les éléments marqués ouverts ne sont pas exactement les lignes voulues, dans l'ordre, ils sont tous retirés puis les lignes réécrites dans l'ordre (cinq au plus : simple et sûr ; l'ordre de la liste suit l'ordre d'ajout, à vérifier). Une panne au milieu est réparée au tour suivant.
- **Pannes** : HA injoignable ou 5xx : un essai par minute, alerte « injoignable » après 30 minutes continues, une seule par épisode ; jeton refusé (401/403), liste absente (404), réponse inattendue (autre 4xx ou forme illisible), compte inconnu : une alerte par constat, levée au premier succès. Base indisponible : journal seulement (déjà couverte par la supervision existante).
- **Configuration obligatoire en production** : `HA_HOTE`, `HA_LISTES` dans le `.env`, secret `ha_jeton`. Hors production, sans `HA_URL`, le widget ne démarre pas ; sans Google non plus, le scheduler s'arrête proprement (code 0) : `pnpm dev` reste utilisable sans HA.
- **Retour arrière de 1.4.0 à 1.3.0** : aucune migration ; la liste HA reste figée telle quelle (Franck peut la vider à la main) ; les variables et le secret en trop sont ignorés par l'ancien compose.

## Détails de Home Assistant à vérifier

Supposés d'après la documentation publique de HA (2024–2025), non vérifiés sur l'instance du homelab. La tâche 7, étape 3, les vérifie un par un avant la mise en service ; un écart se corrige dans `apps/scheduler/src/widget/ha.ts` et `apps/scheduler/test/faux-ha.ts`, rien d'autre.

| # | Supposé | Si c'est faux |
| --- | --- | --- |
| H1 | `POST /api/services/todo/get_items?return_response` avec `{"entity_id", "status": ["needs_action","completed"]}` répond `{"changed_states": […], "service_response": {"todo.x": {"items": [{"uid","summary","status","description"?}]}}}` (HA 2024.8 ou plus) | Mettre HA à jour ; sinon lire par l'API WebSocket (`todo/item/list`), hors de ce plan |
| H2 | `todo.add_item` accepte `description` sur une liste « Local To-do » | Marquer par une mémoire des `uid` écrits (Valkey), voir question ouverte 6 |
| H3 | `todo.remove_item` accepte une liste d'`uid` dans `item` | Un appel par élément |
| H4 | `GET /api/states/todo.x` répond 404 si l'entité n'existe pas ; 401 si le jeton est mauvais | Adapter le classement des erreurs |
| H5 | Un nouvel élément s'ajoute en fin de liste, et le widget montre l'ordre de la liste | Accepter l'ordre de HA, ou réordonner par `todo/item/move` (WebSocket) |
| H6 | L'application compagnon Android (2025 ou plus) a un widget « Liste de tâches » (To-do list) qui montre le titre seul (pas la description), permet de cocher, et ne notifie rien | Si la description est affichée : question ouverte 6 ; si on ne peut pas cocher : rien à changer côté Organizer |
| H7 | Le jeton longue durée d'un utilisateur **non administrateur** peut appeler les services `todo` | Utiliser un utilisateur administrateur dédié (documenter le risque) |
| H8 | Le widget ne montre ni compteur ni couleur pour une liste sans échéances | Choisir le réglage du widget qui les masque ; sinon question pour L |

## Questions ouvertes pour Franck

1. Adresse IPv4 et port de Home Assistant sur le réseau local (VM 100), et HA est-il servi seulement en HTTP `:8123` (plan) ou aussi en HTTPS local ?
2. Version de Home Assistant installée (il faut au moins 2024.8, à vérifier), et `ip_ban_enabled` est-il actif dans `configuration.yaml` ?
3. L a-t-elle déjà l'application compagnon Home Assistant et un compte HA à elle sur son téléphone ?
4. Cocher dans le widget coche l'action dans Organizer (plan), ou widget en lecture seule ?
5. Veux-tu ta propre liste (`todo.organizer_f`) pour essayer d'abord sur ton téléphone (plan : oui, en tâche 7) ?
6. Si le widget affiche la description « Organizer » sous chaque ligne (H6) : marquer autrement (mémoire des `uid` dans Valkey), ou accepter ?

---

## Structure des fichiers

```
docs/cahier-des-charges.md, CLAUDE.md                 lot 2-C, widget précisé (tâche 1)
apps/scheduler/src/widget/lignes.ts                   lignesWidget, LigneWidget, LIGNES_WIDGET_MAX, TITRE_WIDGET_MAX
apps/scheduler/src/widget/ha.ts                       ClientHa, ElementHa, MARQUE_ORGANIZER, ErreurHa et sous-classes
apps/scheduler/src/widget/reconcilier.ts              reconcilier, cocherDepuisWidget, DepsReconciliation, Bilan
apps/scheduler/src/widget/boucle.ts                   Widget, demarrerWidget, MESSAGES_WIDGET, délais
apps/scheduler/src/configuration.ts                   + lireConfigWidget, ConfigWidget, ListeWidget
apps/scheduler/src/main.ts                            agenda et widget chacun facultatif hors production
apps/scheduler/src/sonde.ts                           + sonde widget
apps/scheduler/test/faux-ha.ts                        faux Home Assistant (REST, domaine todo)
apps/scheduler/test/aides.ts                          actionDatee : + fin, fait, archive
apps/scheduler/test/lignes.test.ts, ha.test.ts, reconcilier.test.ts, widget.test.ts, configuration.test.ts
infra/sortie/squid.conf, infra/sortie/demarrer.sh     règle Home Assistant, adresse reportée au démarrage
infra/image/Dockerfile, infra/docker-compose.yml, infra/.env.example, infra/image/essai.sh
infra/test/compose.test.ts, image.test.ts, sortie.test.ts, exploitation.test.ts
docs/exploitation.md, CHANGELOG.md
```

---

### Task 1: Cadrage du lot 2-C dans le cahier

**Files:**
- Modify: `docs/cahier-des-charges.md` (Architecture cible, Rôle de chaque composant, Le widget d'écran d'accueil, Services, Réseaux, Principes de configuration, Trajectoire de livraison), `CLAUDE.md` (État du projet), `CHANGELOG.md`

**Interfaces:**
- Consumes: rien.
- Produces: le périmètre du lot 2-C et le tableau « Le widget, tel que livré », cités par les tâches suivantes. Aucune décision nouvelle : la décision 17 est appliquée, pas modifiée ; `docs/decisions.md` ne change pas.

- [ ] **Step 1: Vérifier la cohérence de départ**

Run: `grep -n "Home Assistant\|widget\|Widget\|API --> HA\|Lot 2-A\|scheduler" docs/cahier-des-charges.md CLAUDE.md docs/decisions.md`
Expected: décision 17 identique dans `docs/decisions.md` et le cahier ; la phrase « Une liste `todo` HA est alimentée par l'API via webhook, et le widget natif l'affiche. » ; la ligne `API --> HA[Home Assistant<br/>widget silencieux]` ; « La rotation de l'audio, le widget, les notifications push et le reste du lot suivent. ». Aucune contradiction avec les décisions 5, 7, 8, 17 ; sinon s'arrêter et la signaler à Franck.

- [ ] **Step 2: Préciser le widget dans `docs/cahier-des-charges.md`**

1. Section « Le widget d'écran d'accueil », point 1 : remplacer « Une liste `todo` HA est alimentée par l'API via webhook, et le widget natif l'affiche. » par :
```markdown
Une liste « Local To-do » de HA par compte est tenue à jour par le scheduler, par l'API REST de HA, et le widget « liste de tâches » de l'application compagnon l'affiche.
```
2. Après la phrase « L'option 1 est retenue au lot 2, puisque le widget devient la seule surface de rappel ; les options 2 et 3 restent des replis. », ajouter :
```markdown
Le widget, tel que livré au lot 2-C (version 1.4.0) :

| Élément | Choix |
| --- | --- |
| Contenu | Celui de la vue Aujourd'hui pour ce compte : actions datées du jour, puis 1 à 3 fenêtres qui approchent. **5 lignes au plus** |
| Ligne | Heure murale (`09:30`) devant un rendez-vous daté, puis le texte de l'action, coupé à 40 caractères |
| Jamais | Une pensée, une capture privée, l'action d'un autre compte, un compteur, un pourcentage, « en retard », une échéance HA (que HA colore quand elle est passée) |
| Silence | Organizer n'écrit que la liste : aucune notification, aucun son. Aucune automatisation HA ne s'y branche |
| Par compte | Une liste par compte (`HA_LISTES`) ; le widget de L ne montre que ses actions |
| Cocher | Cocher une ligne dans le widget coche l'action dans Organizer, comme dans l'application (Google Agenda suit). Rien d'autre n'est lu de HA : renommer, supprimer ou ajouter dans la liste ne change rien dans Organizer |
| Éléments ajoutés à la main | Jamais touchés : Organizer ne gère que les éléments qu'il a marqués (description « Organizer ») |
| Rafraîchissement | Chaque minute si les lignes ont changé (minuit compris), lecture complète toutes les 5 minutes. Rien n'est écrit quand tout est à jour |
| Panne de HA | Le widget reste figé ; rattrapage automatique au retour ; alerte à l'administrateur après 30 minutes, jamais à L |
| Accès | Le scheduler joint HA en HTTP sur le réseau local, par le proxy sortant, avec un jeton d'accès longue durée (secret Docker `ha_jeton`). Aucun point d'entrée nouveau dans Organizer |
```
3. Diagramme de « Architecture cible » : remplacer `  API --> HA[Home Assistant<br/>widget silencieux]` par `  SCH --> HA[Home Assistant<br/>widget silencieux]`.
4. Tableau « Rôle de chaque composant », ligne Scheduler : `| Scheduler | Échéances, écriture dans Google Agenda, liste du widget Home Assistant | Haute |`.

- [ ] **Step 3: Réseaux, services et configuration**

1. Tableau « Services », ligne `scheduler`, colonne Dépendances : « `db`, `queue`, API Google Agenda et OAuth, Home Assistant (réseau local) ».
2. Tableau des domaines autorisés, ligne `scheduler` :
```markdown
| `scheduler` | `www.googleapis.com`, `oauth2.googleapis.com` ; Home Assistant sur le réseau local (`HA_HOTE` : adresse IPv4 privée et port, HTTP `GET` et `POST` seulement) | Écriture dans Google Agenda, rafraîchissement du jeton OAuth ; liste du widget |
```
3. Après « L'API est le seul point d'envoi de messages vers L : … », ajouter la phrase : « Le widget n'est pas un message : c'est une liste que L consulte, sans notification ; le scheduler l'écrit. »
4. « Cloisonnement des données sensibles », point 2 : « Trois conteneurs sortent, chacun vers une liste fermée. Le `worker` vers l'API Gemini, le `scheduler` vers l'API Google Agenda, son serveur OAuth et, sur le réseau local seulement, Home Assistant, l'`api` vers Telegram et FCM. La base et la file sont isolées. »
5. « Principes de configuration », point 1 : terminer la liste des secrets par « …, la clé de chiffrement des jetons de l'agenda et le jeton d'accès Home Assistant. »
6. « Trajectoire de livraison », paragraphe « Le lot 2 est livré en sous-lots » : remplacer « La rotation de l'audio, le widget, les notifications push et le reste du lot suivent. » par « **Lot 2-C** (version 1.4.0) : widget Home Assistant silencieux, tenu par le scheduler. La rotation de l'audio, les notifications push et le reste du lot suivent. »

- [ ] **Step 4: Mettre à jour `CLAUDE.md`**

Dans « État du projet », après le paragraphe du lot 2-A, ajouter :
```markdown
Lot 2-C : widget Home Assistant silencieux (décision 17), une liste « Local To-do » par compte tenue par le scheduler, en version 1.4.0.
Plan : `docs/superpowers/plans/2026-10-06-lot2-c-widget.md`.
```

- [ ] **Step 5: Vérifier et commiter**

Run: `grep -n "API --> HA\|alimentée par l'API via webhook\|lot 2-C\|Lot 2-C" docs/cahier-des-charges.md CLAUDE.md`
Expected: plus aucune ligne `API --> HA` ni « via webhook » ; « Lot 2-C » présent dans le cahier et `CLAUDE.md`.

`CHANGELOG.md`, sous « ## [Non publié] », rubrique « ### Modifié » (la créer si absente) :
```markdown
- Le cahier précise le widget Home Assistant du lot 2-C : contenu de la vue Aujourd'hui borné à 5 lignes, liste par compte tenue par le scheduler, cochage repris dans Organizer, sortie vers Home Assistant sur le réseau local (2026-10-06).
```
```bash
git add docs/cahier-des-charges.md CLAUDE.md CHANGELOG.md
git commit -m "Précise le widget Home Assistant et cadre le lot 2-C" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Lignes du widget

**Files:**
- Create: `apps/scheduler/src/widget/lignes.ts`, `apps/scheduler/test/lignes.test.ts`
- Modify: `apps/scheduler/test/aides.ts` (`actionDatee` : options `fin`, `fait`, `archive`), `CHANGELOG.md`

**Interfaces:**
- Consumes: `@organizer/shared` (`ajouterJours`, `debutJour`, `isoLocal`, `jourLocal`, `titreCourt`) ; `@organizer/db` (`PrismaClient`, `Prisma`).
- Produces:
  - `interface LigneWidget { itemId: string; titre: string }`
  - `lignesWidget(prisma: PrismaClient, utilisateurId: string, maintenant: Date, fuseau: string): Promise<{ jour: string; lignes: LigneWidget[] }>`
  - `LIGNES_WIDGET_MAX = 5`, `SUGGESTIONS_WIDGET_MAX = 3`, `TITRE_WIDGET_MAX = 40`

- [ ] **Step 1: Étendre l'aide de test**

Dans `apps/scheduler/test/aides.ts`, remplacer `actionDatee` par :
```ts
/** Action fabriquée d'une capture Telegram ordinaire ; par défaut un rendez-vous daté le 14 octobre à 10:00. */
export async function actionDatee(
  prisma: PrismaClient, uid: string,
  o: {
    texte?: string; date?: string | null; type?: string; alarme?: boolean; nature?: 'action' | 'pensee'; prive?: boolean;
    /** Fin d'une fenêtre (échéance `fenetre`). */ fin?: string; fait?: boolean; archive?: boolean;
  } = {},
): Promise<string> {
  const c = await prisma.capture.create({
    data: { utilisateurId: uid, canal: 'telegram', prive: o.prive ?? false, etat: 'classee', emisLe: MAINTENANT, texteEcrit: 'x' },
  });
  const it = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: o.texte ?? 'dentiste', nature: o.nature ?? 'action',
      confiance: { nature: 0.9, echeance: 0.9, theme: 0.9 }, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
      archiveLe: o.archive ? MAINTENANT : null,
      action: {
        create: {
          echeanceType: o.type ?? 'datee', alarme: o.alarme ?? false,
          echeanceDate: o.date === null ? null : new Date(o.date ?? '2026-10-14T08:00:00Z'),
          fenetreFin: o.fin ? new Date(o.fin) : null,
          faitLe: o.fait ? MAINTENANT : null,
        },
      },
    },
  });
  return it.id;
}
```
Les appels existants (sans les nouvelles options) gardent leur comportement.

- [ ] **Step 2: Écrire le test**

`apps/scheduler/test/lignes.test.ts` (`MAINTENANT` = samedi 10 octobre 2026, 10:00 à Paris) :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LIGNES_WIDGET_MAX, lignesWidget } from '../src/widget/lignes.js';
import { actionDatee, MAINTENANT } from './aides.js';

const prisma = creerPrisma();
afterAll(async () => { await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); });

const PARIS = 'Europe/Paris';
const compte = async (nom = 'l'): Promise<string> => (await prisma.utilisateur.create({ data: { nom } })).id;
const titres = async (uid: string, t = MAINTENANT): Promise<string[]> =>
  (await lignesWidget(prisma, uid, t, PARIS)).lignes.map((l) => l.titre);

describe('lignesWidget', () => {
  it('actions datées du jour par heure, heure murale devant un rendez-vous, rien devant un jour', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'garage', date: '2026-10-10T12:00:00Z' });
    await actionDatee(prisma, uid, { texte: 'dentiste', date: '2026-10-10T07:30:00Z' });
    await actionDatee(prisma, uid, { texte: 'pain', type: 'jour', date: '2026-10-09T22:00:00Z' });
    expect(await titres(uid)).toEqual(['pain', '09:30 dentiste', '14:00 garage']);
  });

  it('puis les fenêtres qui approchent, cinq lignes au plus', async () => {
    const uid = await compte();
    for (const h of ['06', '07', '08']) await actionDatee(prisma, uid, { texte: `rdv ${h}`, date: `2026-10-10T${h}:00:00Z` });
    for (const j of ['12', '13', '14', '15']) {
      await actionDatee(prisma, uid, { texte: `fenêtre ${j}`, type: 'fenetre', date: null, fin: `2026-10-${j}T22:00:00Z` });
    }
    expect(await titres(uid)).toEqual(['08:00 rdv 06', '09:00 rdv 07', '10:00 rdv 08', 'fenêtre 12', 'fenêtre 13']);
  });

  it('sept rendez-vous : les cinq premiers, aucune fenêtre', async () => {
    const uid = await compte();
    for (let h = 6; h < 13; h++) {
      await actionDatee(prisma, uid, { texte: `rdv ${h}`, date: `2026-10-10T${String(h).padStart(2, '0')}:00:00Z` });
    }
    await actionDatee(prisma, uid, { texte: 'fenêtre', type: 'fenetre', date: null, fin: '2026-10-12T22:00:00Z' });
    const t = await titres(uid);
    expect(t).toHaveLength(LIGNES_WIDGET_MAX);
    expect(t.at(-1)).toBe('12:00 rdv 10');
  });

  it('sans rendez-vous : trois fenêtres au plus, aucune au-delà de 14 jours', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'lointaine', type: 'fenetre', date: null, fin: '2026-10-30T22:00:00Z' });
    await actionDatee(prisma, uid, { texte: 'fenêtre 11', type: 'fenetre', date: null, fin: '2026-10-11T22:00:00Z' });
    expect(await titres(uid)).toEqual(['fenêtre 11']);
    for (const j of ['12', '13', '14']) {
      await actionDatee(prisma, uid, { texte: `fenêtre ${j}`, type: 'fenetre', date: null, fin: `2026-10-${j}T22:00:00Z` });
    }
    expect(await titres(uid)).toEqual(['fenêtre 11', 'fenêtre 12', 'fenêtre 13']);
  });

  it('jamais une pensée, une capture privée, une action faite ou archivée, ni celle d\'un autre compte', async () => {
    const l = await compte('l');
    const f = await compte('f');
    const neuf = '2026-10-10T09:00:00Z';
    await actionDatee(prisma, l, { texte: 'pensée', nature: 'pensee', date: neuf });
    await actionDatee(prisma, l, { texte: 'privée', prive: true, date: neuf });
    await actionDatee(prisma, l, { texte: 'faite', fait: true, date: neuf });
    await actionDatee(prisma, l, { texte: 'archivée', archive: true, date: neuf });
    await actionDatee(prisma, l, { texte: 'demain', date: '2026-10-11T09:00:00Z' });
    await actionDatee(prisma, f, { texte: 'celle de f', date: neuf });
    await actionDatee(prisma, l, { texte: 'la sienne', date: neuf });
    expect(await titres(l)).toEqual(['11:00 la sienne']);
    expect(await titres(f)).toEqual(['11:00 celle de f']);
  });

  it('titre coupé à 40 caractères sur un mot', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, {
      texte: 'rappeler le plombier pour la fuite sous l\'évier de la cuisine', type: 'jour', date: '2026-10-09T22:00:00Z',
    });
    expect(await titres(uid)).toEqual(['rappeler le plombier pour la fuite…']);
  });

  it('le jour suit l\'heure de Paris : à 00:01, les rendez-vous du lendemain', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'boulangerie', date: '2026-10-11T07:00:00Z' });
    expect(await titres(uid, new Date('2026-10-10T21:59:00Z'))).toEqual([]);
    expect(await lignesWidget(prisma, uid, new Date('2026-10-10T22:01:00Z'), PARIS)).toEqual({
      jour: '2026-10-11', lignes: [{ itemId: expect.any(String), titre: '09:00 boulangerie' }],
    });
  });

  it('changement d\'heure : le 25 octobre, un rendez-vous de 10:00 reste à 10:00', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'marché', date: '2026-10-25T09:00:00Z' });
    expect(await titres(uid, new Date('2026-10-25T06:00:00Z'))).toEqual(['10:00 marché']);
  });
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/lignes.test.ts`
Expected: FAIL, « Cannot find module '../src/widget/lignes.js' ».

- [ ] **Step 4: Écrire le code**

`apps/scheduler/src/widget/lignes.ts` :
```ts
import type { Prisma, PrismaClient } from '@organizer/db';
import { ajouterJours, debutJour, isoLocal, jourLocal, titreCourt } from '@organizer/shared';

/** Cahier, « Restitution » : une vue qui dépasse cinq lignes sur l'écran d'accueil est un défaut. */
export const LIGNES_WIDGET_MAX = 5;
/** Vue Aujourd'hui : 1 à 3 suggestions issues des fenêtres qui approchent. */
export const SUGGESTIONS_WIDGET_MAX = 3;
export const TITRE_WIDGET_MAX = 40;
/** Même horizon que la vue Aujourd'hui de l'API (apps/api/src/vues/vues.service.ts). */
const HORIZON_SUGGESTIONS_JOURS = 14;
const TYPES_DATES = ['datee', 'jour', 'relative'];

export interface LigneWidget { itemId: string; titre: string }

function titre(texte: string, a: { echeanceType: string | null; echeanceDate: Date | null }, fuseau: string): string {
  const court = titreCourt(texte, TITRE_WIDGET_MAX);
  return a.echeanceType === 'datee' && a.echeanceDate ? `${isoLocal(a.echeanceDate, fuseau).slice(11, 16)} ${court}` : court;
}

/**
 * Lignes du widget d'un compte : la règle de la vue Aujourd'hui (actions datées du jour, puis 1 à 3 fenêtres qui
 * approchent), bornée à 5 lignes et limitée aux actions de ce compte. Jamais une pensée ni une capture privée.
 */
export async function lignesWidget(
  prisma: PrismaClient, utilisateurId: string, maintenant: Date, fuseau: string,
): Promise<{ jour: string; lignes: LigneWidget[] }> {
  const jour = jourLocal(maintenant, fuseau);
  const debut = debutJour(jour, fuseau);
  const ouvertes = {
    nature: 'action', archiveLe: null, capture: { is: { utilisateurId, prive: false } },
  } satisfies Prisma.ItemWhereInput;
  const datees = await prisma.item.findMany({
    where: {
      ...ouvertes,
      action: { is: { faitLe: null, echeanceType: { in: TYPES_DATES }, echeanceDate: { gte: debut, lt: debutJour(ajouterJours(jour, 1), fuseau) } } },
    },
    include: { action: true }, orderBy: [{ action: { echeanceDate: 'asc' } }, { id: 'asc' }], take: LIGNES_WIDGET_MAX,
  });
  const place = Math.min(SUGGESTIONS_WIDGET_MAX, LIGNES_WIDGET_MAX - datees.length);
  const fenetres = place > 0
    ? await prisma.item.findMany({
      where: {
        ...ouvertes,
        action: { is: { faitLe: null, echeanceType: 'fenetre', fenetreFin: { gte: debut, lt: debutJour(ajouterJours(jour, HORIZON_SUGGESTIONS_JOURS), fuseau) } } },
      },
      include: { action: true }, orderBy: [{ action: { fenetreFin: 'asc' } }, { id: 'asc' }], take: place,
    })
    : [];
  return {
    jour,
    lignes: [...datees, ...fenetres].map((it) => ({ itemId: it.id, titre: titre(it.texte, it.action!, fuseau) })),
  };
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck`
Expected: PASS (les tests existants du scheduler aussi : `actionDatee` garde ses défauts).

- [ ] **Step 6: Commiter**

`CHANGELOG.md`, « Non publié », « ### Ajouté » :
```markdown
- Les lignes du widget Home Assistant d'un compte : règle de la vue Aujourd'hui bornée à 5 lignes, heure murale devant un rendez-vous, titre de 40 caractères, jamais une pensée, une capture privée ni l'action d'un autre compte ; minuit et changement d'heure testés (2026-10-06).
```
```bash
git add apps/scheduler/src/widget/lignes.ts apps/scheduler/test/lignes.test.ts apps/scheduler/test/aides.ts CHANGELOG.md
git commit -m "Ajoute les lignes du widget Home Assistant" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Client Home Assistant et faux Home Assistant

**Files:**
- Create: `apps/scheduler/src/widget/ha.ts`, `apps/scheduler/test/faux-ha.ts`, `apps/scheduler/test/ha.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `MARQUE_ORGANIZER = 'Organizer'`
  - `interface ElementHa { uid: string; titre: string; fait: boolean; marque: boolean }`
  - `class ClientHa { constructor(base: string, jeton: string, f: typeof fetch); lire(entite: string): Promise<ElementHa[]>; ajouter(entite: string, titre: string): Promise<void>; retirer(entite: string, uids: string[]): Promise<void>; joindre(): Promise<void> }`
  - Erreurs : `ErreurHa` (`statut: number | null`, `null` = injoignable ; 5xx et réseau, à réessayer), `HaJetonRefuse` (401, 403), `HaListeAbsente` (404), `HaIncompatible` (autre 4xx, réponse illisible).
  - Faux HA : `JETON_HA`, `class FauxHa { url; requetes: RequeteHa[]; panne: boolean; demarrer(); arreter(); vider(); liste(entite); ajouterParL(entite, titre); cocherParL(entite, titre); titres(entite): string[]; ecritures(): RequeteHa[]; forcer(motif, statut, corps?) }`

- [ ] **Step 1: Écrire le faux Home Assistant**

`apps/scheduler/test/faux-ha.ts` :
```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const JETON_HA = 'jeton-ha-essai';

export interface ElementStocke { uid: string; summary: string; status: 'needs_action' | 'completed'; description?: string }
export interface RequeteHa { methode: string; chemin: string; autorisation: string | undefined; corps: string }

const lire = (req: IncomingMessage): Promise<string> => new Promise((ok, ko) => {
  const morceaux: Buffer[] = [];
  req.on('data', (m: Buffer) => morceaux.push(m)).on('end', () => ok(Buffer.concat(morceaux).toString('utf8'))).on('error', ko);
});

const json = (res: ServerResponse, statut: number, corps: unknown): void => {
  res.writeHead(statut, { 'content-type': 'application/json' }).end(JSON.stringify(corps));
};

/**
 * Faux Home Assistant : API REST, domaine `todo` d'une liste « Local To-do », en mémoire.
 * Formes de requête et de réponse : celles supposées en H1 à H4 du plan du lot 2-C (à vérifier sur la vraie version).
 */
export class FauxHa {
  url = '';
  readonly requetes: RequeteHa[] = [];
  /** Vrai : chaque connexion est coupée (HA arrêté, VM redémarrée). */
  panne = false;
  private readonly listes = new Map<string, ElementStocke[]>();
  private forces: Array<{ motif: RegExp; statut: number; corps: unknown }> = [];
  private n = 0;
  private serveur?: Server;

  vider(): void {
    this.listes.clear();
    this.requetes.length = 0;
    this.forces = [];
    this.panne = false;
  }

  /** La liste (créée vide si absente) : ce que fait Franck en ajoutant l'intégration « Local To-do ». */
  liste(entite: string): ElementStocke[] {
    const l = this.listes.get(entite) ?? [];
    this.listes.set(entite, l);
    return l;
  }

  /** Élément ajouté à la main dans HA, sans marque. */
  ajouterParL(entite: string, titre: string): void {
    this.liste(entite).push({ uid: `main-${++this.n}`, summary: titre, status: 'needs_action' });
  }

  /** Ce que fait L quand elle coche une ligne dans le widget (le premier élément ouvert de ce titre). */
  cocherParL(entite: string, titre: string): void {
    const e = this.liste(entite).find((x) => x.summary === titre && x.status === 'needs_action');
    if (!e) throw new Error(`élément absent : ${titre}`);
    e.status = 'completed';
  }

  titres(entite: string): string[] {
    return this.liste(entite).map((e) => `${e.status === 'completed' ? '[x] ' : ''}${e.summary}`);
  }

  ecritures(): RequeteHa[] {
    return this.requetes.filter((r) => /todo\/(add_item|remove_item)/.test(r.chemin));
  }

  /** La prochaine requête « MÉTHODE /chemin » qui correspond reçoit ce statut et ce corps. */
  forcer(motif: RegExp, statut: number, corps: unknown = { message: 'forcé' }): void {
    this.forces.push({ motif, statut, corps });
  }

  async demarrer(): Promise<void> {
    this.serveur = createServer((req, res) => {
      this.traiter(req, res).catch(() => json(res, 500, { message: 'erreur du faux HA' }));
    });
    await new Promise<void>((ok) => this.serveur!.listen(0, '127.0.0.1', ok));
    this.url = `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
  }

  async arreter(): Promise<void> {
    this.serveur?.closeAllConnections();
    await new Promise<void>((ok) => this.serveur?.close(() => ok()) ?? ok());
  }

  private async traiter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.panne) {
      req.socket.destroy();
      return;
    }
    const corps = await lire(req);
    const chemin = req.url ?? '/';
    this.requetes.push({ methode: req.method ?? '', chemin, autorisation: req.headers.authorization, corps });
    const i = this.forces.findIndex((f) => f.motif.test(`${req.method} ${chemin}`));
    if (i >= 0) {
      const [f] = this.forces.splice(i, 1);
      json(res, f!.statut, f!.corps);
      return;
    }
    if (req.headers.authorization !== `Bearer ${JETON_HA}`) {
      json(res, 401, { message: 'Unauthorized' });
      return;
    }
    if (req.method === 'GET' && chemin === '/api/') {
      json(res, 200, { message: 'API running.' });
      return;
    }
    const etat = /^\/api\/states\/(todo\.[a-z0-9_]+)$/.exec(chemin);
    if (req.method === 'GET' && etat) {
      const l = this.listes.get(etat[1]!);
      if (l) json(res, 200, { entity_id: etat[1], state: String(l.filter((e) => e.status === 'needs_action').length) });
      else json(res, 404, { message: 'Entity not found.' });
      return;
    }
    const service = /^\/api\/services\/todo\/(get_items|add_item|remove_item)(\?return_response)?$/.exec(chemin);
    if (req.method !== 'POST' || !service) {
      json(res, 404, { message: 'Not found' });
      return;
    }
    const c = JSON.parse(corps || '{}') as { entity_id?: string; item?: string | string[]; description?: string; status?: string[] };
    const l = c.entity_id ? this.listes.get(c.entity_id) : undefined;
    if (!l) {
      json(res, 400, { message: 'Entity not found' });
      return;
    }
    if (service[1] === 'get_items') {
      if (!service[2]) {
        json(res, 400, { message: 'Service call requires responses but caller did not ask for responses' });
        return;
      }
      const statuts = c.status ?? ['needs_action'];
      json(res, 200, { changed_states: [], service_response: { [c.entity_id!]: { items: l.filter((e) => statuts.includes(e.status)).map((e) => ({ ...e })) } } });
      return;
    }
    if (service[1] === 'add_item') {
      if (typeof c.item !== 'string' || c.item.length === 0) {
        json(res, 400, { message: 'item requis' });
        return;
      }
      l.push({ uid: `uid-${++this.n}`, summary: c.item, status: 'needs_action', ...(c.description ? { description: c.description } : {}) });
      json(res, 200, []);
      return;
    }
    for (const cible of Array.isArray(c.item) ? c.item : [c.item]) {
      const k = l.findIndex((e) => e.uid === cible || e.summary === cible);
      if (k < 0) {
        json(res, 400, { message: 'Unable to find to-do list item' });
        return;
      }
      l.splice(k, 1);
    }
    json(res, 200, []);
  }
}
```

- [ ] **Step 2: Écrire le test du client**

`apps/scheduler/test/ha.test.ts` :
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClientHa, ErreurHa, HaIncompatible, HaJetonRefuse, HaListeAbsente, MARQUE_ORGANIZER } from '../src/widget/ha.js';
import { FauxHa, JETON_HA } from './faux-ha.js';

const L = 'todo.organizer_l';
let faux: FauxHa;
let ha: ClientHa;
beforeAll(async () => { faux = new FauxHa(); await faux.demarrer(); ha = new ClientHa(`${faux.url}/`, JETON_HA, fetch); });
afterAll(async () => { await faux.arreter(); });
beforeEach(() => { faux.vider(); });

describe('ClientHa', () => {
  it('lit ouverts et cochés, reconnaît la marque, garde les éléments étrangers', async () => {
    faux.liste(L);
    await ha.ajouter(L, '09:30 dentiste');
    faux.ajouterParL(L, 'piles');
    faux.cocherParL(L, 'piles');
    expect(await ha.lire(L)).toEqual([
      { uid: expect.any(String), titre: '09:30 dentiste', fait: false, marque: true },
      { uid: expect.any(String), titre: 'piles', fait: true, marque: false },
    ]);
    const lecture = faux.requetes.find((r) => r.chemin.includes('get_items'))!;
    expect(lecture.chemin).toBe('/api/services/todo/get_items?return_response');
    expect(JSON.parse(lecture.corps)).toEqual({ entity_id: L, status: ['needs_action', 'completed'] });
  });

  it('ajoute avec la marque en description, jamais d\'échéance, jeton en Bearer', async () => {
    faux.liste(L);
    await ha.ajouter(L, 'pain');
    const ajout = faux.requetes.find((r) => r.chemin === '/api/services/todo/add_item')!;
    expect(JSON.parse(ajout.corps)).toEqual({ entity_id: L, item: 'pain', description: MARQUE_ORGANIZER });
    expect(ajout.autorisation).toBe(`Bearer ${JETON_HA}`);
  });

  it('retire plusieurs éléments en un appel ; rien à retirer, aucun appel', async () => {
    faux.liste(L);
    for (const t of ['a', 'b', 'c']) await ha.ajouter(L, t);
    const [a, b] = await ha.lire(L);
    faux.requetes.length = 0;
    await ha.retirer(L, []);
    expect(faux.requetes).toEqual([]);
    await ha.retirer(L, [a!.uid, b!.uid]);
    expect(faux.requetes).toHaveLength(1);
    expect(faux.titres(L)).toEqual(['c']);
  });

  it('joindre : l\'API répond avec ce jeton', async () => {
    await expect(ha.joindre()).resolves.toBeUndefined();
    await expect(new ClientHa(faux.url, 'jeton-faux', fetch).joindre()).rejects.toBeInstanceOf(HaJetonRefuse);
  });

  it('classe les erreurs, sans jamais citer le jeton', async () => {
    faux.liste(L);
    const erreurs: unknown[] = [];
    const attraper = async (p: Promise<unknown>): Promise<unknown> => {
      const e = await p.then(() => null, (x: unknown) => x);
      erreurs.push(e);
      return e;
    };
    expect(await attraper(new ClientHa(faux.url, 'jeton-faux', fetch).lire(L))).toBeInstanceOf(HaJetonRefuse);
    expect(await attraper(ha.lire('todo.absente'))).toBeInstanceOf(HaListeAbsente);
    faux.forcer(/get_items/, 400);
    expect(await attraper(ha.lire(L))).toBeInstanceOf(HaIncompatible);
    faux.forcer(/get_items/, 200, { autre: 'forme' });
    expect(await attraper(ha.lire(L))).toBeInstanceOf(HaIncompatible);
    faux.forcer(/add_item/, 503);
    const e503 = await attraper(ha.ajouter(L, 'x'));
    expect(e503).toBeInstanceOf(ErreurHa);
    expect(e503).not.toBeInstanceOf(HaIncompatible);
    expect((e503 as ErreurHa).statut).toBe(503);
    faux.panne = true;
    const coupe = await attraper(ha.lire(L));
    expect(coupe).toBeInstanceOf(ErreurHa);
    expect((coupe as ErreurHa).statut).toBeNull();
    for (const e of erreurs) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).not.toContain(JETON_HA);
      expect((e as Error).message).not.toContain('jeton-faux');
    }
  });
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/ha.test.ts`
Expected: FAIL, « Cannot find module '../src/widget/ha.js' ».

- [ ] **Step 4: Écrire le client**

`apps/scheduler/src/widget/ha.ts` :
```ts
import { z } from 'zod';

/** Description posée sur chaque élément écrit par Organizer : le reste de la liste n'est jamais touché. */
export const MARQUE_ORGANIZER = 'Organizer';

export interface ElementHa { uid: string; titre: string; fait: boolean; marque: boolean }

/** Erreur de Home Assistant : statut HTTP, ou null si HA est injoignable. Jamais de corps ni de jeton. */
export class ErreurHa extends Error {
  override name = 'ErreurHa';
  constructor(readonly statut: number | null) {
    super(statut === null ? 'Home Assistant injoignable' : `Home Assistant HTTP ${statut}`);
  }
}
/** 401 ou 403 : jeton faux, révoqué, ou utilisateur sans droit. */
export class HaJetonRefuse extends ErreurHa { override name = 'HaJetonRefuse'; }
/** 404 sur l'entité : la liste n'existe pas (ou plus) dans HA. */
export class HaListeAbsente extends ErreurHa { override name = 'HaListeAbsente'; }
/** Autre 4xx, ou réponse d'une forme inattendue : version de HA ou type de liste à vérifier. */
export class HaIncompatible extends ErreurHa { override name = 'HaIncompatible'; }

// H1 du plan : forme de la réponse d'un appel de service avec ?return_response (à vérifier).
const elementLu = z.object({
  uid: z.string().min(1),
  summary: z.string(),
  status: z.enum(['needs_action', 'completed']),
  description: z.string().nullish(),
});
const reponseElements = z.object({ service_response: z.record(z.string(), z.object({ items: z.array(elementLu) })) });
const DELAI_MS = 10_000;

/** API REST de Home Assistant, domaine `todo`, avec un jeton d'accès longue durée. */
export class ClientHa {
  private readonly base: string;
  constructor(base: string, private readonly jeton: string, private readonly f: typeof fetch) {
    this.base = base.replace(/\/+$/, '');
  }

  private async appeler(methode: 'GET' | 'POST', chemin: string, corps?: unknown): Promise<Response> {
    let r: Response;
    try {
      r = await this.f(`${this.base}${chemin}`, {
        method: methode,
        headers: {
          authorization: `Bearer ${this.jeton}`, accept: 'application/json',
          ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        signal: AbortSignal.timeout(DELAI_MS),
      });
    } catch {
      throw new ErreurHa(null);
    }
    if (r.ok) return r;
    await r.body?.cancel();
    if (r.status === 401 || r.status === 403) throw new HaJetonRefuse(r.status);
    if (r.status === 404) throw new HaListeAbsente(404);
    if (r.status >= 400 && r.status < 500) throw new HaIncompatible(r.status);
    throw new ErreurHa(r.status);
  }

  private async service(nom: 'add_item' | 'remove_item', corps: unknown): Promise<void> {
    const r = await this.appeler('POST', `/api/services/todo/${nom}`, corps);
    await r.body?.cancel();
  }

  /** Sonde : GET /api/ répond avec un jeton valide. */
  async joindre(): Promise<void> {
    const r = await this.appeler('GET', '/api/');
    await r.body?.cancel();
  }

  /** Tous les éléments de la liste, ouverts et cochés. 404 sur l'état de l'entité : la liste n'existe pas (H4). */
  async lire(entite: string): Promise<ElementHa[]> {
    const etat = await this.appeler('GET', `/api/states/${encodeURIComponent(entite)}`);
    await etat.body?.cancel();
    const r = await this.appeler('POST', '/api/services/todo/get_items?return_response', {
      entity_id: entite, status: ['needs_action', 'completed'],
    });
    const lu = reponseElements.safeParse(await r.json().catch(() => null));
    if (!lu.success) throw new HaIncompatible(r.status);
    const elements = lu.data.service_response[entite]?.items;
    if (!elements) throw new HaListeAbsente(r.status);
    return elements.map((e) => ({ uid: e.uid, titre: e.summary, fait: e.status === 'completed', marque: e.description === MARQUE_ORGANIZER }));
  }

  /** Ajoute en fin de liste (H5), avec la marque ; jamais d'échéance (HA colore une échéance passée). */
  async ajouter(entite: string, titre: string): Promise<void> {
    await this.service('add_item', { entity_id: entite, item: titre, description: MARQUE_ORGANIZER });
  }

  /** Retire par uid, en un appel (H3). */
  async retirer(entite: string, uids: string[]): Promise<void> {
    if (uids.length === 0) return;
    await this.service('remove_item', { entity_id: entite, item: uids });
  }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm vitest run apps/scheduler/test/ha.test.ts && pnpm --filter @organizer/scheduler typecheck`
Expected: PASS.

- [ ] **Step 6: Commiter**

`CHANGELOG.md`, « Non publié », « ### Ajouté » :
```markdown
- Le client Home Assistant du scheduler, sans bibliothèque : lecture d'une liste « Local To-do » (ouverts et cochés), ajout marqué « Organizer » sans échéance, retrait groupé, erreurs classées (jeton refusé, liste absente, réponse inattendue, injoignable) sans jeton ni contenu ; faux Home Assistant pour les tests (2026-10-06).
```
```bash
git add apps/scheduler/src/widget/ha.ts apps/scheduler/test/faux-ha.ts apps/scheduler/test/ha.test.ts CHANGELOG.md
git commit -m "Ajoute le client Home Assistant et son faux serveur" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Réconcilier une liste et reprendre les cochages du widget

**Files:**
- Create: `apps/scheduler/src/widget/reconcilier.ts`, `apps/scheduler/test/reconcilier.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `lignesWidget`, `LigneWidget` (tâche 2) ; `ClientHa`, `ElementHa`, `MARQUE_ORGANIZER` (tâche 3) ; `DELAI_SYNCHRO_COCHAGE_MS` de `@organizer/shared` (15 000).
- Produces:
  - `interface DepsReconciliation { prisma: PrismaClient; ha: Pick<ClientHa, 'lire' | 'ajouter' | 'retirer'>; maintenant(): Date; enfilerSynchro(itemId: string, delaiMs: number): Promise<void> }`
  - `interface Bilan { coches: number; retires: number; ajoutes: number }`
  - `reconcilier(entite: string, utilisateurId: string, lignes: LigneWidget[], d: DepsReconciliation): Promise<Bilan>`
  - `cocherDepuisWidget(itemId: string, utilisateurId: string, d: DepsReconciliation): Promise<boolean>`

- [ ] **Step 1: Écrire le test**

`apps/scheduler/test/reconcilier.test.ts` (`MAINTENANT` = 10 octobre 2026, 10:00 à Paris) :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { DELAI_SYNCHRO_COCHAGE_MS } from '@organizer/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClientHa, MARQUE_ORGANIZER } from '../src/widget/ha.js';
import { lignesWidget } from '../src/widget/lignes.js';
import { cocherDepuisWidget, reconcilier, type DepsReconciliation } from '../src/widget/reconcilier.js';
import { actionDatee, MAINTENANT } from './aides.js';
import { FauxHa, JETON_HA } from './faux-ha.js';

const prisma = creerPrisma();
const LISTE = 'todo.organizer_l';
let faux: FauxHa;
let synchros: Array<[string, number]>;
beforeAll(async () => { faux = new FauxHa(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.vider(); faux.liste(LISTE); synchros = []; });

const deps = (o: Partial<DepsReconciliation> = {}): DepsReconciliation => ({
  prisma, ha: new ClientHa(faux.url, JETON_HA, fetch), maintenant: () => MAINTENANT,
  enfilerSynchro: async (itemId, delaiMs) => { synchros.push([itemId, delaiMs]); },
  ...o,
});
const compte = async (nom = 'l'): Promise<string> => (await prisma.utilisateur.create({ data: { nom } })).id;
const lignes = async (uid: string) => (await lignesWidget(prisma, uid, MAINTENANT, 'Europe/Paris')).lignes;
const tour = async (uid: string, d = deps()) => reconcilier(LISTE, uid, await lignes(uid), d);
const faitLe = async (itemId: string) => (await prisma.action.findUniqueOrThrow({ where: { itemId } })).faitLe;

describe('reconcilier', () => {
  it('remplit une liste vide dans l\'ordre, avec la marque ; rejouée, n\'écrit rien', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'garage', date: '2026-10-10T12:00:00Z' });
    await actionDatee(prisma, uid, { texte: 'dentiste', date: '2026-10-10T07:30:00Z' });
    expect(await tour(uid)).toEqual({ coches: 0, retires: 0, ajoutes: 2 });
    expect(faux.titres(LISTE)).toEqual(['09:30 dentiste', '14:00 garage']);
    expect(faux.liste(LISTE).every((e) => e.description === MARQUE_ORGANIZER)).toBe(true);
    faux.requetes.length = 0;
    expect(await tour(uid)).toEqual({ coches: 0, retires: 0, ajoutes: 0 });
    expect(faux.ecritures()).toEqual([]);
  });

  it('une ligne change : la liste est refaite dans le nouvel ordre ; l\'élément ajouté à la main reste', async () => {
    const uid = await compte();
    const garage = await actionDatee(prisma, uid, { texte: 'garage', date: '2026-10-10T12:00:00Z' });
    await actionDatee(prisma, uid, { texte: 'dentiste', date: '2026-10-10T07:30:00Z' });
    await tour(uid);
    faux.ajouterParL(LISTE, 'acheter des piles');
    await prisma.action.update({ where: { itemId: garage }, data: { echeanceDate: new Date('2026-10-10T06:00:00Z') } });
    expect(await tour(uid)).toEqual({ coches: 0, retires: 2, ajoutes: 2 });
    expect(faux.titres(LISTE)).toEqual(['acheter des piles', '08:00 garage', '09:30 dentiste']);
  });

  it('L coche dans le widget : action faite, agenda prévenu après 15 s, élément retiré', async () => {
    const uid = await compte();
    const dentiste = await actionDatee(prisma, uid, { texte: 'dentiste', date: '2026-10-10T07:30:00Z' });
    await actionDatee(prisma, uid, { texte: 'garage', date: '2026-10-10T12:00:00Z' });
    await tour(uid);
    faux.cocherParL(LISTE, '09:30 dentiste');
    expect(await tour(uid)).toEqual({ coches: 1, retires: 1, ajoutes: 0 });
    expect(await faitLe(dentiste)).toEqual(MAINTENANT);
    expect(synchros).toEqual([[dentiste, DELAI_SYNCHRO_COCHAGE_MS]]);
    expect(faux.titres(LISTE)).toEqual(['14:00 garage']);
  });

  it('deux lignes au même titre : un seul cochage', async () => {
    const uid = await compte();
    const a = await actionDatee(prisma, uid, { texte: 'appeler le garage', type: 'jour', date: '2026-10-09T22:00:00Z' });
    const b = await actionDatee(prisma, uid, { texte: 'appeler le garage', type: 'jour', date: '2026-10-09T22:00:00Z' });
    await tour(uid);
    faux.cocherParL(LISTE, 'appeler le garage');
    expect((await tour(uid)).coches).toBe(1);
    expect(await prisma.action.count({ where: { itemId: { in: [a, b] }, faitLe: { not: null } } })).toBe(1);
    expect(faux.titres(LISTE)).toEqual(['appeler le garage']);
  });

  it('un élément sans la marque n\'est jamais retiré ni pris pour un cochage, même au même titre', async () => {
    const uid = await compte();
    const pain = await actionDatee(prisma, uid, { texte: 'pain', type: 'jour', date: '2026-10-09T22:00:00Z' });
    faux.ajouterParL(LISTE, 'pain');
    faux.cocherParL(LISTE, 'pain');
    faux.ajouterParL(LISTE, 'ampoules');
    await tour(uid);
    await tour(uid);
    expect(faux.titres(LISTE)).toEqual(['[x] pain', 'ampoules', 'pain']);
    expect(await faitLe(pain)).toBeNull();
  });

  it('coché dans le widget mais déjà fait dans la PWA : retiré, rien d\'autre', async () => {
    const uid = await compte();
    const pain = await actionDatee(prisma, uid, { texte: 'pain', type: 'jour', date: '2026-10-09T22:00:00Z' });
    await tour(uid);
    faux.cocherParL(LISTE, 'pain');
    const avant = new Date('2026-10-10T07:00:00Z');
    await prisma.action.update({ where: { itemId: pain }, data: { faitLe: avant } });
    expect(await tour(uid)).toEqual({ coches: 0, retires: 1, ajoutes: 0 });
    expect(faux.titres(LISTE)).toEqual([]);
    expect(await faitLe(pain)).toEqual(avant);
    expect(synchros).toEqual([]);
  });

  it('l\'agenda injoignable ne défait pas le cochage', async () => {
    const uid = await compte();
    const pain = await actionDatee(prisma, uid, { texte: 'pain', type: 'jour', date: '2026-10-09T22:00:00Z' });
    await tour(uid);
    faux.cocherParL(LISTE, 'pain');
    const d = deps({ enfilerSynchro: async () => { throw new Error('Valkey'); } });
    expect((await tour(uid, d)).coches).toBe(1);
    expect(await faitLe(pain)).toEqual(MAINTENANT);
  });

  it('cocherDepuisWidget refuse l\'action d\'un autre compte', async () => {
    const l = await compte('l');
    const f = await compte('f');
    const celleDeF = await actionDatee(prisma, f, { texte: 'garage', date: '2026-10-10T12:00:00Z' });
    expect(await cocherDepuisWidget(celleDeF, l, deps())).toBe(false);
    expect(await faitLe(celleDeF)).toBeNull();
    expect(synchros).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/reconcilier.test.ts`
Expected: FAIL, « Cannot find module '../src/widget/reconcilier.js' ».

- [ ] **Step 3: Écrire le code**

`apps/scheduler/src/widget/reconcilier.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { DELAI_SYNCHRO_COCHAGE_MS } from '@organizer/shared';
import type { ClientHa } from './ha.js';
import type { LigneWidget } from './lignes.js';

export interface DepsReconciliation {
  prisma: PrismaClient;
  ha: Pick<ClientHa, 'lire' | 'ajouter' | 'retirer'>;
  maintenant(): Date;
  /** Prévient Google Agenda (file `agenda`) ; sans agenda configuré, ne fait rien. */
  enfilerSynchro(itemId: string, delaiMs: number): Promise<void>;
}

export interface Bilan { coches: number; retires: number; ajoutes: number }

/**
 * Cochage venu du widget : le même effet qu'un cochage dans la PWA (fait_le, agenda prévenu après 15 s).
 * Seulement une action ouverte, non archivée, d'une capture ordinaire de ce compte. Vrai si elle a été cochée ici.
 */
export async function cocherDepuisWidget(itemId: string, utilisateurId: string, d: DepsReconciliation): Promise<boolean> {
  const r = await d.prisma.action.updateMany({
    where: {
      itemId, faitLe: null,
      item: { is: { nature: 'action', archiveLe: null, capture: { is: { utilisateurId, prive: false } } } },
    },
    data: { faitLe: d.maintenant() },
  });
  if (r.count === 0) return false;
  try {
    await d.enfilerSynchro(itemId, DELAI_SYNCHRO_COCHAGE_MS);
  } catch (e) {
    console.error(`Widget : agenda non prévenu (${(e as Error).name}), le balayage rattrapera`);
  }
  return true;
}

/**
 * Met la liste Home Assistant d'un compte au niveau de ses lignes. Organizer est la source : seuls les éléments
 * marqués sont lus ou touchés. Un élément marqué et coché coche l'action de même titre parmi les lignes (une seule),
 * puis est retiré. Si les éléments marqués ouverts ne sont pas exactement les lignes, dans l'ordre, ils sont retirés
 * et les lignes réécrites. Idempotente : rejouée sans changement, elle ne fait que lire.
 */
export async function reconcilier(entite: string, utilisateurId: string, lignes: LigneWidget[], d: DepsReconciliation): Promise<Bilan> {
  const nos = (await d.ha.lire(entite)).filter((e) => e.marque);
  const restantes = [...lignes];
  const faits = nos.filter((e) => e.fait);
  let coches = 0;
  for (const e of faits) {
    const i = restantes.findIndex((l) => l.titre === e.titre);
    if (i < 0) continue;
    const [ligne] = restantes.splice(i, 1);
    if (await cocherDepuisWidget(ligne!.itemId, utilisateurId, d)) coches += 1;
  }
  const ouverts = nos.filter((e) => !e.fait);
  const aJour = ouverts.length === restantes.length && ouverts.every((e, i) => e.titre === restantes[i]!.titre);
  const aRetirer = [...faits, ...(aJour ? [] : ouverts)].map((e) => e.uid);
  await d.ha.retirer(entite, aRetirer);
  if (!aJour) for (const l of restantes) await d.ha.ajouter(entite, l.titre);
  return { coches, retires: aRetirer.length, ajoutes: aJour ? 0 : restantes.length };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run apps/scheduler/test/reconcilier.test.ts && pnpm --filter @organizer/scheduler typecheck`
Expected: PASS.

- [ ] **Step 5: Commiter**

`CHANGELOG.md`, « Non publié », « ### Ajouté » :
```markdown
- La réconciliation d'une liste Home Assistant : Organizer est la source, seuls ses éléments marqués sont touchés, liste refaite dans l'ordre quand elle diffère, rien d'écrit quand tout est à jour ; cocher dans le widget coche l'action dans Organizer (une seule en cas de titres égaux, agenda prévenu après 15 s), un élément ajouté à la main n'est jamais retiré (2026-10-06).
```
```bash
git add apps/scheduler/src/widget/reconcilier.ts apps/scheduler/test/reconcilier.test.ts CHANGELOG.md
git commit -m "Ajoute la réconciliation de la liste du widget" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Boucle du widget, configuration, alertes et démarrage du scheduler

**Files:**
- Create: `apps/scheduler/src/widget/boucle.ts`, `apps/scheduler/test/widget.test.ts`
- Modify: `apps/scheduler/src/configuration.ts`, `apps/scheduler/test/configuration.test.ts`, `apps/scheduler/src/main.ts`, `apps/scheduler/src/sonde.ts`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `lignesWidget` (tâche 2) ; `ClientHa`, `ErreurHa`, `HaJetonRefuse`, `HaListeAbsente`, `HaIncompatible` (tâche 3) ; `reconcilier`, `DepsReconciliation` (tâche 4) ; `Signaleur` de `apps/scheduler/src/file.ts` (`une(cle, message)`, `retablir(cle)`) ; `enfilerSynchro(file, itemId, delaiMs)` de `@organizer/shared`.
- Produces:
  - `interface ListeWidget { compte: string; entite: string }`, `interface ConfigWidget { base: string; jeton: string; listes: ListeWidget[] }`, `lireConfigWidget(env?): ConfigWidget | null`
  - `MESSAGES_WIDGET` (repris dans `docs/exploitation.md`, tâche 6), `TOUR_MS = 60_000`, `LECTURE_COMPLETE_MS = 300_000`, `INJOIGNABLE_ALERTE_MS = 1_800_000`
  - `class Widget { constructor(d: DepsWidget); tour(): Promise<void> }` avec `interface DepsWidget extends DepsReconciliation { listes: ListeWidget[]; signaleur: Pick<Signaleur, 'une' | 'retablir'> }`
  - `demarrerWidget(widget: Pick<Widget, 'tour'>, tourMs?: number): { arreter(): Promise<void> }`
  - Journal du scheduler : « Widget Home Assistant démarré. » (repris par l'essai de fumée, tâche 6) ; `sonde.mjs widget`.

- [ ] **Step 1: Écrire les tests de configuration**

Dans `apps/scheduler/test/configuration.test.ts`, importer `lireConfigWidget` à côté de `lireConfigScheduler` et ajouter à la fin du fichier :
```ts
describe('lireConfigWidget', () => {
  const jeton = fichier('ha_jeton', 'jeton-ha-essai\n');
  const ha = { HA_URL: 'http://192.168.1.50:8123/', HA_LISTES: 'l=todo.organizer_l, f=todo.organizer_f', HA_JETON_FILE: jeton };

  it('lit l\'adresse sans barre finale, le jeton du secret, une liste par compte', () => {
    expect(lireConfigWidget({ ...ha, NODE_ENV: 'production' })).toEqual({
      base: 'http://192.168.1.50:8123', jeton: 'jeton-ha-essai',
      listes: [{ compte: 'l', entite: 'todo.organizer_l' }, { compte: 'f', entite: 'todo.organizer_f' }],
    });
  });

  it('hors production, sans HA_URL : rien (pas de widget en développement)', () => {
    expect(lireConfigWidget({})).toBeNull();
  });

  it('en production, sans HA_URL : refus explicite', () => {
    expect(() => lireConfigWidget({ NODE_ENV: 'production' })).toThrow('HA_URL');
  });

  it.each(['l', 'l=light.salon', 'l=todo.a=b', '=todo.a', 'l=todo.a,l=todo.b', ' , '])('HA_LISTES illisible : %s', (listes) => {
    expect(() => lireConfigWidget({ ...ha, HA_LISTES: listes })).toThrow('HA_LISTES');
  });

  it('HA_URL avec un chemin : refus ; aucun message ne cite le jeton', () => {
    expect(() => lireConfigWidget({ ...ha, HA_URL: 'http://192.168.1.50:8123/api' })).toThrow('sans chemin');
    try {
      lireConfigWidget({ ...ha, HA_LISTES: 'x' });
    } catch (e) {
      expect((e as Error).message).not.toContain('jeton-ha-essai');
    }
  });
});
```

- [ ] **Step 2: Écrire les tests de la boucle**

`apps/scheduler/test/widget.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Signaleur } from '../src/file.js';
import { demarrerWidget, MESSAGES_WIDGET, Widget } from '../src/widget/boucle.js';
import { ClientHa } from '../src/widget/ha.js';
import { actionDatee } from './aides.js';
import { FauxHa, JETON_HA } from './faux-ha.js';

const prisma = creerPrisma();
const L = 'todo.organizer_l';
const MIN = 60_000;
let faux: FauxHa;
let t: Date;
let alertes: string[];
beforeAll(async () => { faux = new FauxHa(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.vider(); t = new Date('2026-10-10T08:00:00Z'); alertes = []; });

const avancer = (ms: number): void => { t = new Date(t.getTime() + ms); };
const compte = async (nom = 'l'): Promise<string> => (await prisma.utilisateur.create({ data: { nom } })).id;
function widget(listes = [{ compte: 'l', entite: L }], jeton = JETON_HA): Widget {
  return new Widget({
    prisma, ha: new ClientHa(faux.url, jeton, fetch), listes, maintenant: () => t,
    signaleur: new Signaleur(async (m) => { alertes.push(m); }), enfilerSynchro: async () => {},
  });
}

describe('Widget', () => {
  it('inchangé : rien vers Home Assistant pendant 5 minutes, puis une lecture sans écriture', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'dentiste', date: '2026-10-10T09:00:00Z' });
    faux.liste(L);
    const w = widget();
    await w.tour();
    expect(faux.titres(L)).toEqual(['11:00 dentiste']);
    faux.requetes.length = 0;
    avancer(MIN);
    await w.tour();
    expect(faux.requetes).toEqual([]);
    avancer(4 * MIN);
    await w.tour();
    expect(faux.requetes.map((r) => r.chemin)).toEqual([`/api/states/${L}`, '/api/services/todo/get_items?return_response']);
  });

  it('une nouvelle action apparaît au tour suivant', async () => {
    const uid = await compte();
    faux.liste(L);
    const w = widget();
    await w.tour();
    await actionDatee(prisma, uid, { texte: 'garage', date: '2026-10-10T12:00:00Z' });
    avancer(MIN);
    await w.tour();
    expect(faux.titres(L)).toEqual(['14:00 garage']);
  });

  it('minuit : les lignes du nouveau jour, sans aucun changement en base', async () => {
    t = new Date('2026-10-10T21:58:00Z');
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'boulangerie', date: '2026-10-11T07:00:00Z' });
    faux.liste(L);
    const w = widget();
    await w.tour();
    expect(faux.titres(L)).toEqual([]);
    avancer(3 * MIN);
    await w.tour();
    expect(faux.titres(L)).toEqual(['09:00 boulangerie']);
  });

  it('cochage dans le widget : pris à la lecture complète suivante', async () => {
    const uid = await compte();
    const dentiste = await actionDatee(prisma, uid, { texte: 'dentiste', date: '2026-10-10T09:00:00Z' });
    await actionDatee(prisma, uid, { texte: 'garage', date: '2026-10-10T12:00:00Z' });
    faux.liste(L);
    const w = widget();
    await w.tour();
    faux.cocherParL(L, '11:00 dentiste');
    avancer(MIN);
    await w.tour();
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: dentiste } })).faitLe).toBeNull();
    avancer(4 * MIN);
    await w.tour();
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: dentiste } })).faitLe).toEqual(t);
    expect(faux.titres(L)).toEqual(['14:00 garage']);
  });

  it('Home Assistant injoignable : une alerte après 30 minutes, une seule, puis la liste revient sans doublon', async () => {
    const uid = await compte();
    await actionDatee(prisma, uid, { texte: 'dentiste', date: '2026-10-10T09:00:00Z' });
    faux.liste(L);
    const w = widget();
    await w.tour();
    faux.panne = true;
    avancer(5 * MIN);
    await w.tour();
    avancer(29 * MIN);
    await w.tour();
    expect(alertes).toEqual([]);
    avancer(2 * MIN);
    await w.tour();
    avancer(MIN);
    await w.tour();
    expect(alertes).toEqual([MESSAGES_WIDGET.injoignable]);
    faux.panne = false;
    avancer(MIN);
    await w.tour();
    expect(faux.titres(L)).toEqual(['11:00 dentiste']);
    faux.panne = true;
    avancer(MIN);
    await w.tour();
    avancer(31 * MIN);
    await w.tour();
    expect(alertes).toEqual([MESSAGES_WIDGET.injoignable, MESSAGES_WIDGET.injoignable]);
  });

  it('jeton refusé : une seule alerte sur deux tours', async () => {
    await compte();
    faux.liste(L);
    const w = widget(undefined, 'jeton-faux');
    await w.tour();
    avancer(MIN);
    await w.tour();
    expect(alertes).toEqual([MESSAGES_WIDGET.jeton]);
  });

  it('liste absente, compte inconnu : une alerte chacun, pas deux', async () => {
    await compte('l');
    const w = widget([{ compte: 'l', entite: L }, { compte: 'personne', entite: 'todo.personne' }]);
    await w.tour();
    avancer(MIN);
    await w.tour();
    expect(alertes.sort()).toEqual([MESSAGES_WIDGET.compte('personne'), MESSAGES_WIDGET.liste('l', L)].sort());
  });

  it('chaque compte sa liste', async () => {
    const l = await compte('l');
    const f = await compte('f');
    await actionDatee(prisma, l, { texte: 'dentiste', date: '2026-10-10T09:00:00Z' });
    await actionDatee(prisma, f, { texte: 'vidange', date: '2026-10-10T10:00:00Z' });
    faux.liste(L);
    faux.liste('todo.organizer_f');
    await widget([{ compte: 'l', entite: L }, { compte: 'f', entite: 'todo.organizer_f' }]).tour();
    expect(faux.titres(L)).toEqual(['11:00 dentiste']);
    expect(faux.titres('todo.organizer_f')).toEqual(['12:00 vidange']);
  });
});

describe('demarrerWidget', () => {
  it('enchaîne les tours sans chevauchement et s\'arrête proprement', async () => {
    const tour = vi.fn(async () => { await new Promise((ok) => setTimeout(ok, 2)); });
    const boucle = demarrerWidget({ tour }, 5);
    await new Promise((ok) => setTimeout(ok, 60));
    await boucle.arreter();
    const n = tour.mock.calls.length;
    expect(n).toBeGreaterThanOrEqual(2);
    await new Promise((ok) => setTimeout(ok, 30));
    expect(tour.mock.calls.length).toBe(n);
  });
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/widget.test.ts apps/scheduler/test/configuration.test.ts`
Expected: FAIL, « Cannot find module '../src/widget/boucle.js' » et `lireConfigWidget` absent.

- [ ] **Step 4: Écrire la configuration**

À la fin de `apps/scheduler/src/configuration.ts` :
```ts
export interface ListeWidget { compte: string; entite: string }
export interface ConfigWidget { base: string; jeton: string; listes: ListeWidget[] }

const ENTITE_TODO = /^todo\.[a-z0-9_]+$/;
const LISTES_ILLISIBLES = 'HA_LISTES illisible : « compte=todo.liste », séparés par des virgules';

/**
 * Widget Home Assistant (lot 2-C). Hors production, sans HA_URL : null, le widget ne démarre pas.
 * En production : HA_URL, HA_LISTES et le jeton (HA_JETON_FILE) sont exigés. Aucun message ne cite une valeur.
 */
export function lireConfigWidget(env: NodeJS.ProcessEnv = process.env): ConfigWidget | null {
  if (!lireVar('HA_URL', env) && env.NODE_ENV !== 'production') return null;
  const base = exigerVar('HA_URL', env).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s]+$/.test(base)) throw new Error('HA_URL attend http://<adresse>:<port>, sans chemin');
  const listes = exigerVar('HA_LISTES', env).split(',').map((p) => p.trim()).filter((p) => p.length > 0).map((p) => {
    const [compte, entite, ...reste] = p.split('=').map((x) => x.trim());
    if (!compte || !entite || reste.length > 0 || !ENTITE_TODO.test(entite)) throw new Error(LISTES_ILLISIBLES);
    return { compte, entite };
  });
  if (listes.length === 0) throw new Error(LISTES_ILLISIBLES);
  if (new Set(listes.map((l) => l.compte)).size !== listes.length) throw new Error('HA_LISTES : un compte apparaît deux fois');
  return { base, jeton: exigerVar('HA_JETON', env), listes };
}
```

- [ ] **Step 5: Écrire la boucle**

`apps/scheduler/src/widget/boucle.ts` :
```ts
import { createHash } from 'node:crypto';
import type { ListeWidget } from '../configuration.js';
import type { Signaleur } from '../file.js';
import { ErreurHa, HaIncompatible, HaJetonRefuse, HaListeAbsente } from './ha.js';
import { lignesWidget } from './lignes.js';
import { reconcilier, type DepsReconciliation } from './reconcilier.js';

/** Alertes à l'administrateur (jamais à L) ; reprises dans docs/exploitation.md. Ni jeton, ni titre. */
export const MESSAGES_WIDGET = {
  jeton: 'Widget Home Assistant : jeton refusé. Remplacer secrets/ha_jeton.',
  liste: (compte: string, entite: string) => `Widget Home Assistant du compte ${compte} : liste ${entite} introuvable.`,
  compte: (compte: string) => `Widget Home Assistant : compte ${compte} inconnu, voir HA_LISTES.`,
  incompatible: (statut: number) => `Widget Home Assistant : réponse inattendue (HTTP ${statut}). Vérifier la version de Home Assistant.`,
  injoignable: 'Widget Home Assistant injoignable depuis 30 minutes : le widget n\'est plus à jour.',
};

export const TOUR_MS = 60_000;
export const LECTURE_COMPLETE_MS = 5 * 60_000;
export const INJOIGNABLE_ALERTE_MS = 30 * 60_000;

export interface DepsWidget extends DepsReconciliation {
  listes: ListeWidget[];
  signaleur: Pick<Signaleur, 'une' | 'retablir'>;
}

/**
 * Un tour par minute. Pour chaque compte, les lignes sont recalculées en base ; Home Assistant n'est lu que si
 * elles ont changé (jour compris) ou si la dernière lecture a 5 minutes. Un tour ne lève jamais.
 */
export class Widget {
  private readonly empreintes = new Map<string, string>();
  private readonly luLe = new Map<string, number>();
  private premierEchec: number | null = null;
  constructor(private readonly d: DepsWidget) {}

  async tour(): Promise<void> {
    for (const liste of this.d.listes) {
      try {
        await this.un(liste);
      } catch (e) {
        await this.echec(liste, e).catch(() => undefined);
      }
    }
  }

  private async un({ compte, entite }: ListeWidget): Promise<void> {
    const u = await this.d.prisma.utilisateur.findUnique({ where: { nom: compte }, select: { id: true, fuseau: true } });
    if (!u) {
      await this.d.signaleur.une(`widget:compte:${compte}`, MESSAGES_WIDGET.compte(compte));
      return;
    }
    const t = this.d.maintenant().getTime();
    const { jour, lignes } = await lignesWidget(this.d.prisma, u.id, new Date(t), u.fuseau);
    const empreinte = createHash('sha256').update(JSON.stringify([jour, lignes])).digest('hex');
    if (empreinte === this.empreintes.get(compte) && t - (this.luLe.get(compte) ?? 0) < LECTURE_COMPLETE_MS) return;
    const bilan = await reconcilier(entite, u.id, lignes, this.d);
    // Après un cochage, les lignes changent en base : le tour suivant relit.
    this.empreintes.set(compte, bilan.coches > 0 ? '' : empreinte);
    this.luLe.set(compte, t);
    this.premierEchec = null;
    for (const cle of ['widget:jeton', 'widget:incompatible', 'widget:injoignable', `widget:liste:${compte}`]) this.d.signaleur.retablir(cle);
    if (bilan.coches + bilan.retires + bilan.ajoutes > 0) {
      console.log(`Widget ${compte} : ${bilan.coches} cochée(s), ${bilan.retires} retirée(s), ${bilan.ajoutes} ajoutée(s).`);
    }
  }

  private async echec({ compte, entite }: ListeWidget, e: unknown): Promise<void> {
    this.empreintes.delete(compte);
    console.error(`Widget ${compte} : ${e instanceof ErreurHa ? e.message : e instanceof Error ? e.name : 'erreur'}`);
    if (e instanceof HaJetonRefuse) await this.d.signaleur.une('widget:jeton', MESSAGES_WIDGET.jeton);
    else if (e instanceof HaListeAbsente) await this.d.signaleur.une(`widget:liste:${compte}`, MESSAGES_WIDGET.liste(compte, entite));
    else if (e instanceof HaIncompatible) await this.d.signaleur.une('widget:incompatible', MESSAGES_WIDGET.incompatible(e.statut ?? 0));
    else if (e instanceof ErreurHa) {
      const t = this.d.maintenant().getTime();
      this.premierEchec ??= t;
      if (t - this.premierEchec >= INJOIGNABLE_ALERTE_MS) await this.d.signaleur.une('widget:injoignable', MESSAGES_WIDGET.injoignable);
    }
  }
}

/** Enchaîne les tours (jamais deux à la fois) ; arreter() attend la fin du tour en cours. */
export function demarrerWidget(widget: Pick<Widget, 'tour'>, tourMs = TOUR_MS): { arreter(): Promise<void> } {
  let actif = true;
  let minuteur: NodeJS.Timeout | undefined;
  let enCours: Promise<void> = Promise.resolve();
  const boucle = (): void => {
    enCours = widget.tour().catch(() => undefined).finally(() => {
      if (actif) minuteur = setTimeout(boucle, tourMs);
    });
  };
  boucle();
  return {
    async arreter() {
      actif = false;
      clearTimeout(minuteur);
      await enCours;
    },
  };
}
```

- [ ] **Step 6: Lancer les tests de la boucle**

Run: `pnpm vitest run apps/scheduler/test/widget.test.ts apps/scheduler/test/configuration.test.ts`
Expected: PASS.

- [ ] **Step 7: Brancher le démarrage et la sonde**

`apps/scheduler/src/main.ts` devient (agenda inchangé dans son principe, widget à côté, chacun facultatif hors production) :
```ts
import { creerPrisma } from '@organizer/db';
import {
  creerFetchSortant, enfilerSynchro, exigerVar, FILE_AGENDA, FILE_ALERTES, OPTIONS_JOB_AGENDA, OPTIONS_JOB_ALERTE,
  type JobAgenda, type JobAlerte,
} from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { Jetons } from './agenda/jetons.js';
import { lireConfigScheduler, lireConfigWidget } from './configuration.js';
import { alerteurAgenda, demarrerFileAgenda, planifierBalayage, Signaleur } from './file.js';
import { ClientCalendrier } from './google/calendrier.js';
import { ClientOAuth } from './google/oauth.js';
import { demarrerWidget, Widget } from './widget/boucle.js';
import { ClientHa } from './widget/ha.js';

// En production, chacune exige sa configuration (refus explicite) ; hors production, chacune est facultative.
const config = lireConfigScheduler();
const configWidget = lireConfigWidget();
if (!config && !configWidget) {
  console.log('Ni Google Agenda (GOOGLE_CLIENT_ID) ni widget (HA_URL) configurés : scheduler arrêté.');
  process.exit(0);
}

const prisma = creerPrisma();
const connexion = new Redis(config?.redisUrl ?? exigerVar('REDIS_URL'), { maxRetriesPerRequest: null });
const sortant = creerFetchSortant();
const alertes = new Queue<JobAlerte>(FILE_ALERTES, { connection: connexion });
// Alerte à l'administrateur seul, via la file `alertes` que l'API envoie aux comptes administrateurs.
const alerter = async (message: string): Promise<void> => { await alertes.add('alerte', { message }, OPTIONS_JOB_ALERTE); };
const signaleur = new Signaleur(alerter);

let file: Queue<JobAgenda> | undefined;
let worker: Worker<JobAgenda> | undefined;
if (config) {
  const oauth = new ClientOAuth(config.google, sortant);
  const calendrier = new ClientCalendrier(config.google.baseCalendrier, sortant);
  const f = new Queue<JobAgenda>(FILE_AGENDA, { connection: connexion });
  file = f;
  const jetons = new Jetons(prisma, oauth, config.cle, undefined, alerteurAgenda(signaleur, prisma));
  // Une seule instance de scheduler, concurrence 1 : voir demarrerFileAgenda.
  worker = demarrerFileAgenda({
    prisma, oauth, calendrier, jetons, cle: config.cle, connexion, alerter, signaleur,
    enfilerSynchro: (itemId) => enfilerSynchro(f, itemId),
    enfilerBalayage: async (utilisateurId) => { await f.add('balayer', { type: 'balayer', utilisateurId }, OPTIONS_JOB_AGENDA); },
  });
  await planifierBalayage(f);
} else {
  console.log('Google Agenda non configuré (GOOGLE_CLIENT_ID absent).');
}

let widget: { arreter(): Promise<void> } | undefined;
if (configWidget) {
  const ha = new ClientHa(configWidget.base, configWidget.jeton, sortant);
  widget = demarrerWidget(new Widget({
    prisma, ha, listes: configWidget.listes, signaleur, maintenant: () => new Date(),
    enfilerSynchro: async (itemId, delaiMs) => { if (file) await enfilerSynchro(file, itemId, delaiMs); },
  }));
  console.log('Widget Home Assistant démarré.');
} else {
  console.log('Widget Home Assistant non configuré (HA_URL absent).');
}

console.log('Scheduler démarré.');

let arret = false;
async function arreter(): Promise<void> {
  if (arret) return;
  arret = true;
  const fermer = async (f: () => unknown): Promise<void> => {
    try { await f(); } catch (e) { console.error(`Arrêt : fermeture impossible (${(e as Error).name})`); }
  };
  await fermer(() => widget?.arreter());
  await fermer(() => worker?.close());
  await fermer(() => file?.close());
  await fermer(() => alertes.close());
  await fermer(() => prisma.$disconnect());
  await fermer(() => connexion.disconnect());
  process.exit(0);
}
process.on('SIGTERM', () => void arreter());
process.on('SIGINT', () => void arreter());
```

Dans `apps/scheduler/src/sonde.ts`, ajouter les imports `import { lireConfigWidget } from './configuration.js';`, `import { ClientHa } from './widget/ha.js';`, `import { lignesWidget } from './widget/lignes.js';`, puis une branche avant le `else` final, et compléter l'usage :
```ts
} else if (commande === 'widget') {
  // Comptes et compteurs seulement : ni titre, ni jeton.
  const c = lireConfigWidget();
  if (!c) {
    console.log('Widget Home Assistant non configuré.');
  } else {
    const prisma = creerPrisma();
    const ha = new ClientHa(c.base, c.jeton, creerFetchSortant());
    for (const { compte, entite } of c.listes) {
      const u = await prisma.utilisateur.findUnique({ where: { nom: compte } });
      const voulues = u ? `${(await lignesWidget(prisma, u.id, new Date(), u.fuseau)).lignes.length} ligne(s) voulue(s)` : 'compte inconnu';
      try {
        const el = await ha.lire(entite);
        const n = (f: (e: { fait: boolean; marque: boolean }) => boolean): number => el.filter(f).length;
        console.log(`${compte} → ${entite} : ${voulues} ; dans la liste : ${n((e) => e.marque && !e.fait)} ouverte(s), ${n((e) => e.marque && e.fait)} cochée(s), ${n((e) => !e.marque)} autre(s)`);
      } catch (e) {
        console.log(`${compte} → ${entite} : ${voulues} ; ${e instanceof Error ? `${e.name} (${e.message})` : 'erreur'}`);
      }
    }
    await prisma.$disconnect();
  }
} else {
  console.log('Usage : sonde sortie <url> | sonde agenda | sonde widget');
  process.exitCode = 1;
}
```

- [ ] **Step 8: Construire et lancer tous les tests du scheduler**

Run: `pnpm --filter @organizer/scheduler build && pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck && pnpm lint`
Expected: PASS, `paquet.test.ts` compris (`dist/main.mjs` s'arrête toujours sur « Variable manquante » en production sans configuration ; l'usage de la sonde commence toujours par « Usage : sonde sortie <url> »).

Essai à la main, hors production, tunnel ouvert : `HA_URL= GOOGLE_CLIENT_ID= pnpm --filter @organizer/scheduler dev` affiche « Ni Google Agenda (GOOGLE_CLIENT_ID) ni widget (HA_URL) configurés : scheduler arrêté. » et rend la main.

- [ ] **Step 9: Commiter**

`CHANGELOG.md`, « Non publié », « ### Ajouté » :
```markdown
- La boucle du widget dans le scheduler : un tour par minute, Home Assistant lu seulement quand les lignes changent (minuit compris) ou toutes les 5 minutes ; jeton refusé, liste absente, réponse inattendue et compte inconnu alertent l'administrateur une fois, une panne de Home Assistant après 30 minutes ; configuration `HA_URL`, `HA_LISTES`, `HA_JETON_FILE` exigée en production ; Google Agenda et widget chacun facultatif hors production ; sonde `widget` (2026-10-06).
```
```bash
git add apps/scheduler/src/widget/boucle.ts apps/scheduler/src/configuration.ts apps/scheduler/src/main.ts apps/scheduler/src/sonde.ts apps/scheduler/test/widget.test.ts apps/scheduler/test/configuration.test.ts CHANGELOG.md
git commit -m "Branche la boucle du widget Home Assistant dans le scheduler" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sortie vers Home Assistant, stack et exploitation

**Files:**
- Create: `infra/sortie/demarrer.sh`, `infra/test/sortie.test.ts`
- Modify: `infra/sortie/squid.conf`, `infra/image/Dockerfile`, `infra/docker-compose.yml`, `infra/.env.example`, `infra/image/essai.sh`, `infra/test/compose.test.ts`, `infra/test/image.test.ts`, `infra/test/exploitation.test.ts`, `docs/exploitation.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `HA_URL`, `HA_LISTES`, `HA_JETON_FILE`, « Widget Home Assistant démarré. », `MESSAGES_WIDGET`, `sonde.mjs widget` (tâche 5).
- Produces: variables obligatoires `HA_HOTE`, `HA_LISTES` ; secret `ha_jeton` (monté dans le seul scheduler) ; Squid : `depuis_scheduler` vers `HA_HOTE` en `GET`/`POST` ; script de démarrage `demarrer-sortie` de l'image `sortie` ; essai de fumée avec un faux HA ; section « Widget Home Assistant » de `docs/exploitation.md` (gestes de Franck côté HA, repris en tâche 7).

- [ ] **Step 1: Écrire les tests**

1. `infra/test/sortie.test.ts` (nouveau) :
```ts
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = join(import.meta.dirname, '../..');
const bin = mkdtempSync(join(tmpdir(), 'sortie-'));
// Faux squid : affiche la configuration qu'on lui passe par -f.
writeFileSync(join(bin, 'squid'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = -f ]; then cat "$2"; fi; shift; done\n');
chmodSync(join(bin, 'squid'), 0o755);

const demarrer = (hote: string | undefined) => spawnSync('sh', [join(RACINE, 'infra/sortie/demarrer.sh')], {
  env: {
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    SQUID_MODELE: join(RACINE, 'infra/sortie/squid.conf'), SQUID_CONF: join(bin, 'squid.conf'),
    ...(hote === undefined ? {} : { HA_HOTE: hote }),
  },
  encoding: 'utf8',
});

describe('démarrage du proxy sortant', () => {
  it('reporte l\'adresse et le port de Home Assistant, sans laisser de marque', () => {
    const r = demarrer('192.168.1.50:8123');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('acl vers_ha dst 192.168.1.50/32');
    expect(r.stdout).toContain('acl port_ha port 8123');
    expect(r.stdout).not.toContain('@HA_');
  });

  it.each(['10.1.2.3:8123', '172.20.0.5:8123', '192.168.0.9:443'])('accepte une adresse privée : %s', (hote) => {
    expect(demarrer(hote).status).toBe(0);
  });

  it.each([
    undefined, '', '192.168.1.50', '8.8.8.8:8123', '172.32.0.1:8123', '192.168.1.500:8123', '192.168.1.50:0',
    '192.168.1.50:70000', 'ha.local:8123', '192.168.1.50:8123/g;s/x/y', '10.0.0.1:80 10.0.0.2', '192.168.1.50\nacl x:8123',
  ])('refuse HA_HOTE=%j sans démarrer Squid', (hote) => {
    const r = demarrer(hote);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('HA_HOTE invalide');
    expect(r.stdout).toBe('');
  });
});
```
2. `infra/test/image.test.ts`, `describe('squid.conf')`, test « liste fermée… » : renommer en « liste fermée : Telegram pour l'API, Gemini pour le worker, Google et Home Assistant pour le scheduler, refus du reste », ajouter avant `const regles` :
```ts
    expect(s).toContain('acl vers_ha dst @HA_IP@/32');
    expect(s).toContain('acl port_ha port @HA_PORT@');
    expect(s).toContain('acl methodes_ha method GET POST');
```
et la liste attendue devient :
```ts
    expect(regles).toEqual([
      'http_access allow depuis_scheduler vers_ha port_ha methodes_ha',
      'http_access deny !CONNECT',
      'http_access deny !port_https',
      'http_access deny ip_brute',
      'http_access allow depuis_api vers_api',
      'http_access allow depuis_worker vers_worker',
      'http_access allow depuis_scheduler vers_scheduler',
      'http_access deny all',
    ]);
```
Dans le test « cinq cibles, aucune en root », ajouter :
```ts
    expect(cible('sortie')).toContain('COPY --chmod=755 infra/sortie/demarrer.sh /usr/local/bin/demarrer-sortie');
    expect(cible('sortie')).toMatch(/^CMD \["\/usr\/local\/bin\/demarrer-sortie"\]$/m);
```
3. `infra/test/compose.test.ts` : le test des secrets devient « secrets : six fichiers du dossier secrets/, montés seulement là où ils servent », avec `['agenda_cle', 'gemini_api_key', 'google_client_secret', 'ha_jeton', 'telegram_bot_token', 'telegram_webhook_secret']`, `expect(monte('scheduler')).toEqual(['google_client_secret', 'agenda_cle', 'ha_jeton']);` et `HA_JETON_FILE: '/run/secrets/ha_jeton'` dans l'attente sur l'environnement du scheduler. Ajouter :
```ts
  it('widget Home Assistant : une seule adresse pour le scheduler et le proxy, listes obligatoires, rien pour l\'API et le worker', () => {
    expect(service('scheduler').environment).toMatchObject({
      HA_URL: 'http://${HA_HOTE:?}', HA_LISTES: '${HA_LISTES:?}', HA_JETON_FILE: '/run/secrets/ha_jeton',
    });
    expect(service('sortie').environment).toEqual({ HA_HOTE: '${HA_HOTE:?}' });
    for (const n of ['api', 'worker']) {
      expect(service(n).environment, n).not.toHaveProperty('HA_URL');
      expect(service(n).environment, n).not.toHaveProperty('HA_JETON_FILE');
    }
  });
```
4. `infra/test/exploitation.test.ts`, dans « cite chaque commande de la CLI et de la sonde », ajouter `expect(doc).toContain('scheduler node apps/scheduler/dist/sonde.mjs widget');`, puis :
```ts
  it('reprend chaque alerte du widget', async () => {
    const { MESSAGES_WIDGET } = await import('../../apps/scheduler/src/widget/boucle.js');
    expect(doc).toContain(MESSAGES_WIDGET.jeton);
    expect(doc).toContain(MESSAGES_WIDGET.injoignable);
    expect(doc).toContain(MESSAGES_WIDGET.liste('<compte>', '<liste>'));
    expect(doc).toContain(MESSAGES_WIDGET.compte('<compte>'));
    expect(doc).toContain(MESSAGES_WIDGET.incompatible(0).replace('0', 'n'));
  });
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run infra/test`
Expected: FAIL (script absent, règles Squid, secrets, variables, documentation).

- [ ] **Step 3: Squid et son script de démarrage**

`infra/sortie/squid.conf` : en tête, compléter le commentaire par « Exception unique : le scheduler joint Home Assistant en HTTP sur le réseau local (adresse et port de HA_HOTE, reportés au démarrage par demarrer.sh). » ; après `acl vers_scheduler …`, ajouter :
```
# Home Assistant (lot 2-C) : le scheduler seul, en HTTP sur le réseau local, GET et POST seulement, jamais CONNECT.
# @HA_IP@ et @HA_PORT@ sont remplacés au démarrage par infra/sortie/demarrer.sh (HA_HOTE, adresse IPv4 privée vérifiée).
acl vers_ha dst @HA_IP@/32
acl port_ha port @HA_PORT@
acl methodes_ha method GET POST
```
et placer la règle **avant** `http_access deny !CONNECT` :
```
http_access allow depuis_scheduler vers_ha port_ha methodes_ha
http_access deny !CONNECT
```
(les autres règles inchangées, dans le même ordre).

`infra/sortie/demarrer.sh` :
```sh
#!/bin/sh
# Démarrage du proxy sortant : reporte HA_HOTE (adresse IPv4 privée:port de Home Assistant) dans squid.conf.
# Racine en lecture seule : la configuration effective est écrite dans /tmp (tmpfs). Refus explicite sinon.
set -eu
HOTE="${HA_HOTE:-}"
refus() { echo "HA_HOTE invalide : adresse IPv4 privée et port attendus, ex. 192.168.1.50:8123" >&2; exit 1; }
case "$HOTE" in
  '' | *[!0-9.:]*) refus ;;
esac
IP="${HOTE%:*}"
PORT="${HOTE##*:}"
OCTET='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
printf '%s' "$IP" | grep -Eq "^$OCTET(\.$OCTET){3}\$" || refus
printf '%s' "$IP" | grep -Eq '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' || refus
printf '%s' "$PORT" | grep -Eq '^[1-9][0-9]{0,4}$' || refus
[ "$PORT" -le 65535 ] || refus
MODELE="${SQUID_MODELE:-/etc/squid/squid.conf}"
CONF="${SQUID_CONF:-/tmp/squid.conf}"
sed -e "s/@HA_IP@/$IP/g" -e "s/@HA_PORT@/$PORT/g" "$MODELE" > "$CONF"
exec squid -N -d 1 -f "$CONF"
```

`infra/image/Dockerfile`, cible `sortie` : après `COPY infra/sortie/squid.conf /etc/squid/squid.conf`, ajouter `COPY --chmod=755 infra/sortie/demarrer.sh /usr/local/bin/demarrer-sortie`, et remplacer le `CMD` par `CMD ["/usr/local/bin/demarrer-sortie"]`.

- [ ] **Step 4: Compose et `.env.example`**

`infra/docker-compose.yml` :
1. Commentaire de tête : « Le scheduler écrit dans Google Agenda (lot 2-A) et tient la liste du widget Home Assistant (lot 2-C) ; la rotation de l'audio le rejoindra. »
2. Service `scheduler`, à la fin de `environment` :
```yaml
      # Widget Home Assistant (lot 2-C) : une liste « Local To-do » par compte, en HTTP sur le réseau local, par « sortie ».
      HA_URL: http://${HA_HOTE:?}
      HA_LISTES: ${HA_LISTES:?}
      HA_JETON_FILE: /run/secrets/ha_jeton
    secrets: [google_client_secret, agenda_cle, ha_jeton]
```
3. Service `sortie`, après `tmpfs` :
```yaml
    # Adresse IPv4 privée et port de Home Assistant, vérifiés et reportés dans squid.conf au démarrage.
    environment:
      HA_HOTE: ${HA_HOTE:?}
```
4. Bloc `secrets` : ajouter
```yaml
  ha_jeton:
    file: ./secrets/ha_jeton
```
`infra/.env.example`, après `GOOGLE_CLIENT_ID=` :
```
# Widget Home Assistant (lot 2-C) : adresse IPv4 privée et port de Home Assistant sur le réseau local (VM 100).
# Seul le scheduler y accède, en HTTP, par le proxy sortant (GET et POST seulement). Ex. : 192.168.1.50:8123
HA_HOTE=
# Une liste « Local To-do » par compte : <nom du compte Organizer>=<entité todo>, séparés par des virgules.
# Ex. : l=todo.organizer_l,f=todo.organizer_f
HA_LISTES=
```
et, dans le bloc des clés : `#   secrets/ha_jeton                 jeton d'accès longue durée de l'utilisateur Home Assistant « Organizer »`.

- [ ] **Step 5: Essai de fumée**

`infra/image/essai.sh` :
1. Après la création de `agenda_cle` : `printf 'jeton-essai' > "$TRAVAIL/secrets/ha_jeton"`.
2. Le `essai.yaml` devient (faux HA `busybox httpd` sur le réseau `egress` de l'essai, adresse privée fixe) :
```sh
cat > "$TRAVAIL/essai.yaml" <<'EOF'
services:
  sortie:
    volumes:
      - ./squid.conf:/etc/squid/squid.conf:ro
  faux-ha:
    image: busybox:1.37
    command: ["sh", "-c", "mkdir -p /www/api && echo ok > /www/api/index.html && exec httpd -f -p 8123 -h /www"]
    networks:
      egress:
        ipv4_address: 10.212.0.50
networks:
  egress:
    ipam:
      config:
        - subnet: 10.212.0.0/24
EOF
```
3. Dans le `.env` de l'essai : `HA_HOTE=10.212.0.50:8123` et `HA_LISTES=essai=todo.essai`.
4. Après l'attente de « Scheduler démarré », ajouter : `dc logs --no-color scheduler | grep -q 'Widget Home Assistant démarré' || echec "widget non démarré"`.
5. Dans le bloc « Sortie », ajouter :
```sh
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie http://10.212.0.50:8123/api/ | grep -q '^joignable (HTTP 200)' || echec "scheduler : Home Assistant devrait être joignable"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie http://10.212.0.50:8124/ | grep -q '^joignable (HTTP 403)' || echec "Squid : un autre port de Home Assistant est ouvert"
dc exec -T worker node apps/worker/dist/sonde.mjs sortie http://10.212.0.50:8123/api/ | grep -q '^joignable (HTTP 403)' || echec "Squid : Home Assistant ouvert au worker"
dc exec -T scheduler node -e "fetch('http://10.212.0.50:8123/api/',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))" \
  || echec "scheduler : Home Assistant joignable sans le proxy"
```
(un refus de Squid sur une requête HTTP simple est une réponse 403, d'où « joignable (HTTP 403) » ; le port 8124 n'écoute pas, mais Squid refuse avant de s'y connecter).

- [ ] **Step 6: Documentation d'exploitation**

`docs/exploitation.md` :
1. Tableau « Variables du `.env` », ajouter :
```markdown
| `HA_HOTE` | adresse IPv4 privée et port de Home Assistant sur le réseau local (ex. `192.168.1.50:8123`) ; vérifiée au démarrage de `sortie` |
| `HA_LISTES` | une liste « Local To-do » par compte : `<nom du compte>=todo.<liste>`, séparés par des virgules |
```
et dans le paragraphe suivant : « …`GOOGLE_REDIRECT_URI` … pour l'API et le scheduler, `HA_URL` (`http://` + `HA_HOTE`) pour le scheduler. »
2. « Sortie vers Internet » : remplacer le premier tiret par « seul `CONNECT` sur le port 443 est admis, avec une exception : le scheduler joint Home Assistant en HTTP (`GET`, `POST`) à l'adresse et au port de `HA_HOTE`, rien d'autre sur le réseau local ; `infra/sortie/demarrer.sh` refuse de démarrer Squid si `HA_HOTE` n'est pas une adresse IPv4 privée suivie d'un port ; » et compléter la liste du scheduler : « …`oauth2.googleapis.com`, et Home Assistant ».
3. Après la section « Google Agenda », ajouter la section :
```markdown
## Widget Home Assistant

Décision 17. Le scheduler tient à jour, pour chaque compte de `HA_LISTES`, une liste « Local To-do » de Home
Assistant (VM 100) ; l'application compagnon Android l'affiche en widget sur l'écran d'accueil. Contenu : la vue
Aujourd'hui du compte (actions datées du jour, puis 1 à 3 fenêtres qui approchent), 5 lignes au plus, heure devant
un rendez-vous, 40 caractères. Jamais une pensée, une capture privée ni l'action d'un autre compte. Aucune
notification, aucun son : Organizer n'écrit que la liste.

- Rafraîchissement : chaque minute si les lignes ont changé (minuit compris), lecture complète toutes les 5 minutes.
- Cocher une ligne dans le widget coche l'action dans Organizer (Google Agenda suit). Rien d'autre n'est lu :
  renommer ou supprimer dans HA est réécrit au tour suivant. Défaire un cochage : décocher dans la PWA.
- Chaque élément écrit porte la description « Organizer ». Un élément ajouté à la main dans la liste n'est jamais touché.
- Le jeton passe en HTTP sur le réseau local, entre la VM 105 et la VM 100 ; il ne sort jamais du réseau local.
- État : `vm docker compose exec -T scheduler node apps/scheduler/dist/sonde.mjs widget` (comptes et nombres seulement).

Mise en place côté Home Assistant, une fois, par Franck (libellés de HA non vérifiés, l'intention prime) :

1. Version : « Paramètres », « À propos » : Home Assistant 2024.8 ou plus (lecture d'une liste par l'API REST, à vérifier).
2. Une liste par compte : « Paramètres », « Appareils et services », « Ajouter une intégration », « Local To-do »,
   nom « Organizer L ». Relever l'identifiant de l'entité dans « Entités » (attendu `todo.organizer_l`). Même geste
   pour Franck s'il veut la sienne (`todo.organizer_f`). Ne créer **aucune** automatisation ni notification sur ces listes.
3. Utilisateur technique : « Paramètres », « Personnes », « Ajouter une personne » « Organizer », « Autoriser la
   connexion », **non administrateur**, « Connexion uniquement depuis le réseau local » si proposé. Se connecter
   avec lui (fenêtre privée), « Profil », onglet « Sécurité », « Jetons d'accès longue durée », « Créer un jeton »,
   nom `organizer-scheduler`. Le jeton n'est affiché qu'une fois : le ranger aussitôt dans le gestionnaire de mots
   de passe. Limite assumée : HA n'a pas de jeton restreint à une liste ; ce jeton peut appeler tout service. Il ne
   vit que dans `secrets/ha_jeton`, lu par le seul scheduler.
4. Si `ip_ban_enabled` est actif dans `configuration.yaml` (section `http`) : un jeton faux répété peut faire bannir
   l'adresse de la VM 105 ; la retirer de `ip_bans.yaml` et redémarrer HA après correction du jeton.
5. Sur la VM : `ssh -t kix@192.168.1.201 'cd /opt/stacks/organizer && umask 077 && read -rs -p "Jeton Home Assistant : " s && printf "%s" "$s" > secrets/ha_jeton && unset s && echo'` ;
   dans le `.env` : `HA_HOTE=<adresse de la VM 100>:8123`, `HA_LISTES=<compte de L>=todo.organizer_l,<compte de Franck>=todo.organizer_f`
   (noms des comptes Organizer, ceux de la connexion à la PWA).
6. Téléphone : application « Home Assistant » (Play Store), connexion au serveur de la maison avec un compte HA
   **à la personne** (créer une « Personne » non administratrice pour L si besoin). Appui long sur l'écran
   d'accueil, « Widgets », « Home Assistant », widget « Liste de tâches » (à vérifier), choisir sa liste. Si le
   réglage existe, masquer le nombre d'éléments.
7. Vérifier : `sonde.mjs widget` ; une action fabriquée datée d'aujourd'hui apparaît dans le widget en moins de deux minutes.

Débrancher le widget pour tous : supprimer le jeton dans HA (une alerte « jeton refusé », puis plus rien) ; la liste
reste figée. Le reste du scheduler (Google Agenda) continue.
```
4. « Changer un secret », ajouter la ligne :
```markdown
| Jeton Home Assistant | HA, utilisateur « Organizer », « Sécurité », créer un nouveau jeton ; l'écrire dans `secrets/ha_jeton` (sans retour à la ligne) ; `vm docker compose up -d --force-recreate scheduler` ; supprimer l'ancien jeton dans HA |
```
5. « Supervision », après le tableau du scheduler, ajouter :
```markdown
Alertes du widget, vers les mêmes destinataires (jamais vers L) :

| Message | Que faire |
| --- | --- |
| « Widget Home Assistant : jeton refusé. Remplacer secrets/ha_jeton. » | jeton supprimé ou expiré dans HA : voir « Changer un secret » |
| « Widget Home Assistant du compte <compte> : liste <liste> introuvable. » | liste supprimée ou renommée dans HA : la recréer, ou corriger `HA_LISTES` |
| « Widget Home Assistant : compte <compte> inconnu, voir HA_LISTES. » | `HA_LISTES` cite un nom de compte qui n'existe pas dans Organizer |
| « Widget Home Assistant : réponse inattendue (HTTP n). Vérifier la version de Home Assistant. » | HA trop ancien, ou liste qui n'est pas une « Local To-do » : voir « Widget Home Assistant » |
| « Widget Home Assistant injoignable depuis 30 minutes : le widget n'est plus à jour. » | HA arrêté, VM 100 éteinte, `HA_HOTE` faux : `sonde.mjs widget` ; la liste se refait seule au retour |
```

- [ ] **Step 7: Lancer les tests et l'essai de fumée**

Run: `pnpm vitest run infra/test && pnpm lint`
Expected: PASS.

Puis, sur la VM Docker de dev (`infra/dev/`), construire les images et lancer `infra/image/essai.sh essai` comme la CI le fait (`.github/workflows/ci.yml`, job `images`).
Expected: « Essai de fumée réussi. » ; le journal de `sortie` montre les adresses refusées sans chemin d'URL. Puis pousser la branche seulement avec l'accord de Franck pour faire tourner la CI.

- [ ] **Step 8: Commiter**

`CHANGELOG.md`, « Non publié », « ### Ajouté » :
```markdown
- Le widget Home Assistant dans la stack : Squid ouvre au seul scheduler l'adresse privée et le port de Home Assistant (`HA_HOTE`, vérifiés au démarrage de `sortie`), en `GET` et `POST` seulement ; nouvelles variables obligatoires `HA_HOTE` et `HA_LISTES`, nouveau secret `ha_jeton` ; l'essai de fumée éprouve la sortie vers un faux Home Assistant ; l'exploitation documente la mise en place côté Home Assistant, le téléphone de L et les alertes (2026-10-06).
```
```bash
git add infra/sortie/squid.conf infra/sortie/demarrer.sh infra/image/Dockerfile infra/docker-compose.yml infra/.env.example infra/image/essai.sh infra/test/compose.test.ts infra/test/image.test.ts infra/test/sortie.test.ts infra/test/exploitation.test.ts docs/exploitation.md CHANGELOG.md
git commit -m "Ouvre au scheduler la sortie vers Home Assistant et documente le widget" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Publication de la version 1.4.0 et mise en service du widget

Cette tâche se fait **avec Franck**, par le contrôleur. L'étiquette, le push, tout geste dans Home Assistant, sur la VM ou sur un téléphone n'ont lieu qu'avec son accord explicite, donné dans la conversation ; à défaut, s'arrêter après l'étape 2 et lui remettre la procédure. Les libellés de Home Assistant et de l'application compagnon sont **non vérifiés** ; l'intention de chaque geste prime sur le libellé.

**Files:**
- Modify: `CHANGELOG.md` (publication) ; si l'étape 3 révèle un écart : `apps/scheduler/src/widget/ha.ts`, `apps/scheduler/test/faux-ha.ts`

**Interfaces:**
- Consumes: les tâches 1 à 6 fusionnées sur `main` ; `docs/exploitation.md` (« Publier une version », « Mettre à jour », « Revenir à la version précédente », « Widget Home Assistant »).
- Produces: étiquette `v1.4.0`, images `ghcr.io/djkix/organizer-*:1.4.0`, stack `/opt/stacks/organizer` en 1.4.0, listes « Local To-do » et jeton HA, widget sur le téléphone de L.

- [ ] **Step 1: Vérifier la branche entière**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @organizer/web e2e && pnpm --filter @organizer/web budget`
Expected: tout passe. Puis CI verte sur la branche `lot2-c-widget` (jobs `tests` et `images` : cinq images, Trivy, essai de fumée avec le faux Home Assistant). Fusion sur `main` par le skill `superpowers:finishing-a-development-branch`, au choix de Franck.

- [ ] **Step 2: Préparer la publication dans `CHANGELOG.md`**

Sur `main` : renommer « ## [Non publié] » en « ## [1.4.0] - <date du jour> », rouvrir au-dessus une rubrique « ## [Non publié] » vide, y ajouter sous « ### Modifié » : « Le journal publie la version 1.4.0 (<date>). ». Dans la rubrique 1.4.0, ajouter en tête une ligne « Mise à jour » : « Avant `pull` : nouvelles variables `HA_HOTE` et `HA_LISTES`, nouveau secret `ha_jeton`, nouveau compose (voir « Widget Home Assistant » dans `docs/exploitation.md`). »
```bash
git add CHANGELOG.md
git commit -m "Publie la version 1.4.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Franck prépare Home Assistant et vérifie les détails supposés**

Suivre les points 1 à 4 de « Widget Home Assistant » dans `docs/exploitation.md` (version, listes, utilisateur « Organizer » non administrateur et son jeton, `ip_ban_enabled`). Puis, **depuis la VM 105** (même chemin réseau que le scheduler), sans afficher le jeton à l'écran ni le coller dans la conversation :
Remplacer `<adresse de la VM 100>` avant de lancer :
```bash
ssh -t kix@192.168.1.201 'read -rs -p "Jeton Home Assistant : " J; echo; H=<adresse de la VM 100>:8123
  curl -s -o /dev/null -w "api %{http_code}\n" -H "Authorization: Bearer $J" http://$H/api/
  curl -s -o /dev/null -w "etat %{http_code}\n" -H "Authorization: Bearer $J" http://$H/api/states/todo.organizer_l
  curl -s -H "Authorization: Bearer $J" -H "content-type: application/json" -d "{\"entity_id\":\"todo.organizer_l\",\"item\":\"essai organizer\",\"description\":\"Organizer\"}" -o /dev/null -w "ajout %{http_code}\n" http://$H/api/services/todo/add_item
  curl -s -H "Authorization: Bearer $J" -H "content-type: application/json" -d "{\"entity_id\":\"todo.organizer_l\",\"status\":[\"needs_action\",\"completed\"]}" "http://$H/api/services/todo/get_items?return_response"; echo
  unset J'
```
Expected, à cocher dans le tableau « Détails de Home Assistant à vérifier » du plan : `api 200`, `etat 200` (H4) ; `ajout 200` ; la lecture affiche un objet `service_response` → `todo.organizer_l` → `items` avec `uid`, `summary` « essai organizer », `status` `needs_action` et `description` « Organizer » (H1, H2). Retirer l'élément d'essai à la main dans HA. Un écart : corriger `ha.ts` et `faux-ha.ts` (avec leurs tests) sur une branche, nouvelle version de correctif, avant d'aller plus loin.

- [ ] **Step 4: Étiqueter et pousser (Franck, ou avec son accord explicite)**

```bash
git tag -a v1.4.0 -m "Version 1.4.0 : widget Home Assistant silencieux"
git push origin main v1.4.0
```
Expected: CI de l'étiquette verte, job `publication` compris. Aucun paquet nouveau sur GHCR (mêmes cinq images).

- [ ] **Step 5: Mettre à jour la stack sur la VM (Dockge)**

Avec les fonctions `vm` et `cli` de `docs/exploitation.md` (« Gestes depuis le Mac ») :
1. Copie de la base (étape 2 de « Mettre à jour »).
2. Secret `ha_jeton` : point 5 de « Widget Home Assistant » (lecture masquée, fichier 600, propriétaire `kix`).
3. Dans **Dockge**, stack `organizer` : remplacer le compose par `infra/docker-compose.yml` de `v1.4.0` ; dans le `.env`, ajouter `HA_HOTE=<adresse de la VM 100>:8123` et `HA_LISTES=<compte de L>=todo.organizer_l,<compte de Franck>=todo.organizer_f`, passer `ORGANIZER_VERSION=1.4.0` ; « Enregistrer », « Mettre à jour ». Sans ces variables, le compose refuse de démarrer (« required variable HA_HOTE is missing a value »).

Vérifier :
- `vm docker compose ps -a` : `sortie` « running » (sinon `vm docker compose logs sortie` : « HA_HOTE invalide … ») ; `scheduler` « running » ;
- `vm docker compose logs --since 5m scheduler` contient « Widget Home Assistant démarré. » et « Scheduler démarré. » ;
- `vm docker compose exec -T scheduler node apps/scheduler/dist/sonde.mjs widget` : une ligne par compte, sans erreur ;
- `vm docker compose exec -T worker node apps/worker/dist/sonde.mjs sortie http://<adresse de la VM 100>:8123/api/` : « joignable (HTTP 403) » (refus de Squid).

Retour arrière : remettre le compose de la 1.3.0 et `ORGANIZER_VERSION=1.3.0`, « Mettre à jour ». Aucune restauration (aucune migration) ; la liste HA reste figée, à vider à la main.

- [ ] **Step 6: Essai réel, d'abord par Franck sur son propre téléphone**

Énoncés fabriqués seulement.
1. Widget « Liste de tâches » sur `todo.organizer_f` (point 6 de « Widget Home Assistant »).
2. Vocal au bot : « rendez-vous test aujourd'hui à <heure dans 2 heures> » : en moins de deux minutes après « Reçu. », la ligne `HH:MM rendez-vous test` apparaît dans le widget ; **aucune** notification, aucun son.
3. Une pensée dictée (« je me demande si … ») et une capture privée : rien dans le widget.
4. Six actions datées d'aujourd'hui : cinq lignes, pas plus.
5. Cocher une ligne dans le widget : dans les 5 minutes, l'action est cochée dans la PWA et l'élément disparaît du widget ; si l'agenda est connecté, l'événement Google disparaît aussi.
6. Ajouter un élément à la main dans la liste HA : il reste, jamais touché.
7. Cocher dans la PWA : la ligne disparaît du widget en moins de deux minutes.
8. Le widget ne montre ni compteur, ni couleur, ni « en retard » (H6, H8) ; noter ce qu'il montre.
9. Journaux sans contenu ni jeton : `vm docker compose logs --since 1h scheduler sortie | grep -c -i -E 'rendez-vous test|Bearer'` donne `0`.

- [ ] **Step 7: Mise en service pour L, sur son téléphone, avec Franck à côté**

1. Application « Home Assistant » installée et connectée avec le compte HA de L (question ouverte 3) ; widget « Liste de tâches » sur `todo.organizer_l`, placé sur son écran d'accueil principal, lisible d'un coup d'œil.
2. Vérifier avec elle : ses rendez-vous du jour, rien de Franck, aucune notification de l'application HA liée à cette liste (réglages Android de l'application : notifications des listes désactivées si proposées).
3. Lui dire qu'elle peut cocher dans le widget, et que décocher se fait dans l'application.

Noter le résultat (oui ou non par point, modèle de téléphone, version de l'application HA, sans prénom ni contenu) dans la description de la fusion. Le point ouvert « Le widget suffit-il à rappeler les choses sans alarme ni relance ? » (décisions) se juge à l'usage, par L ; rien n'est mesuré ni signalé automatiquement.

---

## Hors de ce plan

- Rotation de l'audio, notifications Web Push et canal Android `alarme`, fils, désambiguïsation, sauvegarde : sous-lots ultérieurs du lot 2.
- Replis du cahier (KWGT ou Tasker sur une URL JSON signée ; notification persistante et Badging API) : non construits.
- Lecture par l'API WebSocket de HA, réordonnancement par `todo/item/move`, mémoire des `uid` dans Valkey : seulement si l'étape 3 de la tâche 7 révèle un écart (H1, H2, H5).
- Lecture seule du widget (sans cochage) : seulement si Franck tranche ainsi la question ouverte 4 ; il suffirait de ne plus appeler `cocherDepuisWidget`.
- HTTPS vers Home Assistant sur le réseau local : seulement si Franck le demande (question ouverte 1).
- Toute automatisation, notification ou alarme côté Home Assistant.
