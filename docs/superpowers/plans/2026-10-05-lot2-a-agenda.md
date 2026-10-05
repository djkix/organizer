# Lot 2-A — Google Agenda et alarme item par item : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque rendez-vous daté (`datee`, jour et heure) que L dicte apparaît en quelques secondes dans un agenda « Organizer » de son Google Agenda, **sans aucun rappel**, sauf si elle a demandé l'alarme sur cet item précis (à la voix, par le bouton « Avec alarme » du bot juste après la capture, ou par l'interrupteur de l'item dans la PWA) : alors Google sonne 10 minutes avant. Cocher l'action retire l'événement ; ce que L fait dans Google ne change rien dans l'application.

**Architecture:** Un nouveau service `apps/scheduler` (Node 22, empaqueté comme l'API et le worker, image `organizer-scheduler`, non root, racine en lecture seule) est le seul à parler à Google : il échange le code OAuth, garde le jeton de rafraîchissement chiffré (AES-256-GCM, clé en secret Docker), crée l'agenda dédié et réconcilie chaque action avec son événement (job BullMQ `synchroniser` sur la file `agenda` de Valkey, idempotent : il relit l'état en base et ne fait que l'écart). L'API ouvre le parcours OAuth (état + PKCE dans Valkey, retour sur `/api/agenda/retour`) sans jamais joindre Google, enfile les synchronisations à chaque cochage ou correction, porte l'interrupteur d'alarme et envoie la proposition « Avec alarme » du bot. Le worker, après un classement, enfile les synchronisations et la proposition. Un balayage toutes les 10 minutes rattrape tout job perdu.

**Tech Stack:** API Google Calendar v3 et OAuth 2.0 de Google appelées en HTTP par `fetch` (undici, par le proxy `sortie`), aucune bibliothèque Google ; `node:crypto` (AES-256-GCM, SHA-256) ; BullMQ 5 sur Valkey 8 ; Prisma 6 ; grammY 1.38 (clavier en ligne, `callback_query`) ; NestJS 11 ; SvelteKit 2 (Svelte 5) ; Vitest 3 avec un faux serveur Google en `node:http` ; Playwright 1.63 ; Squid.

**Spec:** `docs/cahier-des-charges.md` (Types de rappels, Pont Google Agenda, Typologie des échéances, Cycle de vie d'une action, Réseaux et tableau des domaines autorisés, Principes de configuration, Supervision, Lot 2), `docs/decisions.md` (décisions 5, 6, 10, 12, 13, 22, 23), `CLAUDE.md` (règles produit 1 à 7, conventions, dépôt public), `docs/exploitation.md` (Mettre à jour, Publier une version, Revenir à la version précédente, Changer un secret).

**Suite :** lot 2-B (rotation de l'audio par le scheduler, widget Home Assistant, notifications push et canal Android `alarme`), lot 2-C (fils, désambiguïsation, sauvegarde) — hors de ce plan.

## Global Constraints

- Décisions 5 et 6 : « Aucune [sollicitation] par défaut, alarme comprise » ; « Item par item, à la voix ou par bouton ». Un événement est créé pour chaque rendez-vous daté, « mais **sans rappel**, sauf si L a demandé l'alarme sur cet item précis ». L'alarme n'est **jamais** déduite de l'importance.
- Décision 10 : « Compte Google de L, OAuth porté par elle ». Le client OAuth (type « Application Web ») est créé par Franck dans son projet Google Cloud ; c'est L qui consent, depuis son téléphone.
- Portée unique : `https://www.googleapis.com/auth/calendar.app.created`. Aucune autre portée, ni `openid`, ni `email`.
- Pont : « Un agenda dédié, créé par l'application » ; « Uniquement les échéances `datee` du flux Actions, titre court, sans description » ; « Pensées : jamais écrites dans l'agenda, sous aucune forme » ; « Rappels : aucun par défaut … 10 minutes avant si L a activé l'alarme sur l'item » ; « Cocher une action dans l'application supprime l'événement correspondant. Supprimer l'événement dans Google Agenda ne coche rien ». En JSON : `reminders: { useDefault: false, overrides: [] }`, ou `overrides: [{ method: 'popup', minutes: 10 }]` avec l'alarme.
- Réseaux : le scheduler est sur `core` et `sortie` seulement ; Squid lui ouvre `www.googleapis.com` et `oauth2.googleapis.com`, en `CONNECT` 443, depuis son adresse fixe `10.201.2.12`, rien d'autre. L'API et le worker n'obtiennent **aucun** domaine Google nouveau. « L'API est le seul point d'envoi de messages vers L. »
- Fuseau : `Europe/Paris` partout (fuseau du compte, agenda créé avec `timeZone: 'Europe/Paris'`, chaque événement porte `timeZone`). Changements d'heure testés (25 octobre 2026, 28 mars 2027).
- Secrets : jeton de rafraîchissement chiffré au repos, clé `agenda_cle` (32 octets, base64) en secret Docker, secret du client en secret Docker `google_client_secret`. Jetons, code d'autorisation, vérificateur PKCE et titres d'événements ne sont **jamais** journalisés ; les journaux ne portent que des identifiants, des statuts HTTP et des raisons techniques de Google.
- Supervision : alertes à l'administrateur seulement, par la file `alertes` existante (l'API les envoie) ; rien à L, jamais. Réglages montre l'état de la connexion seulement quand L ouvre Réglages.
- Messages visibles : français, tutoiement, phrases de moins de 12 mots, ni « ! » ni « % », aucun emoji, aucun rouge, tokens de couleur seulement ; tous dans `apps/web/src/lib/messages.ts` côté PWA et dans `apps/api/src/telegram/propositions.ts` côté bot.
- Contrainte qui prime : rien ne s'ajoute avant l'enregistrement. La proposition du bot arrive **après** le classement, en message silencieux (`disable_notification: true`), une seule fois, sans relance si elle est ignorée.
- Base : migration **additive** (un type énuméré, une table, cinq colonnes nullables ou avec défaut sur `action`) générée par `prisma migrate diff`, appliquée par `migrate deploy`. **Aucun `migrate reset`, aucun `migrate dev`.** Tunnel de dev ouvert pour les tests (`infra/dev/tunnel.sh`).
- TypeScript strict, aucun `any` implicite ; toute réponse de Google est validée par Zod avant usage. Dans `apps/web/src/lib/**/*.ts` testés : imports relatifs suffixés `.js`, jamais `$app/*` ni `$lib/*` ; types partagés par `@organizer/shared/api`.
- Aucune dépendance npm nouvelle (ni `googleapis`, ni `google-auth-library`) : `fetch`, `zod`, `node:crypto` suffisent.
- Tests : aucun appel au vrai Google ; un faux serveur Google (`apps/scheduler/test/faux-google.ts`) sert l'OAuth et l'agenda. L'essai de fumée vérifie la sortie réelle du scheduler par Squid (connexion TCP vers Google, sans requête authentifiée).
- Dépôt public : aucun secret, aucun prénom réel (comptes de test `l`, `f`, `test`), aucune capture réelle ; l'identifiant du client OAuth ne va que dans le `.env` de la VM.
- Chaque commit met à jour `CHANGELOG.md` (rubrique sous « Non publié »), dans le même commit. Sujet en français, 3e personne (« Ajoute… », « Branche… »), puis exactement `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` en second `-m`. Rien n'est poussé sans l'accord de Franck.
- La CI reste verte : `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e Playwright, budget du bundle, construction des **cinq** images, Trivy, essai de fumée.

## Review Focus

1. **Changement d'heure** : un rendez-vous le dimanche 25 octobre 2026 à 10:00, ou le 28 mars 2027 à 10:00, part avec le bon décalage (`+01:00`, `+02:00`) ; un rendez-vous à 02:45 la nuit du passage à l'heure d'hiver dure bien 30 minutes. Test : tâche 6 (`contenuEvenement`).
2. **L coche puis annule dans les 10 secondes**, ou décoche plus tard : rien ne clignote dans l'agenda (synchronisation retardée de 15 s après un cochage) ; décochée plus tard, l'action retrouve un événement neuf (nouvelle génération d'identifiant), sans boucle sur le 409 de l'identifiant supprimé. Tests : tâche 7 (« décocher après suppression recrée sous une nouvelle génération »), tâche 11 (délai du cochage).
3. **L décoche l'accès à l'agenda sur l'écran de Google, ou annule** : aucun jeton gardé, Réglages dit calmement « Coche l'accès à l'agenda pour connecter. » ou « Connexion annulée. Rien n'a changé. ». Tests : tâche 8 (portée refusée), tâche 10 (`error=access_denied`), tâche 13 (e2e).
4. **Autorisation retirée ou expirée** (L retire l'accès dans son compte Google, ou application restée en « Test » : jeton mort au bout de 7 jours) : état `revoque`, jeton effacé, **une** alerte à l'administrateur, aucun message à L, aucune tempête de reprises. Tests : tâche 7 (`AutorisationRetiree`), tâche 9 (une alerte, job terminé).
5. **Classement tardif** (Gemini indisponible des heures, puis rattrapage) ou rendez-vous déjà passé : aucun bouton « Avec alarme » n'arrive à contretemps (fraîcheur de 15 minutes, rendez-vous futur seulement, une seule proposition par action). Test : tâche 12 (`proposerAlarmes`).

## Arbitrages du plan

Points que les décisions et le cahier ne tranchent pas, arrêtés ici (à rouvrir avec Franck si besoin) :

- **Un service `scheduler` séparé**, pas une boucle dans le worker : le cahier lui donne sa propre liste de sortie, et il porte des secrets (client OAuth, clé de chiffrement) que le worker, qui porte la clé Gemini, n'a pas à voir. Il ne fait au lot 2-A que l'agenda ; la rotation de l'audio le rejoindra au lot 2-B.
- **L'API ne joint jamais Google.** Le retour OAuth arrive bien sur l'API (`GET /api/agenda/retour`), qui vérifie l'état et la session, puis confie le code et le vérificateur PKCE au scheduler par un job `echanger` (supprimé de Valkey dès la fin, réussie ou non). La liste de sortie de l'API reste celle du cahier. La PWA interroge `GET /api/agenda` jusqu'à l'issue (au plus 30 s).
- **Un compte, un agenda** : chaque compte (L, et Franck s'il veut essayer d'abord sur le sien) peut connecter son propre Google Agenda ; une action va dans l'agenda du compte qui a fait la capture. Aucune action d'un compte n'atterrit dans l'agenda de l'autre.
- **Identifiant d'événement déterministe** : `<UUID de l'item sans tirets>` puis, après une suppression, `g<n>` (caractères `0-9a-v`, admis par Google). Une insertion rejouée reçoit 409 et devient un remplacement : aucun doublon possible. L'identifiant, l'agenda, l'empreinte du contenu et la génération sont stockés avec l'action (colonnes `evenement_*`).
- **Réconciliation plutôt que commandes** : un job ne dit jamais « crée » ou « supprime » ; il dit « synchronise l'item X ». Le scheduler relit l'action, calcule l'événement voulu, compare son empreinte et ne fait que l'écart (`rien`, `creer`, `remplacer`, `supprimer`). Les doublons de jobs sont inoffensifs ; concurrence 1 ; pas de `jobId`.
- **Événement supprimé par L dans Google** : rien ne change dans l'application, et l'événement n'est pas recréé tant que l'action ne change pas. Si L modifie ensuite la date, l'heure, le texte ou l'alarme, un nouvel événement est créé (génération suivante) : elle a manifestement encore ce rendez-vous.
- **Éligible** = item de nature `action`, capture non privée, `echeance_type = 'datee'` avec une date, non fait, non archivé, compte connecté. Une pensée, un item corrigé en pensée, une action cochée : événement supprimé. **Jamais** de création pour un rendez-vous commencé depuis plus de 24 h (première connexion comprise : seuls les rendez-vous à venir arrivent dans l'agenda) ; un événement existant suit toujours son action.
- **Contenu** : titre = texte de l'item coupé à 60 caractères sur un mot (« … » final) ; pas de description, pas de lieu, pas d'invité ; durée **30 minutes** ; `start`/`end` en `dateTime` avec décalage plus `timeZone: 'Europe/Paris'`.
- **Synchronisation après un cochage retardée de 15 s** (au-delà des 10 s d'annulation de la PWA) : un cochage annulé ne touche pas l'agenda. Les autres changements partent tout de suite.
- **Un balayage toutes les 10 minutes** (et au démarrage) recalcule l'écart de chaque action datée ou synchronisée et n'enfile que les divergentes : un job perdu (Valkey vidé, enfilement raté) est rattrapé sans appel à Google quand tout est à jour. Il rafraîchit aussi le jeton d'un compte qui n'a rien écrit depuis 7 jours (un jeton de rafraîchissement inutilisé 6 mois expire chez Google).
- **Erreurs de Google** : 401 → nouveau jeton d'accès puis un second essai ; `invalid_grant` au rafraîchissement → état `revoque`, jeton effacé, une alerte ; 403 et 429 → file en pause 15 minutes et une alerte par épisode ; 404 sur l'agenda → état `agenda_supprime` (L a supprimé l'agenda Organizer : respecté, une alerte, Réglages propose de le recréer) ; 5xx et réseau → reprises exponentielles (8 essais, 30 s doublées) ; au moins 3 échecs définitifs dans l'heure → une alerte par heure.
- **Alarme sans agenda** : l'interrupteur de l'item est toujours là sur un rendez-vous daté (le choix est gardé et appliqué dès la connexion) ; le bouton du bot n'est proposé que si le compte a un agenda connecté, sinon il promettrait une alarme qui ne sonne pas. Au lot 2-A, l'alarme **est** le rappel Google Agenda ; le canal Android `alarme` par Web Push arrive avec les notifications (lot 2-B).
- **Proposition du bot** : un message par action datée de la capture, silencieux, en réponse au vocal, envoyé seulement si la capture a moins de 15 minutes et le rendez-vous est à venir, jamais deux fois (`alarme_proposee_le`). Le bouton porte la valeur voulue (`alarme:1:<item>` ou `alarme:0:<item>`) : une mise à jour relivrée par Telegram ne bascule pas deux fois. L'appui modifie le message lui-même (texte et bouton inverse, « Sans alarme ») ; rien d'autre n'est envoyé. Si Gemini a déjà compris l'alarme à la voix, le message le dit et propose « Sans alarme ». Le webhook Telegram s'ouvre aux `callback_query` (`allowed_updates`), d'où un `telegram-webhook poser` à la mise à jour.
- **Alarme à la voix** : le champ `alarme` de Gemini (prompt `tri/v1`, déjà en base) est repris tel quel ; aucun changement de prompt. Chaque bascule manuelle est historisée (`correction`, champ `alarme`) : elle servira à trouver les formulations qui déclenchent l'alarme (point ouvert des décisions).
- **Changer l'échéance d'un rendez-vous daté vers un autre type** remet l'alarme à faux (règle du prompt : alarme seulement pour `datee`) ; l'API refuse `alarme: true` hors `datee` (400).
- **Déconnecter** révoque le jeton chez Google (`/revoke`), l'efface, et **laisse l'agenda Organizer et ses événements** dans le Google Agenda de L (non destructif ; elle peut le supprimer elle-même). Une reconnexion réutilise l'agenda s'il existe encore, sinon en crée un nouveau. Révocation impossible après les reprises : jeton effacé quand même et alerte à l'administrateur (retrait manuel de l'accès depuis le compte Google).
- **Configuration obligatoire en production** : `GOOGLE_CLIENT_ID` (non secret, dans le `.env`) et les secrets `google_client_secret`, `agenda_cle` ; le compose refuse de démarrer sans eux. Hors production, sans `GOOGLE_CLIENT_ID`, l'API répond `indisponible` et le scheduler s'arrête proprement (code 0) : `pnpm dev` reste utilisable sans Google.
- **Changer `agenda_cle`** rend les jetons stockés illisibles : chaque compte reconnecte Google Agenda (procédure dans `docs/exploitation.md`).
- **Retour arrière de 1.2.0 à 1.1.0 sans restauration** : la migration n'ajoute qu'un type, une table et des colonnes ; la 1.1.0 les ignore. Les événements restent dans Google, figés.

## Questions ouvertes pour Franck

1. À la déconnexion, garder l'agenda Organizer dans le Google Agenda de L (plan) ou le supprimer avec ses événements ?
2. Durée des événements : 30 minutes (plan) ou une heure (défaut de Google) ?
3. Client OAuth dans le projet Cloud de Gemini, ou dans un projet dédié sans facturation (plan : dédié, `organizer-agenda`, pour isoler clés et quotas) ?
4. Le message du bot quand Gemini a déjà compris l'alarme à la voix (confirmation avec « Sans alarme ») : à garder (plan), ou silence complet dans ce cas ?

---

## Structure des fichiers

```
docs/cahier-des-charges.md, CLAUDE.md                 lot 2-A, pont précisé (tâche 1)
packages/db/prisma/schema.prisma                      + enum EtatAgenda, modèle AgendaGoogle, colonnes evenement_* et alarme_proposee_le
packages/db/prisma/migrations/20261005180000_agenda/migration.sql   (générée)
packages/db/src/test.ts, packages/db/test/agenda.test.ts
packages/shared/src/files.ts                          + FILE_AGENDA, FILE_PROPOSITIONS, JobAgenda, JobProposition, options, enfilerSynchro
packages/shared/src/api.ts                            + EtatAgenda, ReponseAgenda, ReponseConnexionAgenda, MINUTES_ALARME, CorpsCorrection.alarme
packages/shared/src/agenda.ts                         titreCourt
packages/shared/src/dates.ts                          + dateHeureEnClair
packages/shared/test/agenda.test.ts, dates-agenda.test.ts
apps/scheduler/package.json, tsconfig.json
apps/scheduler/src/configuration.ts                   lireConfigScheduler
apps/scheduler/src/chiffre.ts                         chiffrer, dechiffrer (AES-256-GCM)
apps/scheduler/src/google/erreurs.ts                  ErreurGoogle et sous-classes
apps/scheduler/src/google/oauth.ts                    ClientOAuth (échange, rafraîchissement, révocation)
apps/scheduler/src/google/calendrier.ts               ClientCalendrier (agendas, événements)
apps/scheduler/src/agenda/contenu.ts                  contenuEvenement, empreinteContenu, idEvenement
apps/scheduler/src/agenda/plan.ts                     planifier
apps/scheduler/src/agenda/jetons.ts                   Jetons (cache d'accès, rafraîchissement), NonConnecte, AutorisationRetiree
apps/scheduler/src/agenda/synchroniser.ts             synchroniserAction, chargerEtat, AgendaSupprime
apps/scheduler/src/agenda/connexion.ts                echangerCode, deconnecterAgenda
apps/scheduler/src/agenda/balayer.ts                  balayer
apps/scheduler/src/file.ts                            demarrerFileAgenda, Signaleur
apps/scheduler/src/main.ts, sonde.ts
apps/scheduler/test/*.test.ts, faux-google.ts, aides.ts
apps/api/src/auth/empreintes/defis.ts                 export de borner
apps/api/src/agenda/config.ts, etats.ts, agenda.service.ts, agenda.controller.ts, signal.ts
apps/api/src/items/items.service.ts, items.controller.ts   alarme, signal agenda
apps/api/src/telegram/propositions.ts                 proposerAlarmes, Alarmes, clavierAlarme, demarrerPropositions
apps/api/src/telegram/bot.ts, webhook.ts              bouton « Avec alarme », callback_query
apps/api/src/app.module.ts, config.ts, jetons.ts
apps/api/test/agenda*.test.ts, propositions.test.ts, items.test.ts, bot.test.ts, webhook.test.ts
apps/worker/src/agenda.ts, worker.ts, main.ts         apresClassement
apps/worker/test/agenda.test.ts
apps/web/src/lib/api.ts, agenda.ts, messages.ts
apps/web/src/lib/composants/DetailItem.svelte         interrupteur d'alarme
apps/web/src/routes/reglages/+page.svelte             section Google Agenda
apps/web/test/agenda.test.ts, apps/web/e2e/agenda.spec.ts
infra/docker-compose.yml, infra/.env.example, infra/sortie/squid.conf, infra/image/Dockerfile, infra/image/essai.sh
infra/test/compose.test.ts, image.test.ts, exploitation.test.ts, .github/workflows/ci.yml
docs/exploitation.md, CHANGELOG.md
```

---

### Task 1: Cadrage du lot 2-A dans le cahier

**Files:**
- Modify: `docs/cahier-des-charges.md` (Pont Google Agenda, Réseaux, Trajectoire de livraison), `CLAUDE.md` (État du projet), `CHANGELOG.md`

**Interfaces:**
- Consumes: rien.
- Produces: le périmètre du lot 2-A et les précisions du pont, cités par les tâches suivantes. Aucune décision nouvelle : les décisions 5, 6 et 10 sont appliquées, pas modifiées.

- [ ] **Step 1: Vérifier la cohérence de départ**

Run: `grep -n "Pont Google Agenda\|calendar.app.created\|Lot 2 —\|scheduler" docs/cahier-des-charges.md CLAUDE.md docs/decisions.md`
Expected: le pont (section « Pont Google Agenda »), la ligne `scheduler` du tableau des domaines, « Le `scheduler` rejoint la stack au lot 2 », la section « Lot 2 — Rappels et fils ». Aucune contradiction avec les décisions 5, 6, 10 ; sinon s'arrêter et la signaler à Franck.

- [ ] **Step 2: Préciser le pont dans `docs/cahier-des-charges.md`**

Dans le tableau « Pont Google Agenda », remplacer la ligne « Synchronisation » par :
```markdown
| Synchronisation | À la création, à la modification, à la suppression ; l'identifiant d'événement est stocké avec l'action. Identifiant déterministe tiré de l'item : une écriture rejouée ne crée jamais de doublon. Après un cochage, l'écriture attend 15 s (le temps d'annuler). Un balayage toutes les 10 minutes rattrape tout écart |
```
et ajouter après la ligne « Rappels » :
```markdown
| Événement | Titre : texte de l'action, 60 caractères au plus. Durée 30 minutes. Fuseau `Europe/Paris`. Ni description, ni lieu, ni invité |
| Autorisation, côté serveur | Seul le scheduler parle à Google : échange du code, jeton de rafraîchissement chiffré au repos (AES-256-GCM, clé en secret Docker), révocation à la déconnexion. L'API reçoit le retour OAuth (état et PKCE) sans joindre Google |
```
Après le paragraphe « Cocher une action dans l'application supprime l'événement correspondant… », ajouter :
```markdown
Un événement supprimé par L dans Google n'est pas recréé tant que l'action ne change pas ; si elle change (date, heure, texte, alarme), un nouvel événement est créé. Un agenda Organizer supprimé par L n'est pas recréé de lui-même : Réglages propose de le recréer. La déconnexion depuis Réglages révoque l'autorisation et laisse l'agenda et ses événements dans Google.

Le bouton « avec alarme » du bot part dans un message silencieux, juste après le classement, une seule fois par rendez-vous, seulement si la capture a moins de 15 minutes, le rendez-vous est à venir et l'agenda est connecté. Ignoré, il n'est jamais relancé.
```

- [ ] **Step 3: Découper le lot 2 dans la trajectoire**

Dans « Lot 2 — Rappels et fils », ajouter à la fin de la section :
```markdown
Le lot 2 est livré en sous-lots. **Lot 2-A** (version 1.2.0) : scheduler, écriture des rendez-vous dans Google Agenda sans rappel par défaut, alarme activable item par item (à la voix, par le bouton du bot, par l'interrupteur de l'item). La rotation de l'audio, le widget, les notifications push et le reste du lot suivent.
```

- [ ] **Step 4: Répercuter la stack dans le cahier**

1. Tableau « Services », après la ligne `worker` :
```markdown
| `scheduler` | `ghcr.io/djkix/organizer-scheduler` (Node 22) | — | — | `db`, `queue`, API Google Agenda et OAuth |
```
2. Remplacer « Le `scheduler` rejoint la stack au lot 2, avec Google Agenda et la rotation de l'audio. » par « Le `scheduler` rejoint la stack au lot 2-A, avec Google Agenda ; la rotation de l'audio le rejoint ensuite. »
3. « Réseaux » : `core` devient « `api`, `worker`, `scheduler`, `db`, `queue`, migrations. Aucune sortie Internet. » ; `sortie` devient « `api`, `worker` et `scheduler` vers le proxy sortant `sortie`, interne. »
4. « Principes de configuration », point 1 : « … plus les secrets Docker pour les clés VAPID, le jeton du bot, la clé d'API Gemini, le secret du client OAuth Google et la clé de chiffrement des jetons de l'agenda. »

- [ ] **Step 5: Mettre à jour `CLAUDE.md`**

Section « État du projet », ajouter à la fin :
```markdown
Lot 2-A : Google Agenda et alarme item par item, par un service `apps/scheduler` (seul à joindre Google), en version 1.2.0.
Plan : `docs/superpowers/plans/2026-10-05-lot2-a-agenda.md`.
```

- [ ] **Step 6: Vérifier et commiter**

Run: `grep -n "Lot 2-A\|lot 2-A" docs/cahier-des-charges.md CLAUDE.md`
Expected: au moins une occurrence dans chaque fichier ; aucune phrase du cahier ne dit encore que le scheduler arrive « au lot 2 » avec la rotation.

Ligne de `CHANGELOG.md`, rubrique Modifié : « Le cahier précise le pont Google Agenda (identifiant déterministe, durée, contenu, scheduler seul à joindre Google, proposition du bot) et découpe le lot 2 ; le lot 2-A livre l'agenda et l'alarme item par item (2026-10-05). »
```bash
git add docs/cahier-des-charges.md CLAUDE.md CHANGELOG.md
git commit -m "Précise le pont Google Agenda et cadre le lot 2-A" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Connexion Google et événements dans le schéma

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/test.ts`, `CHANGELOG.md`
- Create (généré) : `packages/db/prisma/migrations/20261005180000_agenda/migration.sql`
- Test: `packages/db/test/agenda.test.ts`

**Interfaces:**
- Consumes: modèles `Utilisateur` et `Action` existants.
- Produces (Prisma) :
  - enum `EtatAgenda` : `deconnecte | en_cours | connecte | deconnexion | revoque | echec | agenda_supprime` ;
  - `prisma.agendaGoogle` — `{ utilisateurId: string (clé), etat: EtatAgenda, erreur: string | null ('portee_refusee' | 'echange'), jetonChiffre: string | null, calendrierId: string | null, connecteLe: Date | null, rafraichiLe: Date | null, modifieLe: Date }`, relation `utilisateur.agenda` ;
  - `action.evenementId: string | null`, `action.evenementCalendrierId: string | null`, `action.evenementEmpreinte: string | null`, `action.evenementGeneration: number` (défaut 0), `action.alarmeProposeeLe: Date | null`.

- [ ] **Step 1: Écrire le test**

`packages/db/test/agenda.test.ts` :
```ts
import { afterAll, beforeEach, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

it('une connexion Google par compte, effacée avec le compte', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const a = await prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'en_cours' } });
  expect(a).toMatchObject({ erreur: null, jetonChiffre: null, calendrierId: null, connecteLe: null, rafraichiLe: null });
  await expect(prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'connecte' } })).rejects.toThrow();
  await prisma.utilisateur.delete({ where: { id: u.id } });
  expect(await prisma.agendaGoogle.count()).toBe(0);
});

it("l'action naît sans événement, génération zéro, sans proposition", async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', emisLe: new Date() } });
  const it = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: 'dentiste', nature: 'action', confiance: {}, personnes: [],
      versionPrompt: 'tri/v1', modele: 'test', action: { create: { echeanceType: 'datee' } },
    },
    include: { action: true },
  });
  expect(it.action).toMatchObject({
    evenementId: null, evenementCalendrierId: null, evenementEmpreinte: null, evenementGeneration: 0, alarmeProposeeLe: null,
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run packages/db/test/agenda.test.ts`
Expected: FAIL à la compilation, `agendaGoogle` n'existe pas sur `PrismaClient`.

- [ ] **Step 3: Étendre le schéma**

Dans `packages/db/prisma/schema.prisma`, après `enum Nature { … }` :
```prisma
/// État de la connexion d'un compte à Google Agenda (lot 2-A).
enum EtatAgenda {
  deconnecte
  en_cours
  connecte
  deconnexion
  revoque
  echec
  agenda_supprime
}
```
Dans `model Utilisateur`, après `clesAcces       CleAcces[]` :
```prisma
  agenda          AgendaGoogle?
```
Dans `model Action`, après `reporteN     Int       @default(0) @map("reporte_n")` :
```prisma
  /// Événement Google Agenda (lot 2-A) : identifiant déterministe, agenda, empreinte du contenu écrit, génération.
  evenementId           String?   @map("evenement_id")
  evenementCalendrierId String?   @map("evenement_calendrier_id")
  evenementEmpreinte    String?   @map("evenement_empreinte")
  evenementGeneration   Int       @default(0) @map("evenement_generation")
  /// Bouton « Avec alarme » déjà proposé dans Telegram : jamais deux fois.
  alarmeProposeeLe      DateTime? @map("alarme_proposee_le")
```
Après `model CleAcces { … }` :
```prisma
/// Connexion d'un compte à son Google Agenda (décision 10). Le jeton de rafraîchissement est chiffré
/// (AES-256-GCM, clé en secret Docker) et n'est lu que par le scheduler. Jamais journalisé.
model AgendaGoogle {
  utilisateurId String      @id @map("utilisateur_id") @db.Uuid
  etat          EtatAgenda
  /// Code technique du dernier échec (portee_refusee, echange), jamais un message de Google.
  erreur        String?
  jetonChiffre  String?     @map("jeton_chiffre")
  calendrierId  String?     @map("calendrier_id")
  connecteLe    DateTime?   @map("connecte_le")
  rafraichiLe   DateTime?   @map("rafraichi_le")
  modifieLe     DateTime    @updatedAt @map("modifie_le")
  utilisateur   Utilisateur @relation(fields: [utilisateurId], references: [id], onDelete: Cascade)

  @@map("agenda_google")
}
```
Dans `packages/db/src/test.ts`, la liste du `TRUNCATE` devient :
`'TRUNCATE agenda_google, cle_acces, session, correction, action, pensee, item, theme, capture, code_liaison, utilisateur CASCADE'`

- [ ] **Step 4: Générer la migration sans toucher aucune base**

```bash
git show HEAD:packages/db/prisma/schema.prisma > /tmp/schema-avant.prisma
mkdir -p packages/db/prisma/migrations/20261005180000_agenda
cd packages/db && DATABASE_URL=postgresql://inutilise@127.0.0.1:1/inutilise node node_modules/prisma/build/index.js migrate diff \
  --from-schema-datamodel /tmp/schema-avant.prisma --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/20261005180000_agenda/migration.sql && cd ../..
pnpm prisma generate
```
Expected: `migration.sql` contient, à l'ordre des colonnes près :
```sql
-- CreateEnum
CREATE TYPE "EtatAgenda" AS ENUM ('deconnecte', 'en_cours', 'connecte', 'deconnexion', 'revoque', 'echec', 'agenda_supprime');

-- AlterTable
ALTER TABLE "action" ADD COLUMN     "alarme_proposee_le" TIMESTAMP(3),
ADD COLUMN     "evenement_calendrier_id" TEXT,
ADD COLUMN     "evenement_empreinte" TEXT,
ADD COLUMN     "evenement_generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "evenement_id" TEXT;

-- CreateTable
CREATE TABLE "agenda_google" (
    "utilisateur_id" UUID NOT NULL,
    "etat" "EtatAgenda" NOT NULL,
    "erreur" TEXT,
    "jeton_chiffre" TEXT,
    "calendrier_id" TEXT,
    "connecte_le" TIMESTAMP(3),
    "rafraichi_le" TIMESTAMP(3),
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agenda_google_pkey" PRIMARY KEY ("utilisateur_id")
);

-- AddForeignKey
ALTER TABLE "agenda_google" ADD CONSTRAINT "agenda_google_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
Le fichier ne doit contenir que `CREATE TYPE`, `CREATE TABLE`, `ALTER TABLE "action" ADD COLUMN` (nullables ou avec défaut) et l'`ADD CONSTRAINT` : aucun `DROP`, aucun `ALTER COLUMN`, aucune autre table modifiée. Sinon, s'arrêter et signaler.

- [ ] **Step 5: Appliquer par `migrate deploy` et lancer les tests**

Run (tunnel ouvert) : `pnpm --filter @organizer/db migrate:test && pnpm vitest run packages/db`
Expected: la migration `20261005180000_agenda` est appliquée à `organizer_test`, puis PASS.

Run: `pnpm db migrate deploy && pnpm db migrate status`
Expected: « Database schema is up to date ».

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La connexion d'un compte à Google Agenda (état, jeton de rafraîchissement chiffré, agenda dédié) et l'événement de chaque action (identifiant, agenda, empreinte, génération), en migration additive (2026-10-05). »
```bash
git add packages/db CHANGELOG.md
git commit -m "Ajoute la connexion Google Agenda et l'événement des actions au schéma" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Contrats partagés de l'agenda

**Files:**
- Modify: `packages/shared/src/files.ts`, `packages/shared/src/api.ts`, `packages/shared/src/dates.ts`, `packages/shared/src/index.ts`, `CHANGELOG.md`
- Create: `packages/shared/src/agenda.ts`
- Test: `packages/shared/test/agenda.test.ts`

**Interfaces:**
- Consumes: rien de neuf.
- Produces :
  - `FILE_AGENDA = 'agenda'`, `FILE_PROPOSITIONS = 'propositions'` ;
  - `type JobAgenda = { type: 'synchroniser'; itemId: string } | { type: 'echanger'; utilisateurId: string; code: string; verificateur: string } | { type: 'deconnecter'; utilisateurId: string } | { type: 'balayer'; utilisateurId?: string }` (le nom du job BullMQ est `type`) ;
  - `interface JobProposition { captureId: string }` ;
  - `OPTIONS_JOB_AGENDA`, `OPTIONS_JOB_ECHANGE`, `OPTIONS_JOB_PROPOSITION`, `DELAI_SYNCHRO_COCHAGE_MS = 15_000` ;
  - `interface FileJobs<T> { add(nom: string, data: T, opts?: object): Promise<unknown> }` ;
  - `enfilerSynchro(file: FileJobs<JobAgenda>, itemId: string, delaiMs?: number): Promise<void>` ;
  - `@organizer/shared/api` : `MINUTES_ALARME = 10`, `type EtatAgenda`, `type ErreurAgenda`, `interface ReponseAgenda { etat: EtatAgenda; erreur: ErreurAgenda }`, `interface ReponseConnexionAgenda { url: string }`, `CorpsCorrection.alarme?: boolean` ;
  - `titreCourt(texte: string, max?: number): string` (`@organizer/shared`) ;
  - `dateHeureEnClair(date: Date, fuseau: string): string` (`@organizer/shared/dates`), ex. « mercredi 14 octobre, 10:00 ».

- [ ] **Step 1: Écrire le test**

`packages/shared/test/agenda.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { titreCourt } from '../src/agenda.js';
import { dateHeureEnClair } from '../src/dates.js';
import { enfilerSynchro, OPTIONS_JOB_AGENDA, type JobAgenda } from '../src/files.js';

describe('titreCourt', () => {
  it('garde un texte court tel quel, sans espaces superflus', () => {
    expect(titreCourt('  dentiste   jeudi ')).toBe('dentiste jeudi');
  });
  it('coupe à un mot sous 60 caractères, avec « … »', () => {
    const t = titreCourt('appeler la mutuelle pour le remboursement des lunettes de la petite avant la fin du mois');
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith('…')).toBe(true);
    expect(t).toBe('appeler la mutuelle pour le remboursement des lunettes de…');
  });
  it('coupe dans le mot quand le premier mot dépasse seul', () => {
    expect(titreCourt('a'.repeat(80))).toBe(`${'a'.repeat(59)}…`);
  });
  it('un texte vide donne « Rendez-vous »', () => {
    expect(titreCourt('   ')).toBe('Rendez-vous');
  });
});

describe('dateHeureEnClair', () => {
  it('jour, date et heure à Paris, en été comme en hiver', () => {
    expect(dateHeureEnClair(new Date('2026-10-14T08:00:00Z'), 'Europe/Paris')).toBe('mercredi 14 octobre, 10:00');
    expect(dateHeureEnClair(new Date('2026-12-03T14:30:00Z'), 'Europe/Paris')).toBe('jeudi 3 décembre, 15:30');
  });
});

describe('enfilerSynchro', () => {
  it('enfile un job synchroniser, sans identifiant de job, avec le délai demandé', async () => {
    const ajouts: Array<[string, JobAgenda, object | undefined]> = [];
    await enfilerSynchro({ add: async (n, d, o) => { ajouts.push([n, d, o]); } }, 'i1', 15_000);
    expect(ajouts).toEqual([['synchroniser', { type: 'synchroniser', itemId: 'i1' }, { ...OPTIONS_JOB_AGENDA, delay: 15_000 }]]);
    expect(ajouts[0]![2]).not.toHaveProperty('jobId');
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run packages/shared/test/agenda.test.ts`
Expected: FAIL, `../src/agenda.js` introuvable.

- [ ] **Step 3: Écrire le code**

`packages/shared/src/agenda.ts` :
```ts
/** Titre court d'un événement ou d'un message : le texte de l'action, coupé à un mot, « … » final. */
export function titreCourt(texte: string, max = 60): string {
  const t = texte.trim().replace(/\s+/g, ' ');
  if (t.length === 0) return 'Rendez-vous';
  if (t.length <= max) return t;
  const coupe = t.slice(0, max - 1);
  const espace = coupe.lastIndexOf(' ');
  return `${espace > 0 ? coupe.slice(0, espace) : coupe}…`;
}
```

Ajouter à `packages/shared/src/dates.ts` :
```ts
/** « mercredi 14 octobre, 10:00 » : jour, date et heure murale dans le fuseau. */
export function dateHeureEnClair(date: Date, fuseau: string): string {
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return `${jour}, ${isoLocal(date, fuseau).slice(11, 16)}`;
}
```

Ajouter à `packages/shared/src/files.ts` :
```ts
export const FILE_AGENDA = 'agenda';
export const FILE_PROPOSITIONS = 'propositions';

/**
 * Jobs du scheduler ; le nom du job BullMQ est `type`. Un job `synchroniser` ne dit jamais quoi faire :
 * le scheduler relit l'action et ne fait que l'écart. Code et vérificateur ne vivent que le temps de l'échange.
 */
export type JobAgenda =
  | { type: 'synchroniser'; itemId: string }
  | { type: 'echanger'; utilisateurId: string; code: string; verificateur: string }
  | { type: 'deconnecter'; utilisateurId: string }
  | { type: 'balayer'; utilisateurId?: string };

/** Proposition du bouton « Avec alarme » après le classement d'une capture Telegram (envoyée par l'API). */
export interface JobProposition { captureId: string }

/** Environ deux heures de reprises (30 s doublées) ; au-delà, le balayage de 10 minutes rattrape. */
export const OPTIONS_JOB_AGENDA = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

/** Le code d'autorisation expire vite et ne doit rien laisser dans Valkey : peu d'essais, rien de gardé. */
export const OPTIONS_JOB_ECHANGE = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export const OPTIONS_JOB_PROPOSITION = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
} as const;

/** Après un cochage : au-delà des 10 s d'annulation de la PWA, pour qu'un cochage annulé ne touche pas l'agenda. */
export const DELAI_SYNCHRO_COCHAGE_MS = 15_000;

/** Ce que les producteurs demandent à une file BullMQ. */
export interface FileJobs<T> { add(nom: string, data: T, opts?: object): Promise<unknown> }

/** Pas de jobId : deux synchronisations du même item sont inoffensives, une seule serait perdue si l'autre est active. */
export async function enfilerSynchro(file: FileJobs<JobAgenda>, itemId: string, delaiMs = 0): Promise<void> {
  await file.add('synchroniser', { type: 'synchroniser', itemId }, { ...OPTIONS_JOB_AGENDA, delay: delaiMs });
}
```

Ajouter à `packages/shared/src/api.ts` :
```ts
/** Rappel de l'alarme dans Google Agenda, en minutes avant le rendez-vous (cahier, Pont Google Agenda). */
export const MINUTES_ALARME = 10;

/** `indisponible` : Google Agenda n'est pas configuré sur ce serveur. Les autres valeurs sont celles de la base. */
export type EtatAgenda = 'indisponible' | 'deconnecte' | 'en_cours' | 'connecte' | 'deconnexion' | 'revoque' | 'echec' | 'agenda_supprime';
export type ErreurAgenda = 'portee_refusee' | 'echange' | null;
export interface ReponseAgenda { etat: EtatAgenda; erreur: ErreurAgenda }
export interface ReponseConnexionAgenda { url: string }
```
et dans `CorpsCorrection`, après `echeance?: …` :
```ts
  /** Alarme 10 minutes avant, seulement sur une échéance `datee`. */
  alarme?: boolean;
```
Dans `packages/shared/src/index.ts`, ajouter `export * from './agenda.js';`.

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run packages/shared && pnpm --filter @organizer/shared typecheck`
Expected: PASS. Si `Intl` du Node local rend « mercredi 14 octobre » autrement (ICU réduit), vérifier `node -p "process.versions.icu"` : Node 22 officiel embarque l'ICU complète.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les contrats partagés de l'agenda : files `agenda` et `propositions`, jobs, délai de 15 s après un cochage, état de la connexion pour la PWA, alarme dans une correction, titre court et date en clair (2026-10-05). »
```bash
git add packages/shared CHANGELOG.md
git commit -m "Ajoute les contrats partagés de l'agenda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Squelette du scheduler, configuration et chiffrement des jetons

**Files:**
- Create: `apps/scheduler/package.json`, `apps/scheduler/tsconfig.json`, `apps/scheduler/src/configuration.ts`, `apps/scheduler/src/chiffre.ts`, `apps/scheduler/src/sonde.ts`, `apps/scheduler/src/main.ts` (provisoire, complété en tâche 9)
- Modify: `pnpm-lock.yaml` (par `pnpm install`), `CHANGELOG.md`
- Test: `apps/scheduler/test/chiffre.test.ts`, `apps/scheduler/test/configuration.test.ts`, `apps/scheduler/test/paquet.test.ts`

**Interfaces:**
- Consumes: `lireVar`, `exigerVar`, `creerFetchSortant`, `essayerSortie` (`@organizer/shared`) ; `scripts/empaquetage.mjs`.
- Produces :
  - `interface ConfigGoogle { clientId: string; clientSecret: string; redirectUri: string; baseOauth: string; baseCalendrier: string }` ;
  - `interface ConfigScheduler { redisUrl: string; google: ConfigGoogle; cle: Buffer }` ;
  - `lireConfigScheduler(env?: NodeJS.ProcessEnv): ConfigScheduler | null` (null hors production sans `GOOGLE_CLIENT_ID`) ;
  - `chiffrer(clair: string, cle: Buffer, contexte: string): string` et `dechiffrer(chiffre: string, cle: Buffer, contexte: string): string` (format `v1.<base64url>`, contexte = identifiant du compte, lié comme donnée authentifiée) ;
  - `dist/main.mjs`, `dist/sonde.mjs` (`sonde sortie <url>`).

- [ ] **Step 1: Créer le paquet**

`apps/scheduler/package.json` :
```json
{
  "name": "@organizer/scheduler",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/main.ts",
    "sonde": "tsx --env-file=../../.env src/sonde.ts",
    "typecheck": "tsc --noEmit -p .",
    "build": "node ../../scripts/empaquetage.mjs src/main.ts src/sonde.ts"
  },
  "dependencies": {
    "@organizer/db": "workspace:*",
    "@organizer/shared": "workspace:*",
    "@prisma/client": "^6.16.0",
    "bullmq": "^5.58.0",
    "https-proxy-agent": "^7.0.6",
    "ioredis": "^5.7.0",
    "undici": "^7.0.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "tsx": "^4.20.0"
  }
}
```
`apps/scheduler/tsconfig.json` : `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`

Run: `pnpm install`
Expected: le verrou gagne l'importateur `apps/scheduler`, aucune version nouvelle (mêmes plages que le worker).

- [ ] **Step 2: Écrire les tests**

`apps/scheduler/test/chiffre.test.ts` :
```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chiffrer, dechiffrer } from '../src/chiffre.js';

const cle = randomBytes(32);

describe('chiffrement du jeton de rafraîchissement', () => {
  it('rend le clair avec la même clé et le même compte', () => {
    const c = chiffrer('1//jeton-fabrique', cle, 'compte-1');
    expect(c.startsWith('v1.')).toBe(true);
    expect(c).not.toContain('jeton-fabrique');
    expect(dechiffrer(c, cle, 'compte-1')).toBe('1//jeton-fabrique');
  });

  it('deux chiffrements du même jeton diffèrent (IV aléatoire)', () => {
    expect(chiffrer('x', cle, 'c')).not.toBe(chiffrer('x', cle, 'c'));
  });

  it('refuse un autre compte, une autre clé, un octet modifié, un format inconnu', () => {
    const c = chiffrer('jeton', cle, 'compte-1');
    expect(() => dechiffrer(c, cle, 'compte-2')).toThrow();
    expect(() => dechiffrer(c, randomBytes(32), 'compte-1')).toThrow();
    const brut = Buffer.from(c.slice(3), 'base64url');
    brut[brut.length - 1]! ^= 1;
    expect(() => dechiffrer(`v1.${brut.toString('base64url')}`, cle, 'compte-1')).toThrow();
    expect(() => dechiffrer('v0.abc', cle, 'compte-1')).toThrow('Format de jeton chiffré inconnu');
  });

  it('exige une clé de 32 octets', () => {
    expect(() => chiffrer('x', randomBytes(16), 'c')).toThrow('32 octets');
  });
});
```

`apps/scheduler/test/configuration.test.ts` :
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireConfigScheduler } from '../src/configuration.js';

const dossier = mkdtempSync(join(tmpdir(), 'sched-'));
const fichier = (nom: string, valeur: string): string => { const f = join(dossier, nom); writeFileSync(f, valeur); return f; };
const CLE = Buffer.alloc(32, 7).toString('base64');
const base = {
  REDIS_URL: 'redis://127.0.0.1:6379', GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET_FILE: fichier('secret', 'secret-essai\n'), AGENDA_CLE_FILE: fichier('cle', `${CLE}\n`),
  GOOGLE_REDIRECT_URI: 'https://organizer.essai/api/agenda/retour',
};

describe('lireConfigScheduler', () => {
  it('lit secrets et adresses ; bases Google par défaut', () => {
    const c = lireConfigScheduler({ ...base, NODE_ENV: 'production' })!;
    expect(c.google).toEqual({
      clientId: 'id.apps.googleusercontent.com', clientSecret: 'secret-essai',
      redirectUri: 'https://organizer.essai/api/agenda/retour',
      baseOauth: 'https://oauth2.googleapis.com', baseCalendrier: 'https://www.googleapis.com/calendar/v3',
    });
    expect(c.cle.length).toBe(32);
  });

  it('hors production, sans client OAuth : rien (le scheduler s\'arrête proprement)', () => {
    expect(lireConfigScheduler({ REDIS_URL: 'redis://x' })).toBeNull();
  });

  it('en production, sans client OAuth : refus explicite', () => {
    expect(() => lireConfigScheduler({ REDIS_URL: 'redis://x', NODE_ENV: 'production' })).toThrow('GOOGLE_CLIENT_ID');
  });

  it('clé de chiffrement de mauvaise taille : refus qui dit comment la générer', () => {
    const env = { ...base, AGENDA_CLE_FILE: fichier('courte', Buffer.alloc(16).toString('base64')) };
    expect(() => lireConfigScheduler(env)).toThrow('openssl rand -base64 32');
  });

  it('adresse de retour en https obligatoire en production', () => {
    expect(() => lireConfigScheduler({ ...base, NODE_ENV: 'production', GOOGLE_REDIRECT_URI: 'http://x/api/agenda/retour' })).toThrow('https');
  });
});
```

`apps/scheduler/test/paquet.test.ts` :
```ts
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { empaqueter, importsExternes } from '../../../scripts/empaquetage.mjs';

const APP = join(import.meta.dirname, '..');
const ENV_VIDE = { PATH: process.env.PATH ?? '', NODE_ENV: 'production' };

describe('paquet du scheduler', () => {
  it('chaque paquet importé à l\'exécution est une dépendance directe du scheduler', async () => {
    const r = await empaqueter(APP, ['src/main.ts', 'src/sonde.ts']);
    const deps = Object.keys((JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies);
    expect(importsExternes(r.metafile).filter((n) => !deps.includes(n))).toEqual([]);
  }, 60_000);

  it('dist/main.mjs se charge sans module manquant et s\'arrête sur la configuration', () => {
    const r = spawnSync(process.execPath, [join(APP, 'dist/main.mjs')], { env: ENV_VIDE, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/);
    expect(r.stderr).toContain('Variable manquante');
  });

  it('dist/sonde.mjs affiche son usage', () => {
    const r = spawnSync(process.execPath, [join(APP, 'dist/sonde.mjs')], { env: ENV_VIDE, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Usage : sonde sortie <url>');
  });
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler`
Expected: FAIL, modules `../src/chiffre.js` et `../src/configuration.js` introuvables.

- [ ] **Step 4: Écrire le code**

`apps/scheduler/src/chiffre.ts` :
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1.';

function exigerCle(cle: Buffer): void {
  if (cle.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets.');
}

/**
 * AES-256-GCM, IV de 12 octets aléatoire, étiquette de 16 octets. Le contexte (identifiant du compte) est lié
 * comme donnée authentifiée : un jeton recopié sur un autre compte ne se déchiffre pas.
 */
export function chiffrer(clair: string, cle: Buffer, contexte: string): string {
  exigerCle(cle);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', cle, iv);
  c.setAAD(Buffer.from(contexte, 'utf8'));
  const corps = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
  return VERSION + Buffer.concat([iv, c.getAuthTag(), corps]).toString('base64url');
}

export function dechiffrer(chiffre: string, cle: Buffer, contexte: string): string {
  exigerCle(cle);
  if (!chiffre.startsWith(VERSION)) throw new Error('Format de jeton chiffré inconnu.');
  const brut = Buffer.from(chiffre.slice(VERSION.length), 'base64url');
  const d = createDecipheriv('aes-256-gcm', cle, brut.subarray(0, 12));
  d.setAAD(Buffer.from(contexte, 'utf8'));
  d.setAuthTag(brut.subarray(12, 28));
  return Buffer.concat([d.update(brut.subarray(28)), d.final()]).toString('utf8');
}
```

`apps/scheduler/src/configuration.ts` :
```ts
import { exigerVar, lireVar } from '@organizer/shared';

export interface ConfigGoogle { clientId: string; clientSecret: string; redirectUri: string; baseOauth: string; baseCalendrier: string }
export interface ConfigScheduler { redisUrl: string; google: ConfigGoogle; cle: Buffer }

/**
 * Hors production, sans GOOGLE_CLIENT_ID : null, le scheduler s'arrête proprement (pnpm dev sans Google).
 * En production : tout est exigé. Les bases Google ne changent que pour les tests (faux serveur).
 */
export function lireConfigScheduler(env: NodeJS.ProcessEnv = process.env): ConfigScheduler | null {
  const production = env.NODE_ENV === 'production';
  const clientId = lireVar('GOOGLE_CLIENT_ID', env);
  if (!clientId && !production) return null;
  const redisUrl = exigerVar('REDIS_URL', env);
  const id = exigerVar('GOOGLE_CLIENT_ID', env);
  const redirectUri = exigerVar('GOOGLE_REDIRECT_URI', env);
  if (production && !redirectUri.startsWith('https://')) throw new Error('GOOGLE_REDIRECT_URI doit commencer par https:// en production');
  const cle = Buffer.from(exigerVar('AGENDA_CLE', env), 'base64');
  if (cle.length !== 32) throw new Error('AGENDA_CLE doit faire 32 octets : openssl rand -base64 32');
  return {
    redisUrl,
    google: {
      clientId: id,
      clientSecret: exigerVar('GOOGLE_CLIENT_SECRET', env),
      redirectUri,
      baseOauth: lireVar('GOOGLE_OAUTH_BASE', env) ?? 'https://oauth2.googleapis.com',
      baseCalendrier: lireVar('GOOGLE_CALENDAR_BASE', env) ?? 'https://www.googleapis.com/calendar/v3',
    },
    cle,
  };
}
```

`apps/scheduler/src/sonde.ts` (complétée en tâche 9) :
```ts
import { creerFetchSortant, essayerSortie } from '@organizer/shared';

// Sonde d'exploitation : aucun jeton, aucun titre d'événement n'est lu ni affiché.
const [commande, cible] = process.argv.slice(2);
if (commande === 'sortie' && cible) {
  console.log(await essayerSortie(cible, creerFetchSortant()));
} else {
  console.log('Usage : sonde sortie <url>');
  process.exitCode = 1;
}
```

`apps/scheduler/src/main.ts` (provisoire, remplacé en tâche 9) :
```ts
import { lireConfigScheduler } from './configuration.js';

const config = lireConfigScheduler();
if (!config) {
  console.log('Google Agenda non configuré (GOOGLE_CLIENT_ID absent) : scheduler arrêté.');
  process.exit(0);
}
console.log('Scheduler configuré.');
```

- [ ] **Step 5: Construire et lancer les tests**

Run: `pnpm --filter @organizer/scheduler build && pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck && pnpm lint`
Expected: PASS. Le test de paquet lance `dist/main.mjs` avec `NODE_ENV=production` et sans variables : « Variable manquante : REDIS_URL ».

Note : `pnpm dev` lance désormais aussi le scheduler ; sans `GOOGLE_CLIENT_ID` dans le `.env` racine, il écrit « Google Agenda non configuré » et s'arrête (code 0).

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Le service `scheduler` (squelette) : configuration Google exigée en production, jeton de rafraîchissement chiffré en AES-256-GCM lié au compte, sonde de sortie, paquet esbuild vérifié (2026-10-05). »
```bash
git add apps/scheduler pnpm-lock.yaml CHANGELOG.md
git commit -m "Ajoute le squelette du scheduler et le chiffrement des jetons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Clients HTTP de Google et faux serveur Google

**Files:**
- Create: `apps/scheduler/src/google/erreurs.ts`, `apps/scheduler/src/google/oauth.ts`, `apps/scheduler/src/google/calendrier.ts`, `apps/scheduler/test/faux-google.ts`
- Modify: `CHANGELOG.md`
- Test: `apps/scheduler/test/oauth.test.ts`, `apps/scheduler/test/calendrier.test.ts`

**Interfaces:**
- Consumes: `ConfigGoogle` (tâche 4).
- Produces :
  - erreurs : `ErreurGoogle(statut: number, raison: string | null)` et ses sous-classes `JetonRefuse` (401), `GoogleIndisponible` (403, 429), `Introuvable` (404, 410), `DejaPresent` (409), `OctroiInvalide` (`invalid_grant`), `ClientRefuse` (`invalid_client`, `unauthorized_client`) ; `raisonDe(r: Response): Promise<string | null>` ;
  - `PORTEE_AGENDA` ; `interface JetonsObtenus { acces: string; expireDansS: number; rafraichissement: string | null; portees: string[] }` ;
  - `class ClientOAuth(config: ConfigGoogle, f: typeof fetch)` : `echanger(code, verificateur): Promise<JetonsObtenus>`, `rafraichir(rafraichissement): Promise<{ acces: string; expireDansS: number }>`, `revoquer(jeton): Promise<void>` ;
  - `interface CorpsEvenement { summary: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string }; reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] } }` ; `interface EvenementLu { id: string; status: string }` ;
  - `class ClientCalendrier(base: string, f: typeof fetch)` : `creerAgenda(jeton, nom, fuseau): Promise<string>`, `agendaExiste(jeton, id): Promise<boolean>`, `inserer(jeton, agenda, id, corps): Promise<void>`, `lire(jeton, agenda, id): Promise<EvenementLu | null>`, `remplacer(jeton, agenda, id, corps): Promise<void>`, `supprimer(jeton, agenda, id): Promise<void>` ;
  - `class FauxGoogle` (tests) : `url`, `requetes`, `codes`, `rafraichissements`, `acces`, `revoques`, `agendas`, `forcer(motif, statut, corps?)`, `connecte(rafr?)`, `agenda(id?)`, `evenement(agenda, id)`, `supprimerParL(agenda, id)`, `demarrer()`, `arreter()` ; constantes `PORTEE`, `SECRET_ESSAI`.

Faits de l'API Google repris ici (documentation publique de Google ; à revérifier en tâche 15 sur le vrai service) : jeton `POST https://oauth2.googleapis.com/token` (formulaire, `grant_type=authorization_code` avec `code_verifier`, ou `refresh_token`), erreur `400 {"error":"invalid_grant"}` pour un code ou un jeton mort ; révocation `POST https://oauth2.googleapis.com/revoke` (`token=`) ; agenda `POST /calendar/v3/calendars` ; événements `POST|GET|PUT|DELETE /calendar/v3/calendars/{agenda}/events[/{id}]` ; un identifiant d'événement fourni par le client est fait de `0-9a-v`, 5 à 1024 caractères, unique dans l'agenda, et une insertion d'un identifiant existant répond 409 ; un événement supprimé reste lisible avec `status: "cancelled"`, et sa suppression répond 410. **Non vérifié** : que `calendars.get` réponde 200 sous la portée `calendar.app.created` pour l'agenda créé par l'application (le code ne s'appuie que sur 200 ou 404).

- [ ] **Step 1: Écrire le faux serveur Google**

`apps/scheduler/test/faux-google.ts` :
```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const PORTEE = 'https://www.googleapis.com/auth/calendar.app.created';
export const SECRET_ESSAI = 'secret-essai';

export interface RequeteVue { methode: string; chemin: string; autorisation: string | undefined; corps: string }
interface EvenementStocke { id: string; status: 'confirmed' | 'cancelled'; corps: Record<string, unknown> }
interface AgendaStocke { summary: string; timeZone: string; evenements: Map<string, EvenementStocke> }

const lire = (req: IncomingMessage): Promise<string> => new Promise((ok, ko) => {
  const morceaux: Buffer[] = [];
  req.on('data', (m: Buffer) => morceaux.push(m)).on('end', () => ok(Buffer.concat(morceaux).toString('utf8'))).on('error', ko);
});

function envoyer(res: ServerResponse, statut: number, corps?: unknown): void {
  if (corps === undefined || statut === 204) {
    res.writeHead(statut).end();
    return;
  }
  res.writeHead(statut, { 'content-type': 'application/json' }).end(JSON.stringify(corps));
}

const erreur = (code: number, reason: string) => ({ error: { code, errors: [{ reason }], message: `message de Google ${reason}` } });

/** Faux Google (OAuth et agenda v3), en mémoire. Aucun appel au vrai Google dans les tests. */
export class FauxGoogle {
  url = '';
  readonly requetes: RequeteVue[] = [];
  /** Codes d'autorisation acceptés : portée accordée, vérificateur PKCE attendu, jeton de rafraîchissement absent. */
  readonly codes = new Map<string, { portee: string; verificateur?: string; sansRafraichissement?: boolean }>();
  readonly rafraichissements = new Set<string>();
  readonly acces = new Set<string>();
  readonly revoques: string[] = [];
  readonly agendas = new Map<string, AgendaStocke>();
  private forces: Array<{ motif: RegExp; statut: number; corps: unknown }> = [];
  private n = 0;
  private serveur?: Server;

  /** La prochaine requête « MÉTHODE /chemin » qui correspond reçoit ce statut. Un appel = une réponse forcée. */
  forcer(motif: RegExp, statut: number, corps: unknown = erreur(statut, 'force')): void {
    this.forces.push({ motif, statut, corps });
  }

  connecte(rafr = 'rafr-1'): void {
    this.rafraichissements.add(rafr);
  }

  agenda(id = 'agenda-1@group.calendar.google.com'): string {
    this.agendas.set(id, { summary: 'Organizer', timeZone: 'Europe/Paris', evenements: new Map() });
    return id;
  }

  evenement(agenda: string, id: string): EvenementStocke | undefined {
    return this.agendas.get(agenda)?.evenements.get(id);
  }

  /** Ce que fait L quand elle supprime l'événement dans Google Agenda. */
  supprimerParL(agenda: string, id: string): void {
    const e = this.evenement(agenda, id);
    if (e) e.status = 'cancelled';
  }

  async demarrer(): Promise<void> {
    this.serveur = createServer((req, res) => {
      this.traiter(req, res).catch(() => envoyer(res, 500, erreur(500, 'backendError')));
    });
    await new Promise<void>((ok) => this.serveur!.listen(0, '127.0.0.1', ok));
    this.url = `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
  }

  async arreter(): Promise<void> {
    await new Promise<void>((ok) => this.serveur?.close(() => ok()) ?? ok());
  }

  private async traiter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const corps = await lire(req);
    const chemin = new URL(req.url ?? '/', 'http://x').pathname;
    const methode = req.method ?? 'GET';
    this.requetes.push({ methode, chemin, autorisation: req.headers.authorization, corps });
    const i = this.forces.findIndex((f) => f.motif.test(`${methode} ${chemin}`));
    if (i >= 0) {
      const [f] = this.forces.splice(i, 1);
      return envoyer(res, f!.statut, f!.corps);
    }
    if (methode === 'POST' && chemin === '/token') return this.jeton(new URLSearchParams(corps), res);
    if (methode === 'POST' && chemin === '/revoke') {
      const jeton = new URLSearchParams(corps).get('token') ?? '';
      this.revoques.push(jeton);
      this.rafraichissements.delete(jeton);
      return envoyer(res, 200, {});
    }
    const m = /^\/calendar\/v3\/calendars(?:\/([^/]+))?(\/events)?(?:\/([^/]+))?$/.exec(chemin);
    if (!m) return envoyer(res, 404, erreur(404, 'notFound'));
    if (!this.acces.has((req.headers.authorization ?? '').replace(/^Bearer /, ''))) return envoyer(res, 401, erreur(401, 'authError'));
    const agendaId = m[1] ? decodeURIComponent(m[1]) : undefined;
    const evenementId = m[3] ? decodeURIComponent(m[3]) : undefined;
    if (!agendaId) {
      if (methode !== 'POST') return envoyer(res, 404, erreur(404, 'notFound'));
      const c = JSON.parse(corps) as { summary: string; timeZone: string };
      const id = `agenda-${++this.n}@group.calendar.google.com`;
      this.agendas.set(id, { summary: c.summary, timeZone: c.timeZone, evenements: new Map() });
      return envoyer(res, 200, { id, summary: c.summary, timeZone: c.timeZone });
    }
    const a = this.agendas.get(agendaId);
    if (!a) return envoyer(res, 404, erreur(404, 'notFound'));
    if (!m[2]) return methode === 'GET' ? envoyer(res, 200, { id: agendaId, summary: a.summary }) : envoyer(res, 404, erreur(404, 'notFound'));
    if (!evenementId) {
      if (methode !== 'POST') return envoyer(res, 404, erreur(404, 'notFound'));
      const c = JSON.parse(corps) as Record<string, unknown>;
      const id = String(c.id);
      if (a.evenements.has(id)) return envoyer(res, 409, erreur(409, 'duplicate'));
      a.evenements.set(id, { id, status: 'confirmed', corps: c });
      return envoyer(res, 200, { id, status: 'confirmed' });
    }
    const e = a.evenements.get(evenementId);
    if (!e) return envoyer(res, 404, erreur(404, 'notFound'));
    if (methode === 'GET') return envoyer(res, 200, { id: e.id, status: e.status });
    if (methode === 'PUT') {
      e.corps = JSON.parse(corps) as Record<string, unknown>;
      return envoyer(res, 200, { id: e.id, status: e.status });
    }
    if (methode === 'DELETE') {
      if (e.status === 'cancelled') return envoyer(res, 410, erreur(410, 'deleted'));
      e.status = 'cancelled';
      return envoyer(res, 204);
    }
    return envoyer(res, 404, erreur(404, 'notFound'));
  }

  private jeton(p: URLSearchParams, res: ServerResponse): void {
    if (p.get('client_secret') !== SECRET_ESSAI) return envoyer(res, 401, { error: 'invalid_client', error_description: 'secret' });
    if (p.get('grant_type') === 'authorization_code') {
      const code = p.get('code') ?? '';
      const c = this.codes.get(code);
      if (!c || (c.verificateur !== undefined && c.verificateur !== p.get('code_verifier'))) {
        return envoyer(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
      }
      this.codes.delete(code);
      const n = ++this.n;
      this.acces.add(`acces-${n}`);
      if (!c.sansRafraichissement) this.rafraichissements.add(`rafr-${n}`);
      return envoyer(res, 200, {
        access_token: `acces-${n}`, expires_in: 3599, scope: c.portee, token_type: 'Bearer',
        ...(c.sansRafraichissement ? {} : { refresh_token: `rafr-${n}` }),
      });
    }
    if (p.get('grant_type') === 'refresh_token') {
      if (!this.rafraichissements.has(p.get('refresh_token') ?? '')) return envoyer(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      const n = ++this.n;
      this.acces.add(`acces-${n}`);
      return envoyer(res, 200, { access_token: `acces-${n}`, expires_in: 3599, scope: PORTEE, token_type: 'Bearer' });
    }
    return envoyer(res, 400, { error: 'unsupported_grant_type' });
  }
}
```

- [ ] **Step 2: Écrire les tests des clients**

`apps/scheduler/test/oauth.test.ts` :
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClientRefuse, ErreurGoogle, OctroiInvalide } from '../src/google/erreurs.js';
import { ClientOAuth, PORTEE_AGENDA } from '../src/google/oauth.js';
import { FauxGoogle, PORTEE, SECRET_ESSAI } from './faux-google.js';

let faux: FauxGoogle;
const client = (secret = SECRET_ESSAI) => new ClientOAuth({
  clientId: 'id.apps.googleusercontent.com', clientSecret: secret, redirectUri: 'https://organizer.essai/api/agenda/retour',
  baseOauth: faux.url, baseCalendrier: `${faux.url}/calendar/v3`,
}, fetch);

beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(() => faux.arreter());
beforeEach(() => { faux.requetes.length = 0; });

describe('ClientOAuth', () => {
  it('échange le code avec le vérificateur PKCE et l\'adresse de retour exacte', async () => {
    expect(PORTEE_AGENDA).toBe(PORTEE);
    faux.codes.set('code-1', { portee: PORTEE, verificateur: 'verif-1' });
    const j = await client().echanger('code-1', 'verif-1');
    expect(j.portees).toEqual([PORTEE]);
    expect(j.rafraichissement).toMatch(/^rafr-/);
    const envoye = new URLSearchParams(faux.requetes[0]!.corps);
    expect(Object.fromEntries(envoye)).toMatchObject({
      grant_type: 'authorization_code', code: 'code-1', code_verifier: 'verif-1',
      client_id: 'id.apps.googleusercontent.com', redirect_uri: 'https://organizer.essai/api/agenda/retour',
    });
  });

  it('code inconnu ou mauvais vérificateur : OctroiInvalide, sans jeton dans le message', async () => {
    faux.codes.set('code-2', { portee: PORTEE, verificateur: 'bon' });
    const e = await client().echanger('code-2', 'mauvais').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OctroiInvalide);
    expect((e as Error).message).toBe('Google HTTP 400 (invalid_grant)');
  });

  it('secret refusé : ClientRefuse', async () => {
    await expect(client('autre').rafraichir('rafr-x')).rejects.toBeInstanceOf(ClientRefuse);
  });

  it('rafraîchit un jeton valable ; un jeton révoqué donne OctroiInvalide', async () => {
    faux.connecte('rafr-ok');
    expect((await client().rafraichir('rafr-ok')).acces).toMatch(/^acces-/);
    await client().revoquer('rafr-ok');
    expect(faux.revoques).toContain('rafr-ok');
    await expect(client().rafraichir('rafr-ok')).rejects.toBeInstanceOf(OctroiInvalide);
  });

  it('5xx : ErreurGoogle simple (reprise) ; révocation d\'un jeton déjà mort : sans erreur', async () => {
    faux.forcer(/^POST \/token$/, 503, { error: 'backendError' });
    const e = await client().rafraichir('x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurGoogle);
    expect((e as ErreurGoogle).constructor).toBe(ErreurGoogle);
    faux.forcer(/^POST \/revoke$/, 400, { error: 'invalid_token' });
    await expect(client().revoquer('mort')).resolves.toBeUndefined();
  });
});
```

`apps/scheduler/test/calendrier.test.ts` :
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClientCalendrier, type CorpsEvenement } from '../src/google/calendrier.js';
import { DejaPresent, GoogleIndisponible, JetonRefuse } from '../src/google/erreurs.js';
import { FauxGoogle } from './faux-google.js';

let faux: FauxGoogle;
let cal: ClientCalendrier;
const corps: CorpsEvenement = {
  summary: 'dentiste',
  start: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: 'Europe/Paris' },
  end: { dateTime: '2026-10-14T10:30:00+02:00', timeZone: 'Europe/Paris' },
  reminders: { useDefault: false, overrides: [] },
};

beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); cal = new ClientCalendrier(`${faux.url}/calendar/v3`, fetch); });
afterAll(() => faux.arreter());
beforeEach(() => { faux.acces.add('acces-t'); faux.requetes.length = 0; });

describe('ClientCalendrier', () => {
  it('crée l\'agenda dédié au fuseau de Paris', async () => {
    const id = await cal.creerAgenda('acces-t', 'Organizer', 'Europe/Paris');
    expect(faux.agendas.get(id)).toMatchObject({ summary: 'Organizer', timeZone: 'Europe/Paris' });
    expect(faux.requetes[0]!.autorisation).toBe('Bearer acces-t');
    expect(await cal.agendaExiste('acces-t', id)).toBe(true);
    expect(await cal.agendaExiste('acces-t', 'inconnu@group.calendar.google.com')).toBe(false);
  });

  it('insère avec l\'identifiant donné ; la même insertion répond DejaPresent', async () => {
    const a = faux.agenda('agenda-a@group.calendar.google.com');
    await cal.inserer('acces-t', a, 'abcdef0123', corps);
    expect(faux.evenement(a, 'abcdef0123')?.corps).toEqual({ id: 'abcdef0123', ...corps });
    await expect(cal.inserer('acces-t', a, 'abcdef0123', corps)).rejects.toBeInstanceOf(DejaPresent);
  });

  it('lit, remplace, supprime ; une seconde suppression est sans erreur ; un inconnu se lit null', async () => {
    const a = faux.agenda('agenda-b@group.calendar.google.com');
    await cal.inserer('acces-t', a, 'ev00001', corps);
    await cal.remplacer('acces-t', a, 'ev00001', { ...corps, summary: 'dentiste lundi' });
    expect(faux.evenement(a, 'ev00001')?.corps.summary).toBe('dentiste lundi');
    await cal.supprimer('acces-t', a, 'ev00001');
    expect(await cal.lire('acces-t', a, 'ev00001')).toEqual({ id: 'ev00001', status: 'cancelled' });
    await expect(cal.supprimer('acces-t', a, 'ev00001')).resolves.toBeUndefined();
    expect(await cal.lire('acces-t', a, 'jamais0')).toBeNull();
  });

  it('401 : JetonRefuse ; 429 et 403 : GoogleIndisponible avec la raison technique seulement', async () => {
    const a = faux.agenda('agenda-c@group.calendar.google.com');
    await expect(cal.lire('perime', a, 'ev00001')).rejects.toBeInstanceOf(JetonRefuse);
    faux.forcer(/^POST /, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }], message: 'texte libre' } });
    const e = await cal.inserer('acces-t', a, 'ev00002', corps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GoogleIndisponible);
    expect((e as Error).message).toBe('Google HTTP 429 (rateLimitExceeded)');
    faux.forcer(/^POST /, 403, { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } });
    await expect(cal.inserer('acces-t', a, 'ev00003', corps)).rejects.toBeInstanceOf(GoogleIndisponible);
  });
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/oauth.test.ts apps/scheduler/test/calendrier.test.ts`
Expected: FAIL, modules `../src/google/*.js` introuvables.

- [ ] **Step 4: Écrire les clients**

`apps/scheduler/src/google/erreurs.ts` :
```ts
/** Erreur HTTP de Google. Le message ne porte que le statut et la raison technique, jamais un corps ni un jeton. */
export class ErreurGoogle extends Error {
  override name = 'ErreurGoogle';
  constructor(readonly statut: number, readonly raison: string | null) {
    super(`Google HTTP ${statut}${raison ? ` (${raison})` : ''}`);
  }
}
export class JetonRefuse extends ErreurGoogle { override name = 'JetonRefuse'; }
export class GoogleIndisponible extends ErreurGoogle { override name = 'GoogleIndisponible'; }
export class Introuvable extends ErreurGoogle { override name = 'Introuvable'; }
export class DejaPresent extends ErreurGoogle { override name = 'DejaPresent'; }
export class OctroiInvalide extends ErreurGoogle { override name = 'OctroiInvalide'; }
export class ClientRefuse extends ErreurGoogle { override name = 'ClientRefuse'; }

/** « rateLimitExceeded », « invalid_grant »… ; jamais `message` ni `error_description`, qui peuvent citer une donnée. */
export async function raisonDe(r: Response): Promise<string | null> {
  try {
    const c = (await r.json()) as { error?: string | { errors?: { reason?: unknown }[]; status?: unknown } };
    if (typeof c.error === 'string') return c.error.slice(0, 40);
    const raison = c.error?.errors?.[0]?.reason ?? c.error?.status;
    return typeof raison === 'string' ? raison.slice(0, 40) : null;
  } catch {
    return null;
  }
}

export async function erreurCalendrier(r: Response): Promise<ErreurGoogle> {
  const raison = await raisonDe(r);
  if (r.status === 401) return new JetonRefuse(401, raison);
  if (r.status === 403 || r.status === 429) return new GoogleIndisponible(r.status, raison);
  if (r.status === 404 || r.status === 410) return new Introuvable(r.status, raison);
  if (r.status === 409) return new DejaPresent(409, raison);
  return new ErreurGoogle(r.status, raison);
}
```

`apps/scheduler/src/google/oauth.ts` :
```ts
import { z } from 'zod';
import type { ConfigGoogle } from '../configuration.js';
import { ClientRefuse, ErreurGoogle, OctroiInvalide, raisonDe } from './erreurs.js';

export const PORTEE_AGENDA = 'https://www.googleapis.com/auth/calendar.app.created';
const DELAI_MS = 15_000;

const reponseJeton = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(''),
});

export interface JetonsObtenus { acces: string; expireDansS: number; rafraichissement: string | null; portees: string[] }

/** Serveur OAuth de Google (oauth2.googleapis.com). Aucun jeton n'est journalisé ni mis dans un message d'erreur. */
export class ClientOAuth {
  constructor(private readonly c: ConfigGoogle, private readonly f: typeof fetch) {}

  private poster(chemin: string, champs: Record<string, string>): Promise<Response> {
    return this.f(`${this.c.baseOauth}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(champs).toString(),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  }

  private async lireJetons(r: Response): Promise<JetonsObtenus> {
    if (!r.ok) {
      const raison = await raisonDe(r);
      if (raison === 'invalid_grant') throw new OctroiInvalide(r.status, raison);
      if (raison === 'invalid_client' || raison === 'unauthorized_client') throw new ClientRefuse(r.status, raison);
      throw new ErreurGoogle(r.status, raison);
    }
    const j = reponseJeton.parse(await r.json());
    return { acces: j.access_token, expireDansS: j.expires_in, rafraichissement: j.refresh_token ?? null, portees: j.scope.split(' ').filter(Boolean) };
  }

  async echanger(code: string, verificateur: string): Promise<JetonsObtenus> {
    return this.lireJetons(await this.poster('/token', {
      grant_type: 'authorization_code', code, code_verifier: verificateur,
      client_id: this.c.clientId, client_secret: this.c.clientSecret, redirect_uri: this.c.redirectUri,
    }));
  }

  async rafraichir(rafraichissement: string): Promise<{ acces: string; expireDansS: number }> {
    const j = await this.lireJetons(await this.poster('/token', {
      grant_type: 'refresh_token', refresh_token: rafraichissement, client_id: this.c.clientId, client_secret: this.c.clientSecret,
    }));
    return { acces: j.acces, expireDansS: j.expireDansS };
  }

  /** Révoque l'autorisation entière de ce compte. Un jeton déjà mort (400) compte comme révoqué. */
  async revoquer(jeton: string): Promise<void> {
    const r = await this.poster('/revoke', { token: jeton });
    await r.body?.cancel();
    if (r.ok || r.status === 400) return;
    throw new ErreurGoogle(r.status, null);
  }
}
```

`apps/scheduler/src/google/calendrier.ts` :
```ts
import { z } from 'zod';
import { erreurCalendrier, Introuvable } from './erreurs.js';

export interface CorpsEvenement {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
}
export interface EvenementLu { id: string; status: string }

const evenementLu = z.object({ id: z.string(), status: z.string().default('confirmed') });
const agendaCree = z.object({ id: z.string().min(1) });
const DELAI_MS = 15_000;

/** API Google Calendar v3, portée calendar.app.created : seuls l'agenda et les événements créés ici sont visibles. */
export class ClientCalendrier {
  constructor(private readonly base: string, private readonly f: typeof fetch) {}

  private async appeler(jeton: string, methode: string, chemin: string, corps?: unknown): Promise<Response> {
    const r = await this.f(`${this.base}${chemin}`, {
      method: methode,
      headers: {
        authorization: `Bearer ${jeton}`, accept: 'application/json',
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!r.ok) throw await erreurCalendrier(r);
    return r;
  }

  private static evenements(agenda: string, id?: string): string {
    return `/calendars/${encodeURIComponent(agenda)}/events${id ? `/${encodeURIComponent(id)}` : ''}`;
  }

  async creerAgenda(jeton: string, nom: string, fuseau: string): Promise<string> {
    const r = await this.appeler(jeton, 'POST', '/calendars', { summary: nom, timeZone: fuseau });
    return agendaCree.parse(await r.json()).id;
  }

  async agendaExiste(jeton: string, id: string): Promise<boolean> {
    try {
      const r = await this.appeler(jeton, 'GET', `/calendars/${encodeURIComponent(id)}`);
      await r.body?.cancel();
      return true;
    } catch (e) {
      if (e instanceof Introuvable) return false;
      throw e;
    }
  }

  async inserer(jeton: string, agenda: string, id: string, corps: CorpsEvenement): Promise<void> {
    const r = await this.appeler(jeton, 'POST', ClientCalendrier.evenements(agenda), { id, ...corps });
    await r.body?.cancel();
  }

  async lire(jeton: string, agenda: string, id: string): Promise<EvenementLu | null> {
    try {
      const r = await this.appeler(jeton, 'GET', ClientCalendrier.evenements(agenda, id));
      return evenementLu.parse(await r.json());
    } catch (e) {
      if (e instanceof Introuvable) return null;
      throw e;
    }
  }

  async remplacer(jeton: string, agenda: string, id: string, corps: CorpsEvenement): Promise<void> {
    const r = await this.appeler(jeton, 'PUT', ClientCalendrier.evenements(agenda, id), { id, ...corps });
    await r.body?.cancel();
  }

  /** Déjà supprimé (410) ou inconnu (404) : rien à faire. */
  async supprimer(jeton: string, agenda: string, id: string): Promise<void> {
    try {
      const r = await this.appeler(jeton, 'DELETE', ClientCalendrier.evenements(agenda, id));
      await r.body?.cancel();
    } catch (e) {
      if (!(e instanceof Introuvable)) throw e;
    }
  }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck`
Expected: PASS.

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les clients Google du scheduler, sans bibliothèque Google : OAuth (échange PKCE, rafraîchissement, révocation) et Calendar v3 (agenda dédié, événements), erreurs classées sans jeton ni texte de Google ; faux serveur Google pour les tests (2026-10-05). »
```bash
git add apps/scheduler CHANGELOG.md
git commit -m "Ajoute les clients OAuth et Calendar du scheduler" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Contenu d'un événement et plan de synchronisation

**Files:**
- Create: `apps/scheduler/src/agenda/contenu.ts`, `apps/scheduler/src/agenda/plan.ts`
- Modify: `CHANGELOG.md`
- Test: `apps/scheduler/test/contenu.test.ts`, `apps/scheduler/test/plan.test.ts`

**Interfaces:**
- Consumes: `CorpsEvenement` (tâche 5), `isoLocal`, `titreCourt`, `MINUTES_ALARME` (`@organizer/shared`).
- Produces :
  - `DUREE_EVENEMENT_MS = 30 * 60_000` ;
  - `interface ActionPourAgenda { itemId: string; texte: string; nature: string; prive: boolean; archiveLe: Date | null; echeanceType: string | null; echeanceDate: Date | null; faitLe: Date | null; alarme: boolean; fuseau: string }` ;
  - `contenuEvenement(a: ActionPourAgenda): CorpsEvenement | null` (null : l'action ne doit pas être dans l'agenda) ;
  - `empreinteContenu(c: CorpsEvenement): string` (32 caractères hexadécimaux) ;
  - `idEvenement(itemId: string, generation: number): string` ;
  - `type Plan = { type: 'rien' } | { type: 'creer' } | { type: 'remplacer' } | { type: 'supprimer' }` ;
  - `interface EtatSynchro { contenu: CorpsEvenement | null; evenementId: string | null; calendrierId: string | null; empreinte: string | null }` ;
  - `PASSE_MAX_MS = 24 * 3600_000` ; `planifier(e: EtatSynchro, agendaCourant: string, maintenant: Date): Plan`.

- [ ] **Step 1: Écrire les tests**

`apps/scheduler/test/contenu.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { contenuEvenement, empreinteContenu, idEvenement, type ActionPourAgenda } from '../src/agenda/contenu.js';

const action = (plus: Partial<ActionPourAgenda> = {}): ActionPourAgenda => ({
  itemId: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', texte: 'dentiste pour la petite', nature: 'action', prive: false,
  archiveLe: null, echeanceType: 'datee', echeanceDate: new Date('2026-10-14T08:00:00Z'), faitLe: null, alarme: false,
  fuseau: 'Europe/Paris', ...plus,
});

describe('contenuEvenement', () => {
  it('rendez-vous daté : titre court, 30 minutes, fuseau de Paris, aucun rappel, aucune description', () => {
    const c = contenuEvenement(action())!;
    expect(c).toEqual({
      summary: 'dentiste pour la petite',
      start: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-10-14T10:30:00+02:00', timeZone: 'Europe/Paris' },
      reminders: { useDefault: false, overrides: [] },
    });
    expect(Object.keys(c)).not.toContain('description');
  });

  it('alarme demandée : un rappel 10 minutes avant, rien d\'autre', () => {
    expect(contenuEvenement(action({ alarme: true }))!.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
  });

  it('changements d\'heure : décalage d\'hiver le 25 octobre, d\'été le 28 mars', () => {
    expect(contenuEvenement(action({ echeanceDate: new Date('2026-10-25T09:00:00Z') }))!.start.dateTime).toBe('2026-10-25T10:00:00+01:00');
    expect(contenuEvenement(action({ echeanceDate: new Date('2027-03-28T08:00:00Z') }))!.start.dateTime).toBe('2027-03-28T10:00:00+02:00');
  });

  it('02:45 la nuit du passage à l\'heure d\'hiver : 30 minutes réelles, fin à 02:15 en heure d\'hiver', () => {
    const c = contenuEvenement(action({ echeanceDate: new Date('2026-10-25T00:45:00Z') }))!;
    expect(c.start.dateTime).toBe('2026-10-25T02:45:00+02:00');
    expect(c.end.dateTime).toBe('2026-10-25T02:15:00+01:00');
    expect(Date.parse(c.end.dateTime) - Date.parse(c.start.dateTime)).toBe(30 * 60_000);
  });

  it.each([
    ['une pensée', { nature: 'pensee' }],
    ['une capture privée', { prive: true }],
    ['une action faite', { faitLe: new Date() }],
    ['un item archivé', { archiveLe: new Date() }],
    ['un jour sans heure', { echeanceType: 'jour' }],
    ['une fenêtre', { echeanceType: 'fenetre' }],
    ['un daté sans date', { echeanceDate: null }],
  ])('rien pour %s', (_cas, plus) => {
    expect(contenuEvenement(action(plus as Partial<ActionPourAgenda>))).toBeNull();
  });
});

describe('empreinteContenu et idEvenement', () => {
  it('l\'empreinte change avec l\'alarme, l\'heure ou le texte, pas sans raison', () => {
    const e = empreinteContenu(contenuEvenement(action())!);
    expect(e).toMatch(/^[0-9a-f]{32}$/);
    expect(empreinteContenu(contenuEvenement(action())!)).toBe(e);
    expect(empreinteContenu(contenuEvenement(action({ alarme: true }))!)).not.toBe(e);
    expect(empreinteContenu(contenuEvenement(action({ texte: 'dentiste' }))!)).not.toBe(e);
  });

  it('identifiant tiré de l\'item, caractères admis par Google, génération en suffixe', () => {
    expect(idEvenement('0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', 0)).toBe('0f8e2c1a1b2c4d5e8f90a1b2c3d4e5f6');
    expect(idEvenement('0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', 2)).toBe('0f8e2c1a1b2c4d5e8f90a1b2c3d4e5f6g2');
    expect(idEvenement('0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', 12)).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(() => idEvenement('pas-un-uuid', 0)).toThrow();
  });
});
```

`apps/scheduler/test/plan.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { contenuEvenement, empreinteContenu } from '../src/agenda/contenu.js';
import { planifier } from '../src/agenda/plan.js';

const MAINTENANT = new Date('2026-10-10T08:00:00Z');
const contenu = contenuEvenement({
  itemId: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', texte: 'dentiste', nature: 'action', prive: false, archiveLe: null,
  echeanceType: 'datee', echeanceDate: new Date('2026-10-14T08:00:00Z'), faitLe: null, alarme: false, fuseau: 'Europe/Paris',
})!;
const AG = 'agenda-1@group.calendar.google.com';
const synchro = { evenementId: 'ev', calendrierId: AG, empreinte: empreinteContenu(contenu) };
const vide = { evenementId: null, calendrierId: null, empreinte: null };

describe('planifier', () => {
  it('à jour : rien', () => {
    expect(planifier({ contenu, ...synchro }, AG, MAINTENANT)).toEqual({ type: 'rien' });
  });
  it('jamais écrit : créer', () => {
    expect(planifier({ contenu, ...vide }, AG, MAINTENANT)).toEqual({ type: 'creer' });
  });
  it('contenu changé : remplacer', () => {
    expect(planifier({ contenu, ...synchro, empreinte: 'autre' }, AG, MAINTENANT)).toEqual({ type: 'remplacer' });
  });
  it('plus éligible avec un événement : supprimer ; sans événement : rien', () => {
    expect(planifier({ contenu: null, ...synchro }, AG, MAINTENANT)).toEqual({ type: 'supprimer' });
    expect(planifier({ contenu: null, ...vide }, AG, MAINTENANT)).toEqual({ type: 'rien' });
  });
  it('événement dans un ancien agenda (reconnexion) : créer dans le nouveau', () => {
    expect(planifier({ contenu, ...synchro, calendrierId: 'ancien@group.calendar.google.com' }, AG, MAINTENANT)).toEqual({ type: 'creer' });
  });
  it('rendez-vous commencé depuis plus de 24 h et jamais écrit : rien ; depuis moins : créer', () => {
    expect(planifier({ contenu, ...vide }, AG, new Date('2026-10-15T08:01:00Z'))).toEqual({ type: 'rien' });
    expect(planifier({ contenu, ...vide }, AG, new Date('2026-10-15T07:59:00Z'))).toEqual({ type: 'creer' });
  });
  it('un événement existant suit son action même passée', () => {
    expect(planifier({ contenu, ...synchro, empreinte: 'autre' }, AG, new Date('2027-01-01T00:00:00Z'))).toEqual({ type: 'remplacer' });
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/contenu.test.ts apps/scheduler/test/plan.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 3: Écrire le code**

`apps/scheduler/src/agenda/contenu.ts` :
```ts
import { createHash } from 'node:crypto';
import { isoLocal, MINUTES_ALARME, titreCourt } from '@organizer/shared';
import type { CorpsEvenement } from '../google/calendrier.js';

export const DUREE_EVENEMENT_MS = 30 * 60_000;

export interface ActionPourAgenda {
  itemId: string;
  texte: string;
  nature: string;
  prive: boolean;
  archiveLe: Date | null;
  echeanceType: string | null;
  echeanceDate: Date | null;
  faitLe: Date | null;
  alarme: boolean;
  fuseau: string;
}

/**
 * L'événement que l'agenda doit montrer pour cette action, ou null. Seulement un rendez-vous daté du flux Actions,
 * jamais une pensée ni une capture privée ; titre court, jamais de description ; rappel seulement si L l'a demandé.
 */
export function contenuEvenement(a: ActionPourAgenda): CorpsEvenement | null {
  if (a.nature !== 'action' || a.prive || a.archiveLe || a.faitLe || a.echeanceType !== 'datee' || !a.echeanceDate) return null;
  const fin = new Date(a.echeanceDate.getTime() + DUREE_EVENEMENT_MS);
  return {
    summary: titreCourt(a.texte),
    start: { dateTime: isoLocal(a.echeanceDate, a.fuseau), timeZone: a.fuseau },
    end: { dateTime: isoLocal(fin, a.fuseau), timeZone: a.fuseau },
    reminders: { useDefault: false, overrides: a.alarme ? [{ method: 'popup', minutes: MINUTES_ALARME }] : [] },
  };
}

/** Empreinte de ce qui est écrit dans Google : la comparer évite tout appel quand rien n'a changé. */
export function empreinteContenu(c: CorpsEvenement): string {
  return createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 32);
}

/**
 * Identifiant déterministe : l'UUID de l'item sans tirets (hexadécimal, admis par Google : 0-9 et a-v),
 * puis « g<n> » après une suppression, car Google garde l'identifiant d'un événement supprimé.
 */
export function idEvenement(itemId: string, generation: number): string {
  const base = itemId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(base)) throw new Error("Identifiant d'item inattendu");
  return generation === 0 ? base : `${base}g${generation}`;
}
```

`apps/scheduler/src/agenda/plan.ts` :
```ts
import type { CorpsEvenement } from '../google/calendrier.js';
import { empreinteContenu } from './contenu.js';

export type Plan = { type: 'rien' } | { type: 'creer' } | { type: 'remplacer' } | { type: 'supprimer' };

export interface EtatSynchro {
  contenu: CorpsEvenement | null;
  evenementId: string | null;
  calendrierId: string | null;
  empreinte: string | null;
}

/** Jamais de création pour un rendez-vous commencé depuis plus longtemps : la première connexion n'importe pas le passé. */
export const PASSE_MAX_MS = 24 * 3600_000;

/** L'écart entre l'action et son événement, sans aucun appel à Google. */
export function planifier(e: EtatSynchro, agendaCourant: string, maintenant: Date): Plan {
  if (!e.contenu) return e.evenementId ? { type: 'supprimer' } : { type: 'rien' };
  if (e.evenementId && e.calendrierId === agendaCourant) {
    return e.empreinte === empreinteContenu(e.contenu) ? { type: 'rien' } : { type: 'remplacer' };
  }
  if (Date.parse(e.contenu.start.dateTime) < maintenant.getTime() - PASSE_MAX_MS) return { type: 'rien' };
  return { type: 'creer' };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck`
Expected: PASS.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Le contenu d'un événement (titre court, 30 minutes, fuseau de Paris, rappel de 10 minutes seulement avec l'alarme, jamais de description ni de pensée) et le plan de synchronisation sans appel à Google ; changements d'heure testés (2026-10-05). »
```bash
git add apps/scheduler CHANGELOG.md
git commit -m "Ajoute le contenu des événements et le plan de synchronisation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Synchroniser une action avec son événement

**Files:**
- Create: `apps/scheduler/src/agenda/jetons.ts`, `apps/scheduler/src/agenda/synchroniser.ts`, `apps/scheduler/test/aides.ts`
- Modify: `CHANGELOG.md`
- Test: `apps/scheduler/test/synchroniser.test.ts`

**Interfaces:**
- Consumes: `prisma.agendaGoogle`, colonnes `evenement_*` (tâche 2) ; `dechiffrer` (tâche 4) ; `ClientOAuth`, `ClientCalendrier`, erreurs (tâche 5) ; `contenuEvenement`, `empreinteContenu`, `idEvenement`, `planifier` (tâche 6).
- Produces :
  - `class NonConnecte extends Error` ; `class AutorisationRetiree extends Error { utilisateurId: string }` ;
  - `class Jetons(prisma, oauth: Pick<ClientOAuth, 'rafraichir'>, cle: Buffer, maintenant?)` : `retenir(uid, acces, expireDansS): void`, `oublier(uid): void`, `acces(uid): Promise<string>`, `rafraichir(uid): Promise<string>` ;
  - `appelerAvecJeton<T>(jetons: Jetons, uid: string, f: (jeton: string) => Promise<T>): Promise<T>` ;
  - `class AgendaSupprime extends Error { utilisateurId: string }` ;
  - `inclusionAction`, `type ActionChargee`, `versActionPourAgenda(a: ActionChargee): ActionPourAgenda`, `etatSynchro(a: ActionChargee): EtatSynchro` ;
  - `interface DepsSynchro { prisma: PrismaClient; calendrier: ClientCalendrier; jetons: Jetons; maintenant?: () => Date }` ;
  - `type IssueSynchro = 'rien' | 'cree' | 'remplace' | 'supprime' | 'sans_agenda'` ; `synchroniserAction(itemId: string, d: DepsSynchro): Promise<IssueSynchro>` ;
  - aides de test : `CLE`, `CONFIG_GOOGLE(faux)`, `compteConnecte(prisma, faux, nom?)`, `actionDatee(prisma, uid, o?)`, `depsSynchro(prisma, faux, maintenant?)`.

- [ ] **Step 1: Écrire les aides de test**

`apps/scheduler/test/aides.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { Jetons } from '../src/agenda/jetons.js';
import type { DepsSynchro } from '../src/agenda/synchroniser.js';
import { chiffrer } from '../src/chiffre.js';
import type { ConfigGoogle } from '../src/configuration.js';
import { ClientCalendrier } from '../src/google/calendrier.js';
import { ClientOAuth } from '../src/google/oauth.js';
import { SECRET_ESSAI, type FauxGoogle } from './faux-google.js';

export const CLE = Buffer.alloc(32, 3);
export const MAINTENANT = new Date('2026-10-10T08:00:00Z');

export const CONFIG_GOOGLE = (faux: FauxGoogle): ConfigGoogle => ({
  clientId: 'id.apps.googleusercontent.com', clientSecret: SECRET_ESSAI, redirectUri: 'https://organizer.essai/api/agenda/retour',
  baseOauth: faux.url, baseCalendrier: `${faux.url}/calendar/v3`,
});

/** Compte fabriqué, connecté : jeton de rafraîchissement chiffré en base, agenda existant chez le faux Google. */
export async function compteConnecte(prisma: PrismaClient, faux: FauxGoogle, nom = 'l'): Promise<{ uid: string; agenda: string }> {
  const u = await prisma.utilisateur.create({ data: { nom } });
  const rafr = `rafr-${nom}`;
  faux.connecte(rafr);
  const agenda = faux.agenda(`agenda-${nom}@group.calendar.google.com`);
  await prisma.agendaGoogle.create({
    data: { utilisateurId: u.id, etat: 'connecte', jetonChiffre: chiffrer(rafr, CLE, u.id), calendrierId: agenda, connecteLe: MAINTENANT, rafraichiLe: MAINTENANT },
  });
  return { uid: u.id, agenda };
}

/** Action fabriquée d'une capture Telegram ordinaire ; par défaut un rendez-vous daté le 14 octobre à 10:00. */
export async function actionDatee(
  prisma: PrismaClient, uid: string,
  o: { texte?: string; date?: string | null; type?: string; alarme?: boolean; nature?: 'action' | 'pensee'; prive?: boolean } = {},
): Promise<string> {
  const c = await prisma.capture.create({
    data: { utilisateurId: uid, canal: 'telegram', prive: o.prive ?? false, etat: 'classee', emisLe: MAINTENANT, texteEcrit: 'x' },
  });
  const it = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: o.texte ?? 'dentiste', nature: o.nature ?? 'action',
      confiance: { nature: 0.9, echeance: 0.9, theme: 0.9 }, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
      action: {
        create: {
          echeanceType: o.type ?? 'datee', alarme: o.alarme ?? false,
          echeanceDate: o.date === null ? null : new Date(o.date ?? '2026-10-14T08:00:00Z'),
        },
      },
    },
  });
  return it.id;
}

export function depsSynchro(prisma: PrismaClient, faux: FauxGoogle, maintenant: () => Date = () => MAINTENANT): DepsSynchro & { jetons: Jetons; oauth: ClientOAuth } {
  const oauth = new ClientOAuth(CONFIG_GOOGLE(faux), fetch);
  return { prisma, oauth, calendrier: new ClientCalendrier(`${faux.url}/calendar/v3`, fetch), jetons: new Jetons(prisma, oauth, CLE, maintenant), maintenant };
}
```

- [ ] **Step 2: Écrire le test**

`apps/scheduler/test/synchroniser.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AutorisationRetiree } from '../src/agenda/jetons.js';
import { AgendaSupprime, synchroniserAction } from '../src/agenda/synchroniser.js';
import { GoogleIndisponible } from '../src/google/erreurs.js';
import { actionDatee, compteConnecte, depsSynchro } from './aides.js';
import { FauxGoogle } from './faux-google.js';

const prisma = creerPrisma();
let faux: FauxGoogle;
beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.requetes.length = 0; });

const hex = (id: string) => id.replace(/-/g, '');
const action = (itemId: string) => prisma.action.findUniqueOrThrow({ where: { itemId } });
const appelsAgenda = () => faux.requetes.filter((r) => r.chemin.startsWith('/calendar/'));

describe('synchroniserAction', () => {
  it('crée un événement silencieux, sans description ; un second passage ne touche pas Google', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid, { texte: 'dentiste pour la petite' });
    const d = depsSynchro(prisma, faux);
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    const ev = faux.evenement(agenda, hex(itemId))!;
    expect(ev.corps).toEqual({
      id: hex(itemId), summary: 'dentiste pour la petite',
      start: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-10-14T10:30:00+02:00', timeZone: 'Europe/Paris' },
      reminders: { useDefault: false, overrides: [] },
    });
    expect(await action(itemId)).toMatchObject({ evenementId: hex(itemId), evenementCalendrierId: agenda, evenementGeneration: 0 });
    const avant = appelsAgenda().length;
    expect(await synchroniserAction(itemId, d)).toBe('rien');
    expect(appelsAgenda().length).toBe(avant);
  });

  it('alarme activée : le même événement reçoit un rappel de 10 minutes', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    await prisma.action.update({ where: { itemId }, data: { alarme: true } });
    expect(await synchroniserAction(itemId, d)).toBe('remplace');
    expect(faux.evenement(agenda, hex(itemId))!.corps.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
    expect(faux.agendas.get(agenda)!.evenements.size).toBe(1);
  });

  it('cochée : l\'événement est supprimé ; décochée : un nouvel événement sous la génération suivante', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    await prisma.action.update({ where: { itemId }, data: { faitLe: new Date() } });
    expect(await synchroniserAction(itemId, d)).toBe('supprime');
    expect(faux.evenement(agenda, hex(itemId))!.status).toBe('cancelled');
    expect(await action(itemId)).toMatchObject({ evenementId: null, evenementEmpreinte: null, evenementGeneration: 1 });
    await prisma.action.update({ where: { itemId }, data: { faitLe: null } });
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    expect(faux.evenement(agenda, `${hex(itemId)}g1`)!.status).toBe('confirmed');
  });

  it('supprimé par L dans Google : rien tant que l\'action ne change pas, puis un nouvel événement', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    faux.supprimerParL(agenda, hex(itemId));
    expect(await synchroniserAction(itemId, d)).toBe('rien');
    expect(faux.evenement(agenda, hex(itemId))!.status).toBe('cancelled');
    await prisma.action.update({ where: { itemId }, data: { echeanceDate: new Date('2026-10-15T08:00:00Z') } });
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    expect(faux.evenement(agenda, `${hex(itemId)}g1`)!.corps.start).toEqual({ dateTime: '2026-10-15T10:00:00+02:00', timeZone: 'Europe/Paris' });
    expect(await action(itemId)).toMatchObject({ evenementId: `${hex(itemId)}g1`, evenementGeneration: 1 });
  });

  it('corrigée en pensée : l\'événement part ; une pensée n\'en a jamais', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const pensee = await actionDatee(prisma, uid, { nature: 'pensee' });
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    await prisma.item.update({ where: { id: itemId }, data: { nature: 'pensee' } });
    expect(await synchroniserAction(itemId, d)).toBe('supprime');
    expect(await synchroniserAction(pensee, d)).toBe('rien');
    expect(faux.evenement(agenda, hex(pensee))).toBeUndefined();
  });

  it('insertion déjà faite (réponse perdue) : remplacée, jamais en double', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.agendas.get(agenda)!.evenements.set(hex(itemId), { id: hex(itemId), status: 'confirmed', corps: { summary: 'ancien' } });
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('cree');
    expect(faux.agendas.get(agenda)!.evenements.size).toBe(1);
    expect(faux.evenement(agenda, hex(itemId))!.corps.summary).toBe('dentiste');
  });

  it('jeton d\'accès périmé (401) : un nouveau jeton, un second essai', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    d.jetons.retenir(uid, 'perime', 3600);
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    expect(faux.evenement(agenda, hex(itemId))).toBeDefined();
  });

  it('autorisation retirée : état revoque, jeton effacé, AutorisationRetiree', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.rafraichissements.clear();
    await expect(synchroniserAction(itemId, depsSynchro(prisma, faux))).rejects.toBeInstanceOf(AutorisationRetiree);
    expect(await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).toMatchObject({ etat: 'revoque', jetonChiffre: null });
  });

  it('agenda Organizer supprimé par L : état agenda_supprime, AgendaSupprime, rien d\'écrit', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.agendas.delete(agenda);
    await expect(synchroniserAction(itemId, depsSynchro(prisma, faux))).rejects.toBeInstanceOf(AgendaSupprime);
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('agenda_supprime');
    expect((await action(itemId)).evenementId).toBeNull();
  });

  it('compte sans agenda connecté : aucun appel à Google', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const itemId = await actionDatee(prisma, u.id);
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('sans_agenda');
    expect(faux.requetes).toHaveLength(0);
  });

  it('rendez-vous passé depuis plus de 24 h : jamais créé', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid, { date: '2026-10-01T08:00:00Z' });
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('rien');
    expect(appelsAgenda()).toHaveLength(0);
  });

  it('429 : GoogleIndisponible remonte, rien n\'est noté en base', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.forcer(/^POST \/calendar\//, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } });
    await expect(synchroniserAction(itemId, depsSynchro(prisma, faux))).rejects.toBeInstanceOf(GoogleIndisponible);
    expect((await action(itemId)).evenementId).toBeNull();
  });
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/synchroniser.test.ts`
Expected: FAIL, modules `../src/agenda/jetons.js` et `synchroniser.js` introuvables.

- [ ] **Step 4: Écrire le code**

`apps/scheduler/src/agenda/jetons.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { dechiffrer } from '../chiffre.js';
import { JetonRefuse, OctroiInvalide } from '../google/erreurs.js';
import type { ClientOAuth } from '../google/oauth.js';

export class NonConnecte extends Error {
  override name = 'NonConnecte';
}

export class AutorisationRetiree extends Error {
  override name = 'AutorisationRetiree';
  constructor(readonly utilisateurId: string) {
    super(`Autorisation Google retirée ou expirée pour ${utilisateurId}`);
  }
}

/** Marge avant expiration d'un jeton d'accès (une heure chez Google) : on le renouvelle une minute avant. */
const MARGE_MS = 60_000;

/** Jetons d'accès en mémoire seulement ; le jeton de rafraîchissement reste chiffré en base, lu au besoin. */
export class Jetons {
  private readonly cache = new Map<string, { acces: string; expireA: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly oauth: Pick<ClientOAuth, 'rafraichir'>,
    private readonly cle: Buffer,
    private readonly maintenant: () => Date = () => new Date(),
  ) {}

  retenir(uid: string, acces: string, expireDansS: number): void {
    this.cache.set(uid, { acces, expireA: this.maintenant().getTime() + expireDansS * 1000 });
  }

  oublier(uid: string): void {
    this.cache.delete(uid);
  }

  async acces(uid: string): Promise<string> {
    const c = this.cache.get(uid);
    if (c && c.expireA - MARGE_MS > this.maintenant().getTime()) return c.acces;
    return this.rafraichir(uid);
  }

  /**
   * Nouveau jeton d'accès. Jeton mort chez Google (invalid_grant), ou illisible (clé changée) : la connexion passe
   * en `revoque` et le jeton est effacé ; seule une reconnexion par L la rétablit.
   */
  async rafraichir(uid: string): Promise<string> {
    const a = await this.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid } });
    if (!a || a.etat !== 'connecte' || !a.jetonChiffre) throw new NonConnecte(uid);
    let r: { acces: string; expireDansS: number };
    try {
      let rafraichissement: string;
      try {
        rafraichissement = dechiffrer(a.jetonChiffre, this.cle, uid);
      } catch {
        throw new OctroiInvalide(0, 'jeton_illisible');
      }
      r = await this.oauth.rafraichir(rafraichissement);
    } catch (e) {
      if (!(e instanceof OctroiInvalide)) throw e;
      this.oublier(uid);
      await this.prisma.agendaGoogle.updateMany({
        where: { utilisateurId: uid, etat: 'connecte' }, data: { etat: 'revoque', jetonChiffre: null, erreur: null },
      });
      throw new AutorisationRetiree(uid);
    }
    this.retenir(uid, r.acces, r.expireDansS);
    await this.prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { rafraichiLe: this.maintenant() } });
    return r.acces;
  }
}

/** Un 401 de l'agenda : on oublie le jeton d'accès, on en obtient un neuf et on réessaie une fois. */
export async function appelerAvecJeton<T>(jetons: Jetons, uid: string, f: (jeton: string) => Promise<T>): Promise<T> {
  try {
    return await f(await jetons.acces(uid));
  } catch (e) {
    if (!(e instanceof JetonRefuse)) throw e;
    jetons.oublier(uid);
    return f(await jetons.rafraichir(uid));
  }
}
```

`apps/scheduler/src/agenda/synchroniser.ts` :
```ts
import type { Prisma, PrismaClient } from '@organizer/db';
import type { ClientCalendrier, CorpsEvenement } from '../google/calendrier.js';
import { DejaPresent, Introuvable } from '../google/erreurs.js';
import { contenuEvenement, empreinteContenu, idEvenement, type ActionPourAgenda } from './contenu.js';
import { appelerAvecJeton, type Jetons } from './jetons.js';
import { planifier, type EtatSynchro } from './plan.js';

export class AgendaSupprime extends Error {
  override name = 'AgendaSupprime';
  constructor(readonly utilisateurId: string) {
    super(`Agenda Organizer supprimé pour ${utilisateurId}`);
  }
}

export interface DepsSynchro { prisma: PrismaClient; calendrier: ClientCalendrier; jetons: Jetons; maintenant?: () => Date }
export type IssueSynchro = 'rien' | 'cree' | 'remplace' | 'supprime' | 'sans_agenda';

export const inclusionAction = {
  item: { include: { capture: { include: { utilisateur: { include: { agenda: true } } } } } },
} satisfies Prisma.ActionInclude;
export type ActionChargee = Prisma.ActionGetPayload<{ include: typeof inclusionAction }>;

export function versActionPourAgenda(a: ActionChargee): ActionPourAgenda {
  return {
    itemId: a.itemId, texte: a.item.texte, nature: a.item.nature, prive: a.item.capture.prive, archiveLe: a.item.archiveLe,
    echeanceType: a.echeanceType, echeanceDate: a.echeanceDate, faitLe: a.faitLe, alarme: a.alarme,
    fuseau: a.item.capture.utilisateur.fuseau,
  };
}

export function etatSynchro(a: ActionChargee): EtatSynchro {
  return {
    contenu: contenuEvenement(versActionPourAgenda(a)),
    evenementId: a.evenementId, calendrierId: a.evenementCalendrierId, empreinte: a.evenementEmpreinte,
  };
}

/** Une insertion qui répond 404 : l'agenda a-t-il disparu (supprimé par L) ? */
async function verifierAgenda(d: DepsSynchro, uid: string, agenda: string): Promise<void> {
  if (await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.agendaExiste(j, agenda))) return;
  await d.prisma.agendaGoogle.updateMany({ where: { utilisateurId: uid, calendrierId: agenda }, data: { etat: 'agenda_supprime' } });
  throw new AgendaSupprime(uid);
}

/** Insère sous la génération donnée ; un 409 sur notre propre événement devient un remplacement. Renvoie la génération écrite. */
async function creer(d: DepsSynchro, uid: string, agenda: string, itemId: string, corps: CorpsEvenement, generation: number): Promise<number> {
  for (let g = generation; g < generation + 3; g++) {
    const id = idEvenement(itemId, g);
    try {
      await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.inserer(j, agenda, id, corps));
      return g;
    } catch (e) {
      if (e instanceof Introuvable) {
        await verifierAgenda(d, uid, agenda);
        throw e;
      }
      if (!(e instanceof DejaPresent)) throw e;
      const lu = await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.lire(j, agenda, id));
      if (lu && lu.status !== 'cancelled') {
        await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.remplacer(j, agenda, id, corps));
        return g;
      }
      // Identifiant gardé par Google pour un événement supprimé : génération suivante.
    }
  }
  throw new Error(`Événement de l'item ${itemId} : trois identifiants déjà pris`);
}

/**
 * Réconcilie une action avec son événement : relit l'état en base, ne fait que l'écart, note le résultat.
 * Idempotent : rejoué, il ne fait rien de plus. Jamais un titre ni un jeton dans un journal.
 */
export async function synchroniserAction(itemId: string, d: DepsSynchro): Promise<IssueSynchro> {
  const a = await d.prisma.action.findUnique({ where: { itemId }, include: inclusionAction });
  if (!a) return 'rien';
  const uid = a.item.capture.utilisateurId;
  const g = a.item.capture.utilisateur.agenda;
  if (!g || g.etat !== 'connecte' || !g.calendrierId) return 'sans_agenda';
  const agenda = g.calendrierId;
  const etat = etatSynchro(a);
  const plan = planifier(etat, agenda, (d.maintenant ?? (() => new Date()))());
  if (plan.type === 'rien') return 'rien';

  if (plan.type === 'supprimer') {
    await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.supprimer(j, a.evenementCalendrierId!, a.evenementId!));
    await d.prisma.action.update({
      where: { itemId },
      data: { evenementId: null, evenementCalendrierId: null, evenementEmpreinte: null, evenementGeneration: a.evenementGeneration + 1 },
    });
    return 'supprime';
  }

  const corps = etat.contenu!;
  let generation = a.evenementGeneration;
  if (plan.type === 'remplacer') {
    const lu = await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.lire(j, agenda, a.evenementId!));
    if (lu && lu.status !== 'cancelled') {
      await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.remplacer(j, agenda, a.evenementId!, corps));
      await d.prisma.action.update({ where: { itemId }, data: { evenementEmpreinte: empreinteContenu(corps) } });
      return 'remplace';
    }
    // Supprimé par L dans Google, et l'action a changé depuis : un nouvel événement la suit.
    generation += 1;
  }
  const ecrite = await creer(d, uid, agenda, itemId, corps, generation);
  await d.prisma.action.update({
    where: { itemId },
    data: {
      evenementId: idEvenement(itemId, ecrite), evenementCalendrierId: agenda,
      evenementEmpreinte: empreinteContenu(corps), evenementGeneration: ecrite,
    },
  });
  return 'cree';
}
```

- [ ] **Step 5: Lancer les tests**

Run (tunnel ouvert) : `pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La synchronisation d'une action avec son événement Google : création, remplacement, suppression au cochage, identifiant déterministe et génération suivante après une suppression, rien de recréé tant que l'action ne change pas, nouveau jeton sur un 401, autorisation retirée ou agenda supprimé notés en base (2026-10-05). »
```bash
git add apps/scheduler CHANGELOG.md
git commit -m "Ajoute la synchronisation des actions avec Google Agenda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Connexion, déconnexion et balayage côté scheduler

**Files:**
- Create: `apps/scheduler/src/agenda/connexion.ts`, `apps/scheduler/src/agenda/balayer.ts`
- Modify: `CHANGELOG.md`
- Test: `apps/scheduler/test/connexion.test.ts`, `apps/scheduler/test/balayer.test.ts`

**Interfaces:**
- Consumes: `chiffrer`, `dechiffrer` (tâche 4) ; `ClientOAuth`, `PORTEE_AGENDA`, `ClientCalendrier`, `OctroiInvalide` (tâche 5) ; `planifier` (tâche 6) ; `Jetons`, `AutorisationRetiree`, `inclusionAction`, `etatSynchro`, `synchroniserAction` (tâche 7).
- Produces :
  - `NOM_AGENDA = 'Organizer'` ;
  - `interface DepsConnexion { prisma: PrismaClient; oauth: ClientOAuth; calendrier: ClientCalendrier; jetons: Jetons; cle: Buffer; enfilerBalayage(utilisateurId: string): Promise<void>; maintenant?: () => Date }` ;
  - `type IssueEchange = 'connecte' | 'portee_refusee' | 'echange' | 'ignore'` ; `echangerCode(j: { utilisateurId: string; code: string; verificateur: string }, d: DepsConnexion): Promise<IssueEchange>` ;
  - `deconnecterAgenda(uid: string, d: DepsConnexion): Promise<void>` ; `abandonnerDeconnexion(uid: string, d: Pick<DepsConnexion, 'prisma' | 'jetons'>): Promise<void>` ;
  - `ENTRETIEN_MS = 7 jours` ; `interface DepsBalayage { prisma: PrismaClient; jetons: Pick<Jetons, 'rafraichir'>; enfiler(itemId: string): Promise<void>; surRevocation?(uid: string): Promise<void>; maintenant?: () => Date }` ; `balayer(d: DepsBalayage, utilisateurId?: string): Promise<number>` (nombre d'items enfilés).

- [ ] **Step 1: Écrire les tests**

`apps/scheduler/test/connexion.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deconnecterAgenda, echangerCode, type DepsConnexion } from '../src/agenda/connexion.js';
import { dechiffrer } from '../src/chiffre.js';
import { ErreurGoogle } from '../src/google/erreurs.js';
import { CLE, compteConnecte, depsSynchro } from './aides.js';
import { FauxGoogle, PORTEE } from './faux-google.js';

const prisma = creerPrisma();
let faux: FauxGoogle;
let balayages: string[];
beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.requetes.length = 0; faux.revoques.length = 0; balayages = []; });

const deps = (): DepsConnexion => ({ ...depsSynchro(prisma, faux), cle: CLE, enfilerBalayage: async (uid) => { balayages.push(uid); } });
async function enCours(nom = 'l'): Promise<string> {
  const u = await prisma.utilisateur.create({ data: { nom } });
  await prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'en_cours' } });
  return u.id;
}
const ligne = (uid: string) => prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } });

describe('echangerCode', () => {
  it('connecte : agenda « Organizer » à Paris, jeton chiffré, balayage enfilé', async () => {
    const uid = await enCours();
    faux.codes.set('code-ok', { portee: PORTEE, verificateur: 'verif' });
    expect(await echangerCode({ utilisateurId: uid, code: 'code-ok', verificateur: 'verif' }, deps())).toBe('connecte');
    const a = await ligne(uid);
    expect(a).toMatchObject({ etat: 'connecte', erreur: null });
    expect(faux.agendas.get(a.calendrierId!)).toMatchObject({ summary: 'Organizer', timeZone: 'Europe/Paris' });
    expect(a.jetonChiffre).not.toMatch(/rafr-/);
    expect(dechiffrer(a.jetonChiffre!, CLE, uid)).toMatch(/^rafr-/);
    expect(balayages).toEqual([uid]);
  });

  it('reconnexion : l\'agenda existant est repris, pas recréé', async () => {
    const uid = await enCours();
    const agenda = faux.agenda('agenda-garde@group.calendar.google.com');
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { calendrierId: agenda } });
    faux.codes.set('code-re', { portee: PORTEE });
    const avant = faux.agendas.size;
    await echangerCode({ utilisateurId: uid, code: 'code-re', verificateur: 'v' }, deps());
    expect((await ligne(uid)).calendrierId).toBe(agenda);
    expect(faux.agendas.size).toBe(avant);
  });

  it('accès à l\'agenda décoché par L : rien gardé, autorisation révoquée, portee_refusee', async () => {
    const uid = await enCours();
    faux.codes.set('code-sans', { portee: 'openid' });
    const avant = faux.agendas.size;
    expect(await echangerCode({ utilisateurId: uid, code: 'code-sans', verificateur: 'v' }, deps())).toBe('portee_refusee');
    expect(await ligne(uid)).toMatchObject({ etat: 'echec', erreur: 'portee_refusee', jetonChiffre: null });
    expect(faux.revoques).toHaveLength(1);
    expect(faux.agendas.size).toBe(avant);
    expect(balayages).toEqual([]);
  });

  it('code refusé par Google : echec « echange », sans reprise', async () => {
    const uid = await enCours();
    expect(await echangerCode({ utilisateurId: uid, code: 'inconnu', verificateur: 'v' }, deps())).toBe('echange');
    expect(await ligne(uid)).toMatchObject({ etat: 'echec', erreur: 'echange' });
  });

  it('connexion annulée entre-temps (déconnexion demandée) : ignore, le code n\'est pas utilisé', async () => {
    const uid = await enCours();
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnexion' } });
    faux.codes.set('code-tard', { portee: PORTEE });
    expect(await echangerCode({ utilisateurId: uid, code: 'code-tard', verificateur: 'v' }, deps())).toBe('ignore');
    expect(faux.requetes).toHaveLength(0);
  });
});

describe('deconnecterAgenda', () => {
  it('révoque le vrai jeton, l\'efface, garde l\'agenda pour une reconnexion', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnexion' } });
    await deconnecterAgenda(uid, deps());
    expect(faux.revoques).toEqual(['rafr-l']);
    expect(await ligne(uid)).toMatchObject({ etat: 'deconnecte', jetonChiffre: null, calendrierId: agenda });
    expect(faux.agendas.has(agenda)).toBe(true);
  });

  it('Google en panne : l\'erreur remonte (reprise), le jeton reste pour le prochain essai', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnexion' } });
    faux.forcer(/^POST \/revoke$/, 503, {});
    await expect(deconnecterAgenda(uid, deps())).rejects.toBeInstanceOf(ErreurGoogle);
    expect((await ligne(uid)).jetonChiffre).not.toBeNull();
  });
});
```

`apps/scheduler/test/balayer.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { balayer } from '../src/agenda/balayer.js';
import { synchroniserAction } from '../src/agenda/synchroniser.js';
import { actionDatee, compteConnecte, depsSynchro, MAINTENANT } from './aides.js';
import { FauxGoogle } from './faux-google.js';

const prisma = creerPrisma();
let faux: FauxGoogle;
beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.requetes.length = 0; });

describe('balayer', () => {
  it('n\'enfile que les actions divergentes, sans appeler Google', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const d = depsSynchro(prisma, faux);
    const ajour = await actionDatee(prisma, uid, { texte: 'à jour' });
    await synchroniserAction(ajour, d);
    const cochee = await actionDatee(prisma, uid, { texte: 'cochée' });
    await synchroniserAction(cochee, d);
    await prisma.action.update({ where: { itemId: cochee }, data: { faitLe: MAINTENANT } });
    const nouvelle = await actionDatee(prisma, uid, { texte: 'nouvelle' });
    await actionDatee(prisma, uid, { texte: 'passée', date: '2026-10-01T08:00:00Z' });
    await actionDatee(prisma, uid, { texte: 'un jour', type: 'jour' });
    faux.requetes.length = 0;
    const enfiles: string[] = [];
    expect(await balayer({ prisma, jetons: d.jetons, enfiler: async (i) => { enfiles.push(i); }, maintenant: () => MAINTENANT })).toBe(2);
    expect(enfiles.sort()).toEqual([cochee, nouvelle].sort());
    expect(faux.requetes).toHaveLength(0);
  });

  it('ignore un compte non connecté ; filtre sur un compte quand on le demande', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'f' } });
    await actionDatee(prisma, u.id);
    const { uid } = await compteConnecte(prisma, faux);
    const sienne = await actionDatee(prisma, uid);
    const enfiles: string[] = [];
    const d = { prisma, jetons: depsSynchro(prisma, faux).jetons, enfiler: async (i: string) => { enfiles.push(i); }, maintenant: () => MAINTENANT };
    expect(await balayer(d, u.id)).toBe(0);
    expect(await balayer(d)).toBe(1);
    expect(enfiles).toEqual([sienne]);
  });

  it('entretient un jeton resté inutilisé 7 jours ; une révocation découverte est signalée', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { rafraichiLe: new Date('2026-10-01T00:00:00Z') } });
    const d = depsSynchro(prisma, faux);
    await balayer({ prisma, jetons: d.jetons, enfiler: async () => {}, maintenant: () => MAINTENANT });
    expect(faux.requetes.filter((r) => r.chemin === '/token')).toHaveLength(1);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { rafraichiLe: new Date('2026-10-01T00:00:00Z') } });
    faux.rafraichissements.clear();
    const revoques: string[] = [];
    await balayer({ prisma, jetons: d.jetons, enfiler: async () => {}, surRevocation: async (u) => { revoques.push(u); }, maintenant: () => MAINTENANT });
    expect(revoques).toEqual([uid]);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/connexion.test.ts apps/scheduler/test/balayer.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 3: Écrire le code**

`apps/scheduler/src/agenda/connexion.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { chiffrer, dechiffrer } from '../chiffre.js';
import type { ClientCalendrier } from '../google/calendrier.js';
import { OctroiInvalide } from '../google/erreurs.js';
import { PORTEE_AGENDA, type ClientOAuth, type JetonsObtenus } from '../google/oauth.js';
import type { Jetons } from './jetons.js';

export const NOM_AGENDA = 'Organizer';

export interface DepsConnexion {
  prisma: PrismaClient;
  oauth: ClientOAuth;
  calendrier: ClientCalendrier;
  jetons: Jetons;
  cle: Buffer;
  enfilerBalayage(utilisateurId: string): Promise<void>;
  maintenant?: () => Date;
}

export type IssueEchange = 'connecte' | 'portee_refusee' | 'echange' | 'ignore';

async function echec(d: DepsConnexion, uid: string, erreur: 'portee_refusee' | 'echange'): Promise<void> {
  await d.prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'echec', erreur, jetonChiffre: null } });
}

/**
 * Échange le code reçu par l'API contre les jetons, vérifie la portée, crée (ou reprend) l'agenda dédié,
 * garde le jeton de rafraîchissement chiffré, puis enfile un balayage du compte. Le code n'est jamais journalisé.
 */
export async function echangerCode(j: { utilisateurId: string; code: string; verificateur: string }, d: DepsConnexion): Promise<IssueEchange> {
  const uid = j.utilisateurId;
  const a = await d.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid }, include: { utilisateur: true } });
  if (!a || a.etat !== 'en_cours') return 'ignore';
  let t: JetonsObtenus;
  try {
    t = await d.oauth.echanger(j.code, j.verificateur);
  } catch (e) {
    if (!(e instanceof OctroiInvalide)) throw e;
    await echec(d, uid, 'echange');
    return 'echange';
  }
  if (!t.portees.includes(PORTEE_AGENDA) || !t.rafraichissement) {
    // Révoquer l'autorisation partielle : rien ne doit rester actif chez Google pour une connexion refusée.
    await d.oauth.revoquer(t.rafraichissement ?? t.acces).catch(() => undefined);
    const raison = t.portees.includes(PORTEE_AGENDA) ? 'echange' : 'portee_refusee';
    await echec(d, uid, raison);
    return raison;
  }
  let agenda = a.calendrierId;
  if (!agenda || !(await d.calendrier.agendaExiste(t.acces, agenda))) {
    agenda = await d.calendrier.creerAgenda(t.acces, NOM_AGENDA, a.utilisateur.fuseau);
  }
  const maintenant = (d.maintenant ?? (() => new Date()))();
  await d.prisma.agendaGoogle.update({
    where: { utilisateurId: uid },
    data: {
      etat: 'connecte', erreur: null, jetonChiffre: chiffrer(t.rafraichissement, d.cle, uid),
      calendrierId: agenda, connecteLe: maintenant, rafraichiLe: maintenant,
    },
  });
  d.jetons.retenir(uid, t.acces, t.expireDansS);
  await d.enfilerBalayage(uid);
  return 'connecte';
}

/** Révoque chez Google puis efface le jeton. Panne de Google : l'erreur remonte, le job est repris. L'agenda reste. */
export async function deconnecterAgenda(uid: string, d: DepsConnexion): Promise<void> {
  const a = await d.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid } });
  if (!a || a.etat !== 'deconnexion') return;
  if (a.jetonChiffre) {
    let jeton: string | null = null;
    try {
      jeton = dechiffrer(a.jetonChiffre, d.cle, uid);
    } catch {
      jeton = null; // illisible (clé changée) : rien à révoquer d'ici
    }
    if (jeton) await d.oauth.revoquer(jeton);
  }
  d.jetons.oublier(uid);
  await d.prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnecte', jetonChiffre: null, erreur: null } });
}

/** Reprises épuisées : le jeton est effacé quand même ; l'administrateur est alerté (retrait manuel chez Google). */
export async function abandonnerDeconnexion(uid: string, d: Pick<DepsConnexion, 'prisma' | 'jetons'>): Promise<void> {
  d.jetons.oublier(uid);
  await d.prisma.agendaGoogle.updateMany({ where: { utilisateurId: uid, etat: 'deconnexion' }, data: { etat: 'deconnecte', jetonChiffre: null, erreur: null } });
}
```

`apps/scheduler/src/agenda/balayer.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { AutorisationRetiree, type Jetons } from './jetons.js';
import { planifier } from './plan.js';
import { etatSynchro, inclusionAction } from './synchroniser.js';

/** Un jeton de rafraîchissement inutilisé six mois expire chez Google : on le fait servir au moins chaque semaine. */
export const ENTRETIEN_MS = 7 * 24 * 3600_000;

export interface DepsBalayage {
  prisma: PrismaClient;
  jetons: Pick<Jetons, 'rafraichir'>;
  enfiler(itemId: string): Promise<void>;
  surRevocation?(uid: string): Promise<void>;
  maintenant?: () => Date;
}

/**
 * Filet de sécurité : recalcule l'écart de chaque action datée ou déjà synchronisée des comptes connectés
 * et n'enfile que les divergentes. Aucun appel à l'agenda ici ; seul l'entretien du jeton touche Google.
 */
export async function balayer(d: DepsBalayage, utilisateurId?: string): Promise<number> {
  const maintenant = (d.maintenant ?? (() => new Date()))();
  const comptes = await d.prisma.agendaGoogle.findMany({
    where: { etat: 'connecte', calendrierId: { not: null }, ...(utilisateurId ? { utilisateurId } : {}) },
  });
  let n = 0;
  for (const g of comptes) {
    const actions = await d.prisma.action.findMany({
      where: { item: { capture: { utilisateurId: g.utilisateurId } }, OR: [{ echeanceType: 'datee' }, { evenementId: { not: null } }] },
      include: inclusionAction,
    });
    for (const a of actions) {
      if (planifier(etatSynchro(a), g.calendrierId!, maintenant).type === 'rien') continue;
      await d.enfiler(a.itemId);
      n++;
    }
    if (!g.rafraichiLe || g.rafraichiLe.getTime() < maintenant.getTime() - ENTRETIEN_MS) {
      try {
        await d.jetons.rafraichir(g.utilisateurId);
      } catch (e) {
        if (e instanceof AutorisationRetiree) await d.surRevocation?.(g.utilisateurId);
        else console.error(`Agenda : entretien du jeton de ${g.utilisateurId} reporté (${(e as Error).name})`);
      }
    }
  }
  return n;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck`
Expected: PASS.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La connexion à Google Agenda côté scheduler : échange du code avec PKCE, portée vérifiée (refus calme si L décoche l'agenda), agenda « Organizer » créé ou repris, jeton chiffré ; la déconnexion révoque et efface le jeton, l'agenda reste ; un balayage n'enfile que les actions divergentes et entretient le jeton chaque semaine (2026-10-05). »
```bash
git add apps/scheduler CHANGELOG.md
git commit -m "Ajoute la connexion, la déconnexion et le balayage de l'agenda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: File du scheduler, alertes à l'administrateur et démarrage

**Files:**
- Create: `apps/scheduler/src/file.ts`
- Modify: `apps/scheduler/src/main.ts` (remplacé), `apps/scheduler/src/sonde.ts` (commande `agenda`), `CHANGELOG.md`
- Test: `apps/scheduler/test/file.test.ts`

**Interfaces:**
- Consumes: `FILE_AGENDA`, `FILE_ALERTES`, `JobAgenda`, `JobAlerte`, `OPTIONS_JOB_AGENDA`, `OPTIONS_JOB_ALERTE`, `enfilerSynchro` (`@organizer/shared`) ; tout `src/agenda/*` et `src/google/*`.
- Produces :
  - `class Signaleur(alerter)` : `une(cle, message): Promise<void>` (une alerte par constat), `retablir(cle): void` ;
  - `MESSAGES_ADMIN` (textes des alertes, repris dans `docs/exploitation.md`) ;
  - `interface DepsFileAgenda extends DepsSynchro, DepsConnexion { connexion: ConnectionOptions; alerter(message: string): Promise<void>; enfilerSynchro(itemId: string): Promise<void>; nomFile?: string; pauseMs?: number }` ;
  - `demarrerFileAgenda(d: DepsFileAgenda): Worker<JobAgenda>` (concurrence 1) ;
  - `dist/main.mjs` : journal « Scheduler démarré. » ; `dist/sonde.mjs agenda`.

- [ ] **Step 1: Écrire le test**

`apps/scheduler/test/file.test.ts` :
```ts
import { randomUUID } from 'node:crypto';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { type JobAgenda } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demarrerFileAgenda, MESSAGES_ADMIN } from '../src/file.js';
import { actionDatee, CLE, compteConnecte, depsSynchro } from './aides.js';
import { FauxGoogle } from './faux-google.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
let faux: FauxGoogle;
let nomFile: string;
let file: Queue<JobAgenda>;
let worker: Worker<JobAgenda> | undefined;
let alertes: string[];

beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); connexion.disconnect(); });
beforeEach(async () => {
  await viderBase(prisma);
  alertes = [];
  nomFile = `agenda-test-${randomUUID()}`;
  file = new Queue<JobAgenda>(nomFile, { connection: connexion });
});
afterEach(async () => { await worker?.close(); await file.obliterate({ force: true }); await file.close(); });

async function attendre(condition: () => Promise<boolean>, ms = 8000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('délai dépassé');
}

function lancer(): void {
  worker = demarrerFileAgenda({
    ...depsSynchro(prisma, faux), cle: CLE, connexion, nomFile, pauseMs: 300,
    alerter: async (m) => { alertes.push(m); },
    enfilerSynchro: async (itemId) => { await file.add('synchroniser', { type: 'synchroniser', itemId }); },
    enfilerBalayage: async (utilisateurId) => { await file.add('balayer', { type: 'balayer', utilisateurId }); },
  });
}
const synchro = (itemId: string, opts: object = {}) => file.add('synchroniser', { type: 'synchroniser', itemId }, opts);
const evenementId = async (itemId: string) => (await prisma.action.findUniqueOrThrow({ where: { itemId } })).evenementId;

describe('demarrerFileAgenda', () => {
  it('synchronise un item enfilé', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    lancer();
    await synchro(itemId);
    await attendre(async () => (await evenementId(itemId)) !== null);
  });

  it('429 : file en pause, une seule alerte, reprise ensuite', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const a = await actionDatee(prisma, uid, { texte: 'un' });
    const b = await actionDatee(prisma, uid, { texte: 'deux' });
    faux.forcer(/^POST \/calendar\//, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } });
    faux.forcer(/^POST \/calendar\//, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } });
    lancer();
    await synchro(a, { attempts: 5 });
    await synchro(b, { attempts: 5 });
    await attendre(async () => (await evenementId(a)) !== null && (await evenementId(b)) !== null);
    expect(alertes).toEqual([MESSAGES_ADMIN.pause(429, 'rateLimitExceeded')]);
  });

  it('autorisation retirée : une alerte, job terminé sans reprise, rien pour L', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const a = await actionDatee(prisma, uid, { texte: 'un' });
    const b = await actionDatee(prisma, uid, { texte: 'deux' });
    faux.rafraichissements.clear();
    lancer();
    const ja = await synchro(a, { attempts: 5 });
    await attendre(async () => (await ja.getState()) === 'completed');
    const jb = await synchro(b, { attempts: 5 });
    await attendre(async () => (await jb.getState()) === 'completed');
    expect(alertes).toEqual([MESSAGES_ADMIN.revoque('l')]);
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('revoque');
  });

  it('échange impossible (client refusé) : connexion en échec, alerte sur le client', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'l' } });
    await prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'en_cours' } });
    faux.forcer(/^POST \/token$/, 401, { error: 'invalid_client' });
    lancer();
    await file.add('echanger', { type: 'echanger', utilisateurId: u.id, code: 'c', verificateur: 'v' }, { attempts: 3 });
    await attendre(async () => (await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: u.id } })).etat === 'echec');
    expect(alertes).toContain(MESSAGES_ADMIN.client);
  });

  it('trois échecs définitifs dans l\'heure : une alerte de volume', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const items = [await actionDatee(prisma, uid), await actionDatee(prisma, uid), await actionDatee(prisma, uid)];
    for (let i = 0; i < 3; i++) faux.forcer(/^POST \/calendar\//, 500, { error: { code: 500, errors: [{ reason: 'backendError' }] } });
    lancer();
    const jobs = await Promise.all(items.map((i) => synchro(i, { attempts: 1 })));
    await attendre(async () => (await Promise.all(jobs.map((j) => j.getState()))).every((s) => s === 'failed'));
    await attendre(async () => alertes.includes(MESSAGES_ADMIN.echecs(3)));
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/scheduler/test/file.test.ts`
Expected: FAIL, `../src/file.js` introuvable.

- [ ] **Step 3: Écrire la file**

`apps/scheduler/src/file.ts` :
```ts
import { FILE_AGENDA, type JobAgenda } from '@organizer/shared';
import { UnrecoverableError, Worker, type ConnectionOptions } from 'bullmq';
import { balayer } from './agenda/balayer.js';
import { abandonnerDeconnexion, deconnecterAgenda, echangerCode, type DepsConnexion } from './agenda/connexion.js';
import { AutorisationRetiree, NonConnecte } from './agenda/jetons.js';
import { AgendaSupprime, synchroniserAction, type DepsSynchro } from './agenda/synchroniser.js';
import { ClientRefuse, ErreurGoogle, GoogleIndisponible } from './google/erreurs.js';

/** Textes des alertes à l'administrateur (jamais à L) ; repris dans docs/exploitation.md. */
export const MESSAGES_ADMIN = {
  revoque: (nom: string) => `Google Agenda du compte ${nom} : autorisation retirée ou expirée. Reconnecter depuis Réglages.`,
  pause: (statut: number, raison: string | null) =>
    `Google Agenda refuse (${statut}${raison ? `, ${raison}` : ''}) : écritures suspendues 15 minutes.`,
  client: 'Google Agenda : client OAuth refusé. Vérifier GOOGLE_CLIENT_ID et google_client_secret.',
  agendaSupprime: (nom: string) => `Google Agenda du compte ${nom} : l'agenda Organizer a été supprimé. Écritures arrêtées.`,
  echecs: (n: number) => `Google Agenda : ${n} écritures en échec depuis une heure.`,
  revocationImpossible: (nom: string) => `Google Agenda du compte ${nom} : révocation impossible. Retirer l'accès depuis le compte Google.`,
};

/** Une alerte par constat ; un constat ne revient qu'après retablir (ou un redémarrage du scheduler). */
export class Signaleur {
  private readonly signales = new Set<string>();
  constructor(private readonly alerter: (message: string) => Promise<void>) {}

  async une(cle: string, message: string): Promise<void> {
    if (this.signales.has(cle)) return;
    this.signales.add(cle);
    try {
      await this.alerter(message);
    } catch (e) {
      this.signales.delete(cle);
      console.error(`Alerte impossible (${(e as Error).name})`);
    }
  }

  retablir(cle: string): void {
    this.signales.delete(cle);
  }
}

export interface DepsFileAgenda extends DepsSynchro, DepsConnexion {
  connexion: ConnectionOptions;
  alerter(message: string): Promise<void>;
  enfilerSynchro(itemId: string): Promise<void>;
  nomFile?: string;
  pauseMs?: number;
}

const HEURE_MS = 3600_000;

export function demarrerFileAgenda(d: DepsFileAgenda): Worker<JobAgenda> {
  const signaleur = new Signaleur(d.alerter);
  const nom = async (uid: string): Promise<string> =>
    (await d.prisma.utilisateur.findUnique({ where: { id: uid }, select: { nom: true } }))?.nom ?? uid;
  const echecs: number[] = [];
  let echecsSignalesLe = 0;

  const w: Worker<JobAgenda> = new Worker<JobAgenda>(
    d.nomFile ?? FILE_AGENDA,
    async (job) => {
      const j = job.data;
      try {
        switch (j.type) {
          case 'synchroniser': {
            const r = await synchroniserAction(j.itemId, d);
            if (r !== 'rien' && r !== 'sans_agenda') signaleur.retablir('pause');
            return r;
          }
          case 'echanger': {
            const r = await echangerCode(j, d);
            if (r === 'connecte') {
              signaleur.retablir(`revoque:${j.utilisateurId}`);
              signaleur.retablir(`agenda:${j.utilisateurId}`);
            }
            return r;
          }
          case 'deconnecter':
            await deconnecterAgenda(j.utilisateurId, d);
            return 'deconnecte';
          case 'balayer':
            return await balayer({
              ...d, enfiler: d.enfilerSynchro,
              surRevocation: async (uid) => signaleur.une(`revoque:${uid}`, MESSAGES_ADMIN.revoque(await nom(uid))),
            }, j.utilisateurId);
        }
      } catch (e) {
        if (e instanceof AutorisationRetiree) {
          await signaleur.une(`revoque:${e.utilisateurId}`, MESSAGES_ADMIN.revoque(await nom(e.utilisateurId)));
          return 'revoque';
        }
        if (e instanceof NonConnecte) return 'sans_agenda';
        if (e instanceof AgendaSupprime) {
          await signaleur.une(`agenda:${e.utilisateurId}`, MESSAGES_ADMIN.agendaSupprime(await nom(e.utilisateurId)));
          return 'agenda_supprime';
        }
        if (e instanceof GoogleIndisponible) {
          // Quota ou refus : pause de toute la file, une alerte par épisode ; le job sera repris tel quel.
          await signaleur.une('pause', MESSAGES_ADMIN.pause(e.statut, e.raison));
          await w.rateLimit(d.pauseMs ?? 15 * 60_000);
          throw Worker.RateLimitError();
        }
        if (e instanceof ClientRefuse) {
          await signaleur.une('client', MESSAGES_ADMIN.client);
          throw new UnrecoverableError(e.name);
        }
        // Requête refusée (400…) : la rejouer ne changerait rien.
        if (e instanceof ErreurGoogle && e.constructor === ErreurGoogle && e.statut >= 400 && e.statut < 500 && e.statut !== 408) {
          throw new UnrecoverableError(e.message);
        }
        throw e;
      }
    },
    { connection: d.connexion, concurrency: 1 },
  );

  w.on('failed', (job, err) => {
    if (!job) return;
    const definitif = err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!definitif) return;
    console.error(`Agenda : job ${job.name} en échec définitif (${err.name})`);
    const j = job.data;
    void (async () => {
      if (j.type === 'echanger') {
        await d.prisma.agendaGoogle.updateMany({
          where: { utilisateurId: j.utilisateurId, etat: 'en_cours' }, data: { etat: 'echec', erreur: 'echange', jetonChiffre: null },
        });
      }
      if (j.type === 'deconnecter') {
        await abandonnerDeconnexion(j.utilisateurId, d);
        await signaleur.une(`revocation:${j.utilisateurId}`, MESSAGES_ADMIN.revocationImpossible(await nom(j.utilisateurId)));
      }
      const t = Date.now();
      echecs.push(t);
      while (echecs.length > 0 && echecs[0]! < t - HEURE_MS) echecs.shift();
      if (echecs.length >= 3 && t - echecsSignalesLe > HEURE_MS) {
        echecsSignalesLe = t;
        await d.alerter(MESSAGES_ADMIN.echecs(echecs.length));
      }
    })().catch((e: unknown) => console.error(`Agenda : suite d'un échec impossible (${(e as Error).name})`));
  });
  return w;
}
```

- [ ] **Step 4: Écrire le démarrage et la sonde**

`apps/scheduler/src/main.ts` (remplace la version provisoire) :
```ts
import { creerPrisma } from '@organizer/db';
import {
  creerFetchSortant, enfilerSynchro, FILE_AGENDA, FILE_ALERTES, OPTIONS_JOB_AGENDA, OPTIONS_JOB_ALERTE,
  type JobAgenda, type JobAlerte,
} from '@organizer/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Jetons } from './agenda/jetons.js';
import { lireConfigScheduler } from './configuration.js';
import { demarrerFileAgenda } from './file.js';
import { ClientCalendrier } from './google/calendrier.js';
import { ClientOAuth } from './google/oauth.js';

const config = lireConfigScheduler();
if (!config) {
  console.log('Google Agenda non configuré (GOOGLE_CLIENT_ID absent) : scheduler arrêté.');
  process.exit(0);
}

const prisma = creerPrisma();
const connexion = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const sortant = creerFetchSortant();
const oauth = new ClientOAuth(config.google, sortant);
const calendrier = new ClientCalendrier(config.google.baseCalendrier, sortant);
const jetons = new Jetons(prisma, oauth, config.cle);
const file = new Queue<JobAgenda>(FILE_AGENDA, { connection: connexion });
const alertes = new Queue<JobAlerte>(FILE_ALERTES, { connection: connexion });
const alerter = async (message: string): Promise<void> => { await alertes.add('alerte', { message }, OPTIONS_JOB_ALERTE); };

const worker = demarrerFileAgenda({
  prisma, oauth, calendrier, jetons, cle: config.cle, connexion, alerter,
  enfilerSynchro: (itemId) => enfilerSynchro(file, itemId),
  enfilerBalayage: async (utilisateurId) => { await file.add('balayer', { type: 'balayer', utilisateurId }, OPTIONS_JOB_AGENDA); },
});

const BALAYAGE_MS = 10 * 60_000;
const lancerBalayage = (): void => {
  // Un identifiant par tranche de 10 minutes : un redémarrage ne double pas le balayage.
  const tranche = Math.floor(Date.now() / BALAYAGE_MS);
  file.add('balayer', { type: 'balayer' }, { ...OPTIONS_JOB_AGENDA, jobId: `balayer-${tranche}` })
    .catch((e: unknown) => console.error(`Balayage non enfilé (${(e as Error).name})`));
};
lancerBalayage();
const minuterie = setInterval(lancerBalayage, BALAYAGE_MS);

console.log('Scheduler démarré. Google Agenda, balayage toutes les 10 minutes.');

async function arreter(): Promise<void> {
  clearInterval(minuterie);
  await worker.close();
  await Promise.all([file.close(), alertes.close(), prisma.$disconnect()]);
  connexion.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void arreter());
process.on('SIGINT', () => void arreter());
```

`apps/scheduler/src/sonde.ts` (remplace la version de la tâche 4) :
```ts
import { creerPrisma } from '@organizer/db';
import { creerFetchSortant, essayerSortie } from '@organizer/shared';

// Sonde d'exploitation : aucun jeton, aucun titre d'événement n'est lu ni affiché.
const [commande, cible] = process.argv.slice(2);
if (commande === 'sortie' && cible) {
  console.log(await essayerSortie(cible, creerFetchSortant()));
} else if (commande === 'agenda') {
  const prisma = creerPrisma();
  const comptes = await prisma.agendaGoogle.findMany({ include: { utilisateur: { select: { nom: true } } } });
  if (comptes.length === 0) console.log('Aucun compte relié à Google Agenda.');
  for (const a of comptes) {
    const n = await prisma.action.count({ where: { evenementId: { not: null }, item: { capture: { utilisateurId: a.utilisateurId } } } });
    console.log(`${a.utilisateur.nom} : ${a.etat}${a.erreur ? ` (${a.erreur})` : ''}, ${n} événement(s), jeton ${a.jetonChiffre ? 'présent' : 'absent'}, rafraîchi ${a.rafraichiLe?.toISOString() ?? 'jamais'}`);
  }
  await prisma.$disconnect();
} else {
  console.log('Usage : sonde sortie <url> | sonde agenda');
  process.exitCode = 1;
}
```

- [ ] **Step 5: Lancer les tests**

Run (tunnel ouvert) : `pnpm --filter @organizer/scheduler build && pnpm vitest run apps/scheduler && pnpm --filter @organizer/scheduler typecheck && pnpm lint`
Expected: PASS ; `paquet.test.ts` voit toujours « Variable manquante » et « Usage : sonde sortie <url> ».

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La file `agenda` du scheduler (concurrence 1) : synchronisation, échange, déconnexion, balayage toutes les 10 minutes ; 403 et 429 mettent la file en pause 15 minutes avec une alerte ; autorisation retirée, agenda supprimé, client refusé et échecs répétés alertent l'administrateur seul ; sonde `agenda` (2026-10-05). »
```bash
git add apps/scheduler CHANGELOG.md
git commit -m "Ajoute la file du scheduler et ses alertes à l'administrateur" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Parcours OAuth dans l'API (connexion, retour, état, déconnexion)

**Files:**
- Create: `apps/api/src/agenda/config.ts`, `apps/api/src/agenda/etats.ts`, `apps/api/src/agenda/agenda.service.ts`, `apps/api/src/agenda/agenda.controller.ts`
- Modify: `apps/api/src/auth/empreintes/defis.ts` (export de `borner`), `apps/api/src/config.ts`, `apps/api/src/jetons.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/aides-agenda.ts`, `apps/api/test/agenda.test.ts`, `apps/api/test/agenda-http.test.ts`

**Interfaces:**
- Consumes: `FILE_AGENDA`, `JobAgenda`, `FileJobs`, `OPTIONS_JOB_ECHANGE`, `OPTIONS_JOB_AGENDA`, `ReponseAgenda`, `ReponseConnexionAgenda`, `ErreurAgenda` (tâche 3) ; `prisma.agendaGoogle` (tâche 2) ; `AuthService.utilisateurDeSession`, `SessionGuard`, `LimiteurDebit`, `lireCookie`, `NOM_COOKIE`, `DelaiDepasse` existants.
- Produces :
  - `interface ConfigAgendaApi { clientId: string; redirectUri: string; urlAutorisation: string }` ; `lireConfigAgenda(env?): ConfigAgendaApi | null` ; `ConfigApi.agenda: ConfigAgendaApi | null` ;
  - `interface MagasinEtats { poser(etat: string, valeur: string): Promise<void>; prendre(etat: string): Promise<string | null> }` ; `MagasinEtatsValkey` (clé `organizer:agenda:etat:<état>`, 10 minutes, `GETDEL`) ; `DUREE_ETAT_OAUTH_MS` ;
  - `class AgendaService(prisma, etats, file: FileJobs<JobAgenda>, config: ConfigAgendaApi | null)` : `etat(uid): Promise<ReponseAgenda>`, `demarrer(uid): Promise<ReponseConnexionAgenda>`, `retour(q: { state?: string; code?: string; error?: string }, uidSession: string | null): Promise<IssueRetour>`, `deconnecter(uid): Promise<void>` ; `type IssueRetour = 'retour' | 'refus' | 'expire'` ; `AgendaIndisponible` ; `PORTEE_AGENDA` ;
  - routes : `GET /api/agenda` → `ReponseAgenda` ; `POST /api/agenda/connexion` → `{ url }` (503 si non configuré) ; `GET /api/agenda/retour` → 303 vers `/reglages?agenda=retour|refus|expire` ; `DELETE /api/agenda` → 202 ;
  - jetons Nest : `AGENDA`, `QUEUE_AGENDA`.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/aides-agenda.ts` :
```ts
import type { JobAgenda } from '@organizer/shared';
import type { ConfigAgendaApi } from '../src/agenda/config.js';
import type { MagasinEtats } from '../src/agenda/etats.js';

export class MagasinEtatsMemoire implements MagasinEtats {
  readonly m = new Map<string, string>();
  async poser(etat: string, valeur: string): Promise<void> { this.m.set(etat, valeur); }
  async prendre(etat: string): Promise<string | null> { const v = this.m.get(etat) ?? null; this.m.delete(etat); return v; }
}

export function fausseFile() {
  const ajouts: Array<{ nom: string; data: JobAgenda; opts?: object }> = [];
  return { ajouts, add: async (nom: string, data: JobAgenda, opts?: object) => { ajouts.push({ nom, data, opts }); } };
}

export const CONFIG_AGENDA: ConfigAgendaApi = {
  clientId: 'id.apps.googleusercontent.com', redirectUri: 'https://organizer.essai/api/agenda/retour',
  urlAutorisation: 'https://accounts.google.com/o/oauth2/v2/auth',
};
```

`apps/api/test/agenda.test.ts` :
```ts
import { createHash } from 'node:crypto';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { OPTIONS_JOB_ECHANGE } from '@organizer/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AgendaIndisponible, AgendaService, PORTEE_AGENDA } from '../src/agenda/agenda.service.js';
import { CONFIG_AGENDA as CONFIG, fausseFile, MagasinEtatsMemoire } from './aides-agenda.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
let etats: MagasinEtatsMemoire;
let file: ReturnType<typeof fausseFile>;
let service: AgendaService;
let uid: string;
beforeEach(async () => {
  await viderBase(prisma);
  etats = new MagasinEtatsMemoire();
  file = fausseFile();
  service = new AgendaService(prisma, etats, file, CONFIG);
  uid = (await prisma.utilisateur.create({ data: { nom: 'l' } })).id;
});

async function demarrer(): Promise<{ state: string; verificateur: string; url: URL }> {
  const url = new URL((await service.demarrer(uid)).url);
  const state = url.searchParams.get('state')!;
  const { verificateur } = JSON.parse(etats.m.get(state)!) as { verificateur: string };
  return { state, verificateur, url };
}

describe('AgendaService', () => {
  it('l\'adresse de Google : client, retour exact, portée unique, hors ligne, consentement, état, PKCE S256', async () => {
    const { url, state, verificateur } = await demarrer();
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CONFIG.clientId, redirect_uri: CONFIG.redirectUri, response_type: 'code', scope: PORTEE_AGENDA,
      access_type: 'offline', prompt: 'consent', state,
      code_challenge: createHash('sha256').update(verificateur).digest('base64url'), code_challenge_method: 'S256',
    });
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(verificateur).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('retour valable : connexion en cours, code et vérificateur confiés au scheduler, état à usage unique', async () => {
    const { state, verificateur } = await demarrer();
    expect(await service.retour({ state, code: 'code-1' }, uid)).toBe('retour');
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('en_cours');
    expect(file.ajouts).toEqual([{ nom: 'echanger', data: { type: 'echanger', utilisateurId: uid, code: 'code-1', verificateur }, opts: OPTIONS_JOB_ECHANGE }]);
    expect(await service.retour({ state, code: 'code-1' }, uid)).toBe('expire');
    expect(file.ajouts).toHaveLength(1);
  });

  it('retour sur une autre session, sans session, ou état inconnu : expiré, rien d\'enfilé', async () => {
    const autre = (await prisma.utilisateur.create({ data: { nom: 'f' } })).id;
    const a = await demarrer();
    expect(await service.retour({ state: a.state, code: 'c' }, autre)).toBe('expire');
    const b = await demarrer();
    expect(await service.retour({ state: b.state, code: 'c' }, null)).toBe('expire');
    expect(await service.retour({ state: 'inconnu', code: 'c' }, uid)).toBe('expire');
    expect(await service.retour({ code: 'c' }, uid)).toBe('expire');
    expect(file.ajouts).toHaveLength(0);
    expect(await prisma.agendaGoogle.count()).toBe(0);
  });

  it('L annule sur l\'écran de Google : refus, état consommé, rien d\'enfilé', async () => {
    const { state } = await demarrer();
    expect(await service.retour({ state, error: 'access_denied' }, uid)).toBe('refus');
    expect(etats.m.size).toBe(0);
    expect(file.ajouts).toHaveLength(0);
  });

  it('état de la connexion : déconnecté par défaut, indisponible sans configuration', async () => {
    expect(await service.etat(uid)).toEqual({ etat: 'deconnecte', erreur: null });
    await prisma.agendaGoogle.create({ data: { utilisateurId: uid, etat: 'echec', erreur: 'portee_refusee' } });
    expect(await service.etat(uid)).toEqual({ etat: 'echec', erreur: 'portee_refusee' });
    const sans = new AgendaService(prisma, etats, file, null);
    expect(await sans.etat(uid)).toEqual({ etat: 'indisponible', erreur: null });
    await expect(sans.demarrer(uid)).rejects.toBeInstanceOf(AgendaIndisponible);
  });

  it('déconnecter : déconnexion en cours et job ; sans connexion, rien', async () => {
    await service.deconnecter(uid);
    expect(file.ajouts).toHaveLength(0);
    await prisma.agendaGoogle.create({ data: { utilisateurId: uid, etat: 'connecte', jetonChiffre: 'v1.x', calendrierId: 'a' } });
    await service.deconnecter(uid);
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('deconnexion');
    expect(file.ajouts.map((a) => a.data)).toEqual([{ type: 'deconnecter', utilisateurId: uid }]);
  });
});
```

`apps/api/test/agenda-http.test.ts` :
```ts
import 'reflect-metadata';
import { Module, type Type } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgendaController } from '../src/agenda/agenda.controller.js';
import { AgendaService } from '../src/agenda/agenda.service.js';
import type { ConfigAgendaApi } from '../src/agenda/config.js';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AGENDA, AUTH } from '../src/jetons.js';
import { demarrerAppTest } from './aides-http.js';
import { CONFIG_AGENDA, fausseFile, MagasinEtatsMemoire } from './aides-agenda.js';

const prisma = creerPrisma();
const auth = new AuthService(prisma);

function moduleAvec(config: ConfigAgendaApi | null): Type<unknown> {
  class ModuleTest {}
  const agenda = new AgendaService(prisma, new MagasinEtatsMemoire(), fausseFile(), config);
  Module({ controllers: [AgendaController], providers: [{ provide: AUTH, useValue: auth }, { provide: AGENDA, useValue: agenda }, SessionGuard] })(ModuleTest);
  return ModuleTest;
}

let app: { url: string; fermer(): Promise<void> } | undefined;
let cookie: string;
beforeEach(async () => {
  await viderBase(prisma);
  const u = await prisma.utilisateur.create({ data: { nom: 'l' } });
  cookie = `${NOM_COOKIE}=${(await auth.ouvrirSessionPour(u.id)).jeton}`;
});
afterEach(async () => { await app?.fermer(); app = undefined; });
afterAll(() => prisma.$disconnect());

describe('routes de l\'agenda', () => {
  it('sans session : 401 sur l\'état et la connexion ; le retour redirige vers Réglages, « expire »', async () => {
    app = await demarrerAppTest(moduleAvec(CONFIG_AGENDA));
    expect((await fetch(`${app.url}/api/agenda`)).status).toBe(401);
    expect((await fetch(`${app.url}/api/agenda/connexion`, { method: 'POST' })).status).toBe(401);
    const r = await fetch(`${app.url}/api/agenda/retour?state=x&code=y`, { redirect: 'manual' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/reglages?agenda=expire');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('parcours complet : adresse de Google, retour avec la session, état en cours, déconnexion', async () => {
    app = await demarrerAppTest(moduleAvec(CONFIG_AGENDA));
    const r = await fetch(`${app.url}/api/agenda/connexion`, { method: 'POST', headers: { cookie } });
    expect(r.status).toBe(200);
    const state = new URL(((await r.json()) as { url: string }).url).searchParams.get('state')!;
    const retour = await fetch(`${app.url}/api/agenda/retour?state=${encodeURIComponent(state)}&code=code-1&scope=x`, { headers: { cookie }, redirect: 'manual' });
    expect(retour.headers.get('location')).toBe('/reglages?agenda=retour');
    expect(await (await fetch(`${app.url}/api/agenda`, { headers: { cookie } })).json()).toEqual({ etat: 'en_cours', erreur: null });
    expect((await fetch(`${app.url}/api/agenda`, { method: 'DELETE', headers: { cookie } })).status).toBe(202);
  });

  it('non configuré : 503 calme sur la connexion, état « indisponible »', async () => {
    app = await demarrerAppTest(moduleAvec(null));
    const r = await fetch(`${app.url}/api/agenda/connexion`, { method: 'POST', headers: { cookie } });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ message: "Google Agenda n'est pas configuré." });
    expect(await (await fetch(`${app.url}/api/agenda`, { headers: { cookie } })).json()).toEqual({ etat: 'indisponible', erreur: null });
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/agenda.test.ts apps/api/test/agenda-http.test.ts`
Expected: FAIL, modules `../src/agenda/*.js` introuvables.

- [ ] **Step 3: Écrire le code**

`apps/api/src/auth/empreintes/defis.ts` : exporter `borner` (`function borner` devient `export function borner`).

`apps/api/src/agenda/config.ts` :
```ts
import { lireVar } from '@organizer/shared';

export interface ConfigAgendaApi { clientId: string; redirectUri: string; urlAutorisation: string }

/** Le client OAuth (Application Web) de Franck. Hors production sans GOOGLE_CLIENT_ID : Google Agenda indisponible. */
export function lireConfigAgenda(env: NodeJS.ProcessEnv = process.env): ConfigAgendaApi | null {
  const production = env.NODE_ENV === 'production';
  const clientId = lireVar('GOOGLE_CLIENT_ID', env);
  if (!clientId) {
    if (production) throw new Error('Variable manquante : GOOGLE_CLIENT_ID (ou GOOGLE_CLIENT_ID_FILE)');
    return null;
  }
  const redirectUri = lireVar('GOOGLE_REDIRECT_URI', env);
  if (!redirectUri) throw new Error('Variable manquante : GOOGLE_REDIRECT_URI (ou GOOGLE_REDIRECT_URI_FILE)');
  if (production && !redirectUri.startsWith('https://')) throw new Error('GOOGLE_REDIRECT_URI doit commencer par https:// en production');
  return { clientId, redirectUri, urlAutorisation: lireVar('GOOGLE_AUTH_URL', env) ?? 'https://accounts.google.com/o/oauth2/v2/auth' };
}
```

`apps/api/src/agenda/etats.ts` :
```ts
import { borner, DELAI_VALKEY_MS, type ClientValkey } from '../auth/empreintes/defis.js';

/** Le temps de l'écran de consentement de Google, marge comprise. */
export const DUREE_ETAT_OAUTH_MS = 10 * 60_000;

export interface MagasinEtats {
  poser(etat: string, valeur: string): Promise<void>;
  /** Lit et efface d'un coup : un état ne sert qu'une fois. Expiré ou inconnu : null. */
  prendre(etat: string): Promise<string | null>;
}

const cle = (etat: string): string => `organizer:agenda:etat:${etat}`;

export class MagasinEtatsValkey implements MagasinEtats {
  constructor(private readonly valkey: ClientValkey, private readonly delaiMs = DELAI_VALKEY_MS) {}

  async poser(etat: string, valeur: string): Promise<void> {
    await borner(this.valkey.set(cle(etat), valeur, 'PX', DUREE_ETAT_OAUTH_MS), this.delaiMs);
  }

  prendre(etat: string): Promise<string | null> {
    return borner(this.valkey.getdel(cle(etat)), this.delaiMs);
  }
}
```

`apps/api/src/agenda/agenda.service.ts` :
```ts
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@organizer/db';
import { OPTIONS_JOB_AGENDA, OPTIONS_JOB_ECHANGE, type FileJobs, type JobAgenda } from '@organizer/shared';
import type { ErreurAgenda, ReponseAgenda, ReponseConnexionAgenda } from '@organizer/shared/api';
import type { ConfigAgendaApi } from './config.js';
import type { MagasinEtats } from './etats.js';

/** Seule portée demandée (cahier, Pont Google Agenda) : l'application ne voit que ce qu'elle a créé. */
export const PORTEE_AGENDA = 'https://www.googleapis.com/auth/calendar.app.created';

export class AgendaIndisponible extends Error {
  override name = 'AgendaIndisponible';
}

export type IssueRetour = 'retour' | 'refus' | 'expire';

/**
 * Parcours OAuth côté API. L'API ne joint jamais Google : elle prépare l'adresse de consentement (état et PKCE),
 * vérifie le retour, puis confie code et vérificateur au scheduler. Le code n'est jamais journalisé.
 */
export class AgendaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly etats: MagasinEtats,
    private readonly file: FileJobs<JobAgenda>,
    private readonly config: ConfigAgendaApi | null,
  ) {}

  async etat(uid: string): Promise<ReponseAgenda> {
    if (!this.config) return { etat: 'indisponible', erreur: null };
    const a = await this.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid } });
    return a ? { etat: a.etat, erreur: (a.erreur as ErreurAgenda) ?? null } : { etat: 'deconnecte', erreur: null };
  }

  async demarrer(uid: string): Promise<ReponseConnexionAgenda> {
    if (!this.config) throw new AgendaIndisponible();
    const etat = randomBytes(32).toString('base64url');
    const verificateur = randomBytes(48).toString('base64url');
    const defi = createHash('sha256').update(verificateur).digest('base64url');
    await this.etats.poser(etat, JSON.stringify({ utilisateurId: uid, verificateur }));
    const url = new URL(this.config.urlAutorisation);
    const params: Record<string, string> = {
      client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope: PORTEE_AGENDA,
      access_type: 'offline', prompt: 'consent', state: etat, code_challenge: defi, code_challenge_method: 'S256',
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return { url: url.toString() };
  }

  /** L'état est consommé avant tout : un retour rejoué, ou arrivé sur une autre session, est « expiré ». */
  async retour(q: { state?: string; code?: string; error?: string }, uidSession: string | null): Promise<IssueRetour> {
    if (!this.config || !q.state) return 'expire';
    const brut = await this.etats.prendre(q.state);
    if (!brut) return 'expire';
    const v = JSON.parse(brut) as { utilisateurId: string; verificateur: string };
    if (!uidSession || uidSession !== v.utilisateurId) return 'expire';
    if (q.error) return 'refus';
    if (!q.code) return 'expire';
    await this.prisma.agendaGoogle.upsert({
      where: { utilisateurId: v.utilisateurId },
      create: { utilisateurId: v.utilisateurId, etat: 'en_cours' },
      update: { etat: 'en_cours', erreur: null },
    });
    await this.file.add('echanger', { type: 'echanger', utilisateurId: v.utilisateurId, code: q.code, verificateur: v.verificateur }, OPTIONS_JOB_ECHANGE);
    return 'retour';
  }

  async deconnecter(uid: string): Promise<void> {
    const r = await this.prisma.agendaGoogle.updateMany({
      where: { utilisateurId: uid, etat: { not: 'deconnecte' } }, data: { etat: 'deconnexion', erreur: null },
    });
    if (r.count > 0) await this.file.add('deconnecter', { type: 'deconnecter', utilisateurId: uid }, OPTIONS_JOB_AGENDA);
  }
}
```

`apps/api/src/agenda/agenda.controller.ts` :
```ts
import {
  Controller, Delete, Get, HttpCode, HttpException, Inject, Post, Query, Req, Res, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import type { ReponseAgenda, ReponseConnexionAgenda } from '@organizer/shared/api';
import type { Request, Response } from 'express';
import { AGENDA, AUTH } from '../jetons.js';
import type { AuthService } from '../auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../auth/cookies.js';
import { DelaiDepasse } from '../auth/empreintes/defis.js';
import { LimiteurDebit } from '../auth/limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { AgendaIndisponible, type AgendaService, type IssueRetour } from './agenda.service.js';

export const MESSAGE_AGENDA_INDISPONIBLE = "Google Agenda n'est pas configuré.";
const texte = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= 2048 ? v : undefined);

@Controller('api/agenda')
export class AgendaController {
  private readonly limiteur = new LimiteurDebit(10, 60_000);

  constructor(@Inject(AGENDA) private readonly agenda: AgendaService, @Inject(AUTH) private readonly auth: AuthService) {}

  @Get()
  @UseGuards(SessionGuard)
  etat(@Req() req: RequeteAuthentifiee): Promise<ReponseAgenda> {
    return this.agenda.etat(req.utilisateur.id);
  }

  @Post('connexion')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async connexion(@Req() req: RequeteAuthentifiee): Promise<ReponseConnexionAgenda> {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
    try {
      return await this.agenda.demarrer(req.utilisateur.id);
    } catch (e) {
      if (e instanceof AgendaIndisponible) throw new ServiceUnavailableException(MESSAGE_AGENDA_INDISPONIBLE);
      if (e instanceof DelaiDepasse) throw new ServiceUnavailableException('Le serveur ne répond pas.');
      throw e;
    }
  }

  /** Arrivée depuis Google (navigation de premier niveau : le cookie SameSite=Lax est envoyé). Toujours vers Réglages. */
  @Get('retour')
  async retour(@Req() req: Request, @Query() q: Record<string, unknown>, @Res() res: Response): Promise<void> {
    let issue: IssueRetour = 'expire';
    if (this.limiteur.autoriser(req.ip ?? 'inconnue')) {
      try {
        const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
        const u = jeton ? await this.auth.utilisateurDeSession(jeton) : null;
        issue = await this.agenda.retour({ state: texte(q.state), code: texte(q.code), error: texte(q.error) }, u?.id ?? null);
      } catch (e) {
        // Nom d'erreur seulement : jamais la requête, qui porte le code d'autorisation.
        console.error(`Retour de Google en échec (${(e as Error).name})`);
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(303, `/reglages?agenda=${issue}`);
  }

  @Delete()
  @UseGuards(SessionGuard)
  @HttpCode(202)
  deconnecter(@Req() req: RequeteAuthentifiee): Promise<void> {
    return this.agenda.deconnecter(req.utilisateur.id);
  }
}
```

`apps/api/src/jetons.ts` : ajouter
```ts
export const AGENDA = Symbol('AGENDA');
export const QUEUE_AGENDA = Symbol('QUEUE_AGENDA');
```

`apps/api/src/config.ts` : importer `lireConfigAgenda, type ConfigAgendaApi` depuis `./agenda/config.js`, ajouter à `ConfigApi` :
```ts
  /** Client OAuth de Google Agenda ; null hors production sans GOOGLE_CLIENT_ID. */
  agenda: ConfigAgendaApi | null;
```
et, en dernier champ du retour de `lireConfigApi`, `agenda: lireConfigAgenda(),`.

`apps/api/src/app.module.ts` :
1. Imports : `FILE_AGENDA, type JobAgenda` dans l'import de `@organizer/shared` ; `AgendaController` ; `AgendaService` ; `MagasinEtatsValkey` ; `AGENDA, QUEUE_AGENDA` dans l'import de `./jetons.js`.
2. `controllers` : ajouter `AgendaController`.
3. `providers` : ajouter
```ts
    { provide: QUEUE_AGENDA, inject: [REDIS], useFactory: (redis: Redis) => new Queue<JobAgenda>(FILE_AGENDA, { connection: redis }) },
    {
      provide: AGENDA,
      inject: [CONFIG, PRISMA, REDIS, QUEUE_AGENDA],
      useFactory: (c: ConfigApi, prisma: PrismaClient, redis: Redis, file: Queue<JobAgenda>) =>
        new AgendaService(prisma, new MagasinEtatsValkey(redis), file, c.agenda),
    },
```
4. `Cycle` : injecter `@Inject(QUEUE_AGENDA) private readonly fileAgenda: Queue<JobAgenda>` et, dans `onApplicationShutdown`, `await this.fileAgenda.close();` avant `this.redis.disconnect()`.

- [ ] **Step 4: Lancer les tests**

Run (tunnel ouvert) : `pnpm vitest run apps/api && pnpm --filter @organizer/api typecheck && pnpm lint`
Expected: PASS, `config.test.ts` compris (sans `GOOGLE_CLIENT_ID` en test, `agenda` vaut null).

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Le parcours OAuth de Google Agenda dans l'API, sans jamais joindre Google : adresse de consentement (portée `calendar.app.created` seule, état et PKCE S256 dans Valkey, 10 minutes, usage unique), retour sur `/api/agenda/retour` lié à la session, code confié au scheduler, état et déconnexion pour Réglages (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute le parcours OAuth de Google Agenda dans l'API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Alarme item par item dans l'API et signal vers l'agenda

**Files:**
- Create: `apps/api/src/agenda/signal.ts`
- Modify: `apps/api/src/items/items.service.ts`, `apps/api/src/items/items.controller.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/items.test.ts` (ajouts), `apps/api/test/signal.test.ts`

**Interfaces:**
- Consumes: `enfilerSynchro`, `DELAI_SYNCHRO_COCHAGE_MS`, `FileJobs`, `JobAgenda` (tâche 3) ; `QUEUE_AGENDA` (tâche 10).
- Produces :
  - `interface SignalAgenda { signaler(itemId: string, delaiMs?: number): Promise<void> }` ; `SANS_AGENDA` ; `class SignalAgendaFile(file: FileJobs<JobAgenda>)` (n'échoue jamais : un enfilement raté est laissé au balayage) ;
  - `new ItemsService(prisma, typesEcheance, maintenant?, agenda?: SignalAgenda)` ; `corriger(itemId, { alarme })` ; `definirAlarme(itemId: string, alarme: boolean): Promise<void>` ;
  - `PATCH /api/items/:id` accepte `{ alarme: boolean }` (400 hors `datee`) ;
  - chaque cochage signale l'item avec 15 s de délai ; décochage et correction, sans délai ;
  - `MESSAGE_ALARME_SANS_HEURE = "L'alarme demande un jour et une heure."`.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/signal.test.ts` :
```ts
import { OPTIONS_JOB_AGENDA } from '@organizer/shared';
import { describe, expect, it, vi } from 'vitest';
import { SignalAgendaFile } from '../src/agenda/signal.js';

describe('SignalAgendaFile', () => {
  it('enfile une synchronisation avec le délai demandé', async () => {
    const add = vi.fn(async () => undefined);
    await new SignalAgendaFile({ add }).signaler('i1', 15_000);
    expect(add).toHaveBeenCalledWith('synchroniser', { type: 'synchroniser', itemId: 'i1' }, { ...OPTIONS_JOB_AGENDA, delay: 15_000 });
  });

  it('Valkey en panne : rien ne remonte, le balayage rattrapera', async () => {
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(new SignalAgendaFile({ add: async () => { throw new Error('ECONNREFUSED'); } }).signaler('i1')).resolves.toBeUndefined();
    expect(erreurs.mock.calls[0]![0]).toContain('balayage');
    erreurs.mockRestore();
  });
});
```

Dans `apps/api/test/items.test.ts`, ajouter en fin de fichier :
```ts
describe('alarme et agenda', () => {
  const signaux: Array<[string, number | undefined]> = [];
  const avecSignal = new ItemsService(prisma, TYPES, () => new Date('2026-10-06T07:00:00Z'), {
    signaler: async (itemId, delaiMs) => { signaux.push([itemId, delaiMs]); },
  });
  beforeEach(() => { signaux.length = 0; });

  it('alarme sur un rendez-vous daté : posée, historisée, signalée sans délai ; rien si inchangée', async () => {
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await avecSignal.definirAlarme(itemId, true);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).alarme).toBe(true);
    expect(await prisma.correction.findMany({ where: { itemId, champ: 'alarme' } })).toMatchObject([{ ancienneValeur: false, nouvelleValeur: true }]);
    expect(signaux).toEqual([[itemId, undefined]]);
    await avecSignal.definirAlarme(itemId, true);
    expect(await prisma.correction.count({ where: { itemId, champ: 'alarme' } })).toBe(1);
  });

  it('alarme refusée sans jour et heure, ou sur une pensée', async () => {
    const jour = await creerAction(prisma, { type: 'jour', date: '2026-10-14T00:00:00+02:00' });
    await expect(avecSignal.definirAlarme(jour.itemId, true)).rejects.toThrow("L'alarme demande un jour et une heure.");
    const pensee = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(avecSignal.definirAlarme(pensee.itemId, true)).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(avecSignal.definirAlarme(jour.itemId, false)).resolves.toBeUndefined();
  });

  it('un rendez-vous daté devenu « un jour » perd son alarme', async () => {
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await avecSignal.definirAlarme(itemId, true);
    await avecSignal.corriger(itemId, { echeance: { type: 'jour', date: '2026-10-14T00:00:00+02:00' } });
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).alarme).toBe(false);
  });

  it('cocher signale avec 15 s de délai, décocher et corriger tout de suite', async () => {
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await avecSignal.cocher(itemId);
    await avecSignal.decocher(itemId);
    await avecSignal.corriger(itemId, { nature: 'pensee' });
    expect(signaux).toEqual([[itemId, 15_000], [itemId, undefined], [itemId, undefined]]);
  });

  it('PATCH { alarme } : 204 sur un daté, 400 sur une valeur illisible ou hors datee', async () => {
    const auth = new AuthService(prisma);
    await prisma.utilisateur.create({ data: { nom: 'l' } });
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const date = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    const jour = await creerAction(prisma, { type: 'jour', date: '2026-10-14T00:00:00+02:00' });
    class M {}
    Module({ controllers: [ItemsController], providers: [
      { provide: ITEMS, useValue: avecSignal }, { provide: CONFIG, useValue: { audioRacine: tmpdir() } },
      { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    const patch = (id: string, corps: unknown) => fetch(`${app.url}/api/items/${id}`, {
      method: 'PATCH', headers: { cookie: `${NOM_COOKIE}=${s!.jeton}`, 'content-type': 'application/json' }, body: JSON.stringify(corps),
    });
    try {
      expect((await patch(date.itemId, { alarme: true })).status).toBe(204);
      expect((await patch(date.itemId, { alarme: 'oui' })).status).toBe(400);
      const r = await patch(jour.itemId, { alarme: true });
      expect(r.status).toBe(400);
      expect((await r.json()).message).toBe("L'alarme demande un jour et une heure.");
    } finally {
      await app.fermer();
    }
  });
});
```
(`creerAction` crée l'utilisateur `test` ; le test HTTP crée en plus le compte `l` de la session.)

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/items.test.ts apps/api/test/signal.test.ts`
Expected: FAIL : `definirAlarme` n'existe pas, `../src/agenda/signal.js` introuvable.

- [ ] **Step 3: Écrire le code**

`apps/api/src/agenda/signal.ts` :
```ts
import { enfilerSynchro, type FileJobs, type JobAgenda } from '@organizer/shared';

/** Prévient le scheduler qu'une action a changé. Ne fait jamais échouer le geste de L. */
export interface SignalAgenda { signaler(itemId: string, delaiMs?: number): Promise<void> }

export const SANS_AGENDA: SignalAgenda = { signaler: async () => {} };

export class SignalAgendaFile implements SignalAgenda {
  constructor(private readonly file: FileJobs<JobAgenda>) {}

  async signaler(itemId: string, delaiMs = 0): Promise<void> {
    try {
      await enfilerSynchro(this.file, itemId, delaiMs);
    } catch (e) {
      console.error(`Agenda : synchronisation de ${itemId} laissée au balayage (${(e as Error).name})`);
    }
  }
}
```

`apps/api/src/items/items.service.ts` :
1. Imports : `import { DELAI_SYNCHRO_COCHAGE_MS } from '@organizer/shared';` et `import { SANS_AGENDA, type SignalAgenda } from '../agenda/signal.js';`.
2. Ajouter `export const MESSAGE_ALARME_SANS_HEURE = "L'alarme demande un jour et une heure.";`.
3. Constructeur :
```ts
  constructor(
    private readonly prisma: PrismaClient,
    private readonly typesEcheance: string[],
    private readonly maintenant: () => Date = () => new Date(),
    private readonly agenda: SignalAgenda = SANS_AGENDA,
  ) {}
```
4. `cocher` : après l'`updateMany`, `await this.agenda.signaler(itemId, DELAI_SYNCHRO_COCHAGE_MS);` ; `decocher` : après l'`update`, `await this.agenda.signaler(itemId);`.
5. `corriger` : dans le bloc `if (c.echeance)`, l'`upsert` devient
```ts
        const sansHeure = nouvelle.echeanceType !== 'datee' ? { alarme: false, alarmeExpr: null } : {};
        await tx.action.upsert({ where: { itemId }, create: { itemId, ...nouvelle }, update: { ...nouvelle, echeanceExpr: null, ...sansHeure } });
```
puis, après ce bloc et toujours dans la transaction :
```ts
      if (c.alarme !== undefined) {
        const a = nature === 'action' ? await tx.action.findUnique({ where: { itemId } }) : null;
        if (!a) throw new CorrectionInvalide('Seule une action a une alarme.');
        if (c.alarme && (a.echeanceType !== 'datee' || !a.echeanceDate)) throw new CorrectionInvalide(MESSAGE_ALARME_SANS_HEURE);
        if (a.alarme !== c.alarme) {
          await tx.action.update({ where: { itemId }, data: { alarme: c.alarme } });
          // Historisée : les bascules serviront à trouver les formulations qui demandent l'alarme.
          await tx.correction.create({ data: { itemId, champ: 'alarme', ancienneValeur: a.alarme, nouvelleValeur: c.alarme } });
        }
      }
```
et, après la transaction (fin de `corriger`), `await this.agenda.signaler(itemId);`.
6. Nouvelle méthode :
```ts
  definirAlarme(itemId: string, alarme: boolean): Promise<void> {
    return this.corriger(itemId, { alarme });
  }
```

`apps/api/src/items/items.controller.ts` : le schéma devient
```ts
export const schemaCorrection = z.object({
  nature: z.enum(NATURES).optional(),
  echeance: z.object({ type: z.string().max(40), date: dateOuNul, debut: dateOuNul, fin: dateOuNul }).optional(),
  alarme: z.boolean().optional(),
}).refine((c) => c.nature !== undefined || c.echeance !== undefined || c.alarme !== undefined);
```

`apps/api/src/app.module.ts` : le fournisseur `ITEMS` devient
```ts
    {
      provide: ITEMS,
      inject: [CONFIG, PRISMA, QUEUE_AGENDA],
      useFactory: (c: ConfigApi, prisma: PrismaClient, file: Queue<JobAgenda>) =>
        new ItemsService(prisma, c.typesEcheance, undefined, new SignalAgendaFile(file)),
    },
```
(import de `SignalAgendaFile` depuis `./agenda/signal.js`).

- [ ] **Step 4: Lancer les tests**

Run (tunnel ouvert) : `pnpm vitest run apps/api && pnpm --filter @organizer/api typecheck && pnpm lint`
Expected: PASS, anciens tests d'items compris (signal par défaut sans effet).

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « L'alarme item par item dans l'API (`PATCH /api/items/:id { alarme }`), refusée hors rendez-vous daté, historisée, retirée quand l'échéance perd son heure ; chaque cochage, décochage ou correction prévient le scheduler (15 s après un cochage), sans jamais faire échouer le geste (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute l'alarme item par item et le signal vers l'agenda" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Après le classement, l'agenda et le bouton « Avec alarme » du bot

**Files:**
- Create: `apps/worker/src/agenda.ts`, `apps/api/src/telegram/propositions.ts`
- Modify: `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`, `apps/api/src/telegram/bot.ts`, `apps/api/src/telegram/webhook.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/worker/test/agenda.test.ts`, `apps/api/test/propositions.test.ts`, `apps/api/test/webhook.test.ts` (attendu modifié)

**Interfaces:**
- Consumes: `FILE_AGENDA`, `FILE_PROPOSITIONS`, `JobProposition`, `OPTIONS_JOB_PROPOSITION`, `enfilerSynchro`, `titreCourt`, `dateHeureEnClair`, `MINUTES_ALARME` (tâche 3) ; `ItemsService.definirAlarme` (tâche 11) ; `prisma.agendaGoogle`, `action.alarmeProposeeLe` (tâche 2).
- Produces :
  - worker : `interface FilesApresClassement { agenda: FileJobs<JobAgenda>; propositions: FileJobs<JobProposition> }` ; `apresClassement(prisma, files, captureId): Promise<void>` ; `DepsWorker.apresClassement?: (captureId: string) => Promise<void>` ;
  - API : `FRAICHEUR_PROPOSITION_MS = 15 min`, `LIBELLE_AVEC_ALARME = 'Avec alarme'`, `LIBELLE_SANS_ALARME = 'Sans alarme'`, `MOTIF_ALARME`, `texteRendezVous(texte, date, fuseau, alarme): string`, `clavierAlarme(itemId, alarme): InlineKeyboard`, `proposerAlarmes(captureId, d: { prisma; bot; maintenant? }): Promise<number>`, `class Alarmes(prisma, items: Pick<ItemsService, 'definirAlarme'>, maintenant?)` avec `definir(utilisateurId, itemId, alarme): Promise<{ texte: string; alarme: boolean } | null>`, `demarrerPropositions(connexion, prisma, bot): Worker<JobProposition>` ;
  - `DepsBot.alarmes?: Pick<Alarmes, 'definir'>` ; webhook : `allowed_updates: ['message', 'callback_query']`.

- [ ] **Step 1: Écrire les tests**

`apps/worker/test/agenda.test.ts` :
```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { chargerPrompt, OPTIONS_JOB_PROPOSITION, type JobClassement } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apresClassement } from '../src/agenda.js';
import { demarrerWorker } from '../src/worker.js';
import { creerCaptureTexte, FauxProvider } from './aides.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');
afterAll(async () => { await prisma.$disconnect(); connexion.disconnect(); });
beforeEach(() => viderBase(prisma));

function files() {
  const agenda: unknown[][] = [];
  const propositions: unknown[][] = [];
  return {
    agenda, propositions,
    f: { agenda: { add: async (...a: unknown[]) => { agenda.push(a); } }, propositions: { add: async (...a: unknown[]) => { propositions.push(a); } } },
  };
}

async function captureAvec(canal: 'telegram' | 'pwa', types: Array<string | null>, prive = false): Promise<{ captureId: string; ids: string[] }> {
  const u = await prisma.utilisateur.upsert({ where: { nom: 'test' }, create: { nom: 'test' }, update: {} });
  const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal, prive, etat: 'classee', emisLe: new Date(), texteEcrit: 'x' } });
  const ids: string[] = [];
  for (const [i, type] of types.entries()) {
    const nature = type === null ? 'pensee' : 'action';
    const it = await prisma.item.create({
      data: {
        captureId: c.id, position: i + 1, texte: `item ${i}`, nature, confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
        action: type === null ? undefined : { create: { echeanceType: type, echeanceDate: new Date('2026-10-14T08:00:00Z') } },
      },
    });
    ids.push(it.id);
  }
  return { captureId: c.id, ids };
}

describe('apresClassement', () => {
  it('capture Telegram : chaque rendez-vous daté part vers l\'agenda, une proposition par capture', async () => {
    const { captureId, ids } = await captureAvec('telegram', ['datee', 'jour', null, 'datee']);
    const { agenda, propositions, f } = files();
    await apresClassement(prisma, f, captureId);
    expect(agenda.map((a) => (a[1] as { itemId: string }).itemId).sort()).toEqual([ids[0], ids[3]].sort());
    expect(propositions).toEqual([['proposer', { captureId }, { ...OPTIONS_JOB_PROPOSITION, jobId: `proposer-${captureId}` }]]);
  });

  it('sans rendez-vous daté : rien ; capture de la PWA : l\'agenda, sans proposition ; privée : rien', async () => {
    const sans = await captureAvec('telegram', ['jour']);
    const pwa = await captureAvec('pwa', ['datee']);
    const privee = await captureAvec('telegram', ['datee'], true);
    const { agenda, propositions, f } = files();
    await apresClassement(prisma, f, sans.captureId);
    await apresClassement(prisma, f, pwa.captureId);
    await apresClassement(prisma, f, privee.captureId);
    expect(agenda).toHaveLength(1);
    expect(propositions).toHaveLength(0);
  });
});

describe('demarrerWorker et l\'agenda', () => {
  let file: Queue<JobClassement>;
  let worker: Worker<JobClassement> | undefined;
  const nomFile = `classement-agenda-${randomUUID()}`;
  beforeEach(() => { file = new Queue<JobClassement>(nomFile, { connection: connexion }); });
  afterEach(async () => { await worker?.close(); await file.obliterate({ force: true }); await file.close(); });

  it('appelle la suite après le classement ; son échec ne défait pas le classement', async () => {
    const { id } = await creerCaptureTexte(prisma);
    const appels: string[] = [];
    worker = demarrerWorker({
      prisma, provider: new FauxProvider(), prompt, audioRacine: tmpdir(), connexion, concurrence: 1, nomFile,
      alerter: async () => {}, apresClassement: async (captureId) => { appels.push(captureId); throw new Error('valkey'); },
    });
    const job = await file.add('classer', { captureId: id }, { jobId: id });
    const fin = Date.now() + 8000;
    while ((await job.getState()) !== 'completed' && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
    expect(await job.getState()).toBe('completed');
    expect(appels).toEqual([id]);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('classee');
  });
});
```

`apps/api/test/propositions.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ItemsService } from '../src/items/items.service.js';
import type { IngestionService } from '../src/ingestion/ingestion.service.js';
import { creerBot } from '../src/telegram/bot.js';
import { LiaisonService } from '../src/telegram/liaison.service.js';
import { Alarmes, proposerAlarmes } from '../src/telegram/propositions.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

const MAINTENANT = new Date('2026-10-10T08:00:00Z');
const botInfo = { id: 1, is_bot: true, first_name: 'test', username: 'test_bot' } as UserFromGetMe;
const TYPES = ['datee', 'jour', 'fenetre', 'relative', 'aucune'];

function intercepter(bot: Bot) {
  const envois: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    envois.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: method === 'sendMessage' ? { message_id: 99, date: 0, chat: { id: 7, type: 'private' } } : true } as never;
  });
  return envois;
}

async function rendezVous(o: { recuLe?: string; agenda?: boolean; canal?: 'telegram' | 'pwa'; date?: string; type?: string; alarme?: boolean } = {}) {
  const u = await prisma.utilisateur.upsert({ where: { nom: 'l' }, create: { nom: 'l', telegramChatId: 7n }, update: {} });
  if (o.agenda ?? true) {
    await prisma.agendaGoogle.upsert({ where: { utilisateurId: u.id }, create: { utilisateurId: u.id, etat: 'connecte', calendrierId: 'a' }, update: {} });
  }
  const c = await prisma.capture.create({
    data: {
      utilisateurId: u.id, canal: o.canal ?? 'telegram', prive: false, etat: 'classee', sourceRef: `tg:7:${Math.floor(Math.random() * 1e6)}`,
      emisLe: MAINTENANT, recuLe: new Date(o.recuLe ?? '2026-10-10T07:55:00Z'), texteEcrit: 'x',
    },
  });
  const it = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: 'dentiste', nature: 'action', confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
      action: { create: { echeanceType: o.type ?? 'datee', echeanceDate: new Date(o.date ?? '2026-10-14T08:00:00Z'), alarme: o.alarme ?? false } },
    },
  });
  return { uid: u.id, captureId: c.id, itemId: it.id, sourceRef: c.sourceRef! };
}

describe('proposerAlarmes', () => {
  it('un message silencieux, en réponse au vocal, avec « Avec alarme » ; jamais deux fois', async () => {
    const r = await rendezVous();
    const bot = new Bot('0:test', { botInfo });
    const envois = intercepter(bot);
    expect(await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT })).toBe(1);
    expect(envois).toHaveLength(1);
    expect(envois[0]!.payload).toMatchObject({
      chat_id: 7, text: 'Dentiste : mercredi 14 octobre, 10:00.', disable_notification: true,
      reply_parameters: { message_id: Number(r.sourceRef.split(':')[2]), allow_sending_without_reply: true },
      reply_markup: { inline_keyboard: [[{ text: 'Avec alarme', callback_data: `alarme:1:${r.itemId}` }]] },
    });
    expect(await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT })).toBe(0);
    expect(envois).toHaveLength(1);
  });

  it('alarme déjà comprise à la voix : le message le dit et propose « Sans alarme »', async () => {
    const r = await rendezVous({ alarme: true });
    const bot = new Bot('0:test', { botInfo });
    const envois = intercepter(bot);
    await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT });
    expect(envois[0]!.payload).toMatchObject({
      text: 'Dentiste : mercredi 14 octobre, 10:00. Alarme 10 minutes avant.',
      reply_markup: { inline_keyboard: [[{ text: 'Sans alarme', callback_data: `alarme:0:${r.itemId}` }]] },
    });
  });

  it.each([
    ['une capture de plus de 15 minutes (classement tardif)', { recuLe: '2026-10-10T07:44:00Z' }],
    ['un compte sans agenda connecté', { agenda: false }],
    ['un rendez-vous déjà passé', { date: '2026-10-10T07:00:00Z' }],
    ['une action « un jour »', { type: 'jour' }],
    ['une capture venue de la PWA', { canal: 'pwa' as const }],
  ])('rien pour %s', async (_cas, o) => {
    const r = await rendezVous(o);
    const bot = new Bot('0:test', { botInfo });
    const envois = intercepter(bot);
    expect(await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT })).toBe(0);
    expect(envois).toHaveLength(0);
  });
});

describe('bouton du bot', () => {
  const appui = (id: number, data: string) => ({
    update_id: id,
    callback_query: {
      id: `cb${id}`, from: { id: 7, is_bot: false, first_name: 'x' }, chat_instance: 'ci', data,
      message: { message_id: 99, date: 0, chat: { id: 7, type: 'private', first_name: 'x' }, text: 'Dentiste : mercredi 14 octobre, 10:00.' },
    },
  }) as never;

  function monter() {
    const items = new ItemsService(prisma, TYPES, () => MAINTENANT);
    const bot = creerBot('0:test', {
      liaison: new LiaisonService(prisma), ingestion: {} as IngestionService, alarmes: new Alarmes(prisma, items, () => MAINTENANT),
    }, { botInfo });
    return { bot, envois: intercepter(bot) };
  }

  it('« Avec alarme » pose l\'alarme et réécrit le message ; l\'appui relivré ne la défait pas', async () => {
    const r = await rendezVous();
    const { bot, envois } = monter();
    await bot.handleUpdate(appui(1, `alarme:1:${r.itemId}`));
    await bot.handleUpdate(appui(1, `alarme:1:${r.itemId}`));
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: r.itemId } })).alarme).toBe(true);
    const edit = envois.find((e) => e.method === 'editMessageText')!;
    expect(edit.payload).toMatchObject({
      text: 'Dentiste : mercredi 14 octobre, 10:00. Alarme 10 minutes avant.',
      reply_markup: { inline_keyboard: [[{ text: 'Sans alarme', callback_data: `alarme:0:${r.itemId}` }]] },
    });
    expect(envois.filter((e) => e.method === 'answerCallbackQuery').map((e) => e.payload.text)).toEqual(['Alarme activée.', 'Alarme activée.']);
    expect(envois.filter((e) => e.method === 'sendMessage')).toHaveLength(0);
  });

  it('« Sans alarme » la retire ; un rendez-vous d\'un autre compte ou cochée : « Ce rendez-vous a changé. »', async () => {
    const r = await rendezVous({ alarme: true });
    const { bot, envois } = monter();
    await bot.handleUpdate(appui(2, `alarme:0:${r.itemId}`));
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: r.itemId } })).alarme).toBe(false);
    await prisma.action.update({ where: { itemId: r.itemId }, data: { faitLe: MAINTENANT } });
    await bot.handleUpdate(appui(3, `alarme:1:${r.itemId}`));
    expect(envois.filter((e) => e.method === 'answerCallbackQuery').at(-1)!.payload.text).toBe('Ce rendez-vous a changé.');
  });
});
```

Dans `apps/api/test/webhook.test.ts`, l'attendu de `setWebhook` devient `allowed_updates: ['message', 'callback_query']`.

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/worker/test/agenda.test.ts apps/api/test/propositions.test.ts apps/api/test/webhook.test.ts`
Expected: FAIL : modules `../src/agenda.js` et `../src/telegram/propositions.js` introuvables ; `allowed_updates` encore `['message']`.

- [ ] **Step 3: Écrire le côté worker**

`apps/worker/src/agenda.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { enfilerSynchro, OPTIONS_JOB_PROPOSITION, type FileJobs, type JobAgenda, type JobProposition } from '@organizer/shared';

export interface FilesApresClassement { agenda: FileJobs<JobAgenda>; propositions: FileJobs<JobProposition> }

/**
 * Après le classement : chaque rendez-vous daté part vers l'agenda ; une capture Telegram qui en contient reçoit
 * la proposition du bouton « Avec alarme » (envoyée par l'API, seul point d'envoi vers L). jobId : une seule par capture.
 */
export async function apresClassement(prisma: PrismaClient, files: FilesApresClassement, captureId: string): Promise<void> {
  const c = await prisma.capture.findUnique({
    where: { id: captureId },
    select: { canal: true, prive: true, items: { where: { nature: 'action', action: { is: { echeanceType: 'datee' } } }, select: { id: true } } },
  });
  if (!c || c.prive || c.items.length === 0) return;
  for (const it of c.items) await enfilerSynchro(files.agenda, it.id);
  if (c.canal === 'telegram') {
    await files.propositions.add('proposer', { captureId }, { ...OPTIONS_JOB_PROPOSITION, jobId: `proposer-${captureId}` });
  }
}
```

`apps/worker/src/worker.ts` :
1. `DepsWorker` gagne `apresClassement?: (captureId: string) => Promise<void>;`.
2. Dans le traitement du job, après `indisponibiliteSignalee = false;` :
```ts
        if (issue !== 'a_revoir' && d.apresClassement) {
          try {
            await d.apresClassement(job.data.captureId);
          } catch (e) {
            // Le classement est fait ; l'agenda sera rattrapé par le balayage du scheduler.
            console.error(`Suite du classement de ${job.data.captureId} reportée (${(e as Error).name})`);
          }
        }
```

`apps/worker/src/main.ts` : importer `FILE_AGENDA, FILE_PROPOSITIONS, type JobAgenda, type JobProposition` et `apresClassement` ; avant `demarrerWorker`, créer
```ts
const fileAgenda = new Queue<JobAgenda>(FILE_AGENDA, { connection: connexion });
const filePropositions = new Queue<JobProposition>(FILE_PROPOSITIONS, { connection: connexion });
```
passer `apresClassement: (captureId) => apresClassement(prisma, { agenda: fileAgenda, propositions: filePropositions }, captureId)` à `demarrerWorker`, et fermer les deux files dans `arreter()` (`Promise.all([file.close(), alertes.close(), fileAgenda.close(), filePropositions.close(), prisma.$disconnect()])`).

- [ ] **Step 4: Écrire le côté API**

`apps/api/src/telegram/propositions.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { dateHeureEnClair, FILE_PROPOSITIONS, MINUTES_ALARME, titreCourt, type JobProposition } from '@organizer/shared';
import { Worker, type ConnectionOptions } from 'bullmq';
import { InlineKeyboard, type Bot } from 'grammy';
import type { ItemsService } from '../items/items.service.js';

/** Au-delà, le bouton arriverait à contretemps (classement en rattrapage) : rien n'est proposé. */
export const FRAICHEUR_PROPOSITION_MS = 15 * 60_000;
export const LIBELLE_AVEC_ALARME = 'Avec alarme';
export const LIBELLE_SANS_ALARME = 'Sans alarme';
export const MOTIF_ALARME = /^alarme:([01]):([0-9a-f-]{36})$/;

const majuscule = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** « Dentiste : mercredi 14 octobre, 10:00. », et la phrase de l'alarme quand elle est posée. */
export function texteRendezVous(texte: string, date: Date, fuseau: string, alarme: boolean): string {
  const base = `${majuscule(titreCourt(texte, 40))} : ${dateHeureEnClair(date, fuseau)}.`;
  return alarme ? `${base} Alarme ${MINUTES_ALARME} minutes avant.` : base;
}

/** Le bouton porte la valeur voulue, jamais « basculer » : un appui relivré par Telegram ne défait rien. */
export function clavierAlarme(itemId: string, alarme: boolean): InlineKeyboard {
  return alarme
    ? new InlineKeyboard().text(LIBELLE_SANS_ALARME, `alarme:0:${itemId}`)
    : new InlineKeyboard().text(LIBELLE_AVEC_ALARME, `alarme:1:${itemId}`);
}

export interface DepsPropositions { prisma: PrismaClient; bot: Bot; maintenant?: () => Date }

/**
 * Juste après le classement d'une capture Telegram : un message silencieux par rendez-vous daté à venir, en réponse
 * au vocal, avec le bouton. Seulement si l'agenda du compte est connecté, si la capture est fraîche, et une seule fois.
 */
export async function proposerAlarmes(captureId: string, d: DepsPropositions): Promise<number> {
  const maintenant = (d.maintenant ?? (() => new Date()))();
  const c = await d.prisma.capture.findUnique({
    where: { id: captureId },
    include: { utilisateur: { include: { agenda: true } }, items: { include: { action: true }, orderBy: { position: 'asc' } } },
  });
  if (!c || c.prive || c.canal !== 'telegram' || !c.utilisateur.telegramChatId) return 0;
  if (c.utilisateur.agenda?.etat !== 'connecte') return 0;
  if (maintenant.getTime() - c.recuLe.getTime() > FRAICHEUR_PROPOSITION_MS) return 0;
  const messageId = /^tg:-?\d+:(\d+)$/.exec(c.sourceRef ?? '')?.[1];
  let n = 0;
  for (const it of c.items) {
    const a = it.action;
    if (it.nature !== 'action' || !a || a.echeanceType !== 'datee' || !a.echeanceDate || a.faitLe || a.alarmeProposeeLe) continue;
    if (a.echeanceDate.getTime() <= maintenant.getTime()) continue;
    await d.bot.api.sendMessage(Number(c.utilisateur.telegramChatId), texteRendezVous(it.texte, a.echeanceDate, c.utilisateur.fuseau, a.alarme), {
      disable_notification: true,
      reply_markup: clavierAlarme(it.id, a.alarme),
      ...(messageId ? { reply_parameters: { message_id: Number(messageId), allow_sending_without_reply: true } } : {}),
    });
    await d.prisma.action.update({ where: { itemId: it.id }, data: { alarmeProposeeLe: maintenant } });
    n++;
  }
  return n;
}

/** L'appui sur le bouton : seulement le compte du chat, une action datée à venir et non cochée. */
export class Alarmes {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly items: Pick<ItemsService, 'definirAlarme'>,
    private readonly maintenant: () => Date = () => new Date(),
  ) {}

  async definir(utilisateurId: string, itemId: string, alarme: boolean): Promise<{ texte: string; alarme: boolean } | null> {
    const it = await this.prisma.item.findUnique({ where: { id: itemId }, include: { action: true, capture: { include: { utilisateur: true } } } });
    const a = it?.action;
    if (!it || it.capture.utilisateurId !== utilisateurId || it.nature !== 'action' || !a) return null;
    if (a.echeanceType !== 'datee' || !a.echeanceDate || a.faitLe || a.echeanceDate.getTime() <= this.maintenant().getTime()) return null;
    await this.items.definirAlarme(itemId, alarme);
    return { texte: texteRendezVous(it.texte, a.echeanceDate, it.capture.utilisateur.fuseau, alarme), alarme };
  }
}

export function demarrerPropositions(connexion: ConnectionOptions, prisma: PrismaClient, bot: Bot): Worker<JobProposition> {
  return new Worker<JobProposition>(FILE_PROPOSITIONS, (job) => proposerAlarmes(job.data.captureId, { prisma, bot }), { connection: connexion });
}
```

`apps/api/src/telegram/bot.ts` :
1. Import : `import { clavierAlarme, MOTIF_ALARME, type Alarmes } from './propositions.js';`.
2. `export interface DepsBot { liaison: LiaisonService; ingestion: IngestionService; alarmes?: Pick<Alarmes, 'definir'> }`.
3. Avant `bot.on('message', …)` :
```ts
  // Bouton « Avec alarme » / « Sans alarme » : la réponse tient dans le message lui-même, rien d'autre n'est envoyé.
  bot.callbackQuery(MOTIF_ALARME, async (ctx) => {
    const [, valeur, itemId] = ctx.match as RegExpMatchArray;
    const u = ctx.chat ? await d.liaison.utilisateurDuChat(ctx.chat.id) : null;
    const r = u && d.alarmes ? await d.alarmes.definir(u.id, itemId!, valeur === '1') : null;
    if (!r) {
      await ctx.answerCallbackQuery({ text: 'Ce rendez-vous a changé.' });
      return;
    }
    try {
      await ctx.editMessageText(r.texte, { reply_markup: clavierAlarme(itemId!, r.alarme) });
    } catch (e) {
      // Appui relivré : le message porte déjà ce texte.
      if (!(e as Error).message.includes('message is not modified')) throw e;
    }
    await ctx.answerCallbackQuery({ text: r.alarme ? 'Alarme activée.' : 'Alarme retirée.' });
  });
```

`apps/api/src/telegram/webhook.ts` : `allowed_updates: ['message', 'callback_query']`, et ajouter au commentaire de `poserWebhook` : « callback_query : le bouton « Avec alarme » (lot 2-A). Après une mise à jour qui change cette liste, rejouer `telegram-webhook poser`. »

`apps/api/src/app.module.ts` :
1. Import `Alarmes, demarrerPropositions` depuis `./telegram/propositions.js`.
2. Le fournisseur `BOT` devient
```ts
    {
      provide: BOT,
      inject: [CONFIG, PRISMA, INGESTION, ITEMS],
      useFactory: (c: ConfigApi, prisma: PrismaClient, ingestion: IngestionService, items: ItemsService) =>
        creerBot(c.telegramToken, { liaison: new LiaisonService(prisma), ingestion, alarmes: new Alarmes(prisma, items) }, { client: optionsClientTelegram(c.telegramApiRoot) }),
    },
```
3. `Cycle` : champ `private propositions?: Worker;` ; dans `onApplicationBootstrap`, après `this.alertes = demarrerAlertes(…)`, `this.propositions = demarrerPropositions(this.redis, this.prisma, this.bot);` ; dans `onApplicationShutdown`, `await this.propositions?.close();` à côté de `this.alertes?.close()`.

- [ ] **Step 5: Lancer les tests**

Run (tunnel ouvert) : `pnpm vitest run apps/worker apps/api && pnpm typecheck && pnpm lint`
Expected: PASS ; les tests existants du bot (`bot.test.ts`) passent sans `alarmes`.

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Après le classement, chaque rendez-vous daté part vers l'agenda ; sur une capture Telegram, le bot propose « Avec alarme » dans un message silencieux en réponse au vocal, une seule fois, seulement si l'agenda est connecté, la capture fraîche et le rendez-vous à venir ; l'appui réécrit le message (« Sans alarme » pour revenir) ; le webhook reçoit les `callback_query` (rejouer `telegram-webhook poser`) (2026-10-05). »
```bash
git add apps/worker apps/api CHANGELOG.md
git commit -m "Branche l'agenda après le classement et le bouton « Avec alarme » du bot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: L'interrupteur d'alarme et la section Google Agenda de la PWA

**Files:**
- Create: `apps/web/src/lib/agenda.ts`, `apps/web/e2e/agenda.spec.ts`
- Modify: `apps/web/src/lib/api.ts`, `apps/web/src/lib/messages.ts`, `apps/web/src/lib/composants/DetailItem.svelte`, `apps/web/src/routes/reglages/+page.svelte`, `CHANGELOG.md`
- Test: `apps/web/test/agenda.test.ts`, `apps/web/e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `ReponseAgenda`, `ReponseConnexionAgenda`, `MINUTES_ALARME`, `CorpsCorrection.alarme` (tâche 3) ; routes de la tâche 10 ; `PATCH /api/items/:id { alarme }` (tâche 11).
- Produces :
  - `ClientApi.agenda(): Promise<ReponseAgenda>`, `ClientApi.connecterAgenda(): Promise<ReponseConnexionAgenda>`, `ClientApi.deconnecterAgenda(): Promise<void>` ;
  - `type RetourAgenda = 'retour' | 'refus' | 'expire'` ; `lireRetour(recherche: string): RetourAgenda | null` ; `interface VueAgenda { ligne: string; bouton: 'connecter' | 'deconnecter' | null }` ; `vueAgenda(r: ReponseAgenda): VueAgenda` ; `messageRetour(r: RetourAgenda): string | null` ; `attendreIssue(api: Pick<ClientApi, 'agenda'>, attendre: (ms: number) => Promise<void>, essais?: number, pasMs?: number): Promise<ReponseAgenda>` ;
  - dans le détail d'un rendez-vous daté : un interrupteur `role="switch"` nommé « Alarme 10 minutes avant » ; dans Réglages : section « Google Agenda » avec « Connecter Google Agenda » ou « Déconnecter Google Agenda ».

- [ ] **Step 1: Écrire les tests unitaires**

`apps/web/test/agenda.test.ts` :
```ts
import type { ReponseAgenda } from '@organizer/shared/api';
import { describe, expect, it } from 'vitest';
import { attendreIssue, lireRetour, messageRetour, vueAgenda } from '../src/lib/agenda.js';
import { MESSAGES } from '../src/lib/messages.js';

describe('lireRetour', () => {
  it('ne reconnaît que les trois issues de l\'API', () => {
    expect(lireRetour('?agenda=retour')).toBe('retour');
    expect(lireRetour('?agenda=refus')).toBe('refus');
    expect(lireRetour('?agenda=expire')).toBe('expire');
    expect(lireRetour('?agenda=<script>')).toBeNull();
    expect(lireRetour('')).toBeNull();
  });
  it('messages calmes pour un refus et un lien expiré', () => {
    expect(messageRetour('refus')).toBe(MESSAGES.agendaRefus);
    expect(messageRetour('expire')).toBe(MESSAGES.agendaExpire);
    expect(messageRetour('retour')).toBeNull();
  });
});

describe('vueAgenda', () => {
  it.each([
    [{ etat: 'indisponible', erreur: null }, MESSAGES.agendaIndisponible, null],
    [{ etat: 'deconnecte', erreur: null }, MESSAGES.agendaDeconnecte, 'connecter'],
    [{ etat: 'en_cours', erreur: null }, MESSAGES.agendaEnCours, null],
    [{ etat: 'connecte', erreur: null }, MESSAGES.agendaConnecte, 'deconnecter'],
    [{ etat: 'deconnexion', erreur: null }, MESSAGES.agendaDeconnexion, null],
    [{ etat: 'revoque', erreur: null }, MESSAGES.agendaRevoque, 'connecter'],
    [{ etat: 'agenda_supprime', erreur: null }, MESSAGES.agendaSupprime, 'connecter'],
    [{ etat: 'echec', erreur: 'portee_refusee' }, MESSAGES.agendaPorteeRefusee, 'connecter'],
    [{ etat: 'echec', erreur: 'echange' }, MESSAGES.agendaEchec, 'connecter'],
  ] as Array<[ReponseAgenda, string, string | null]>)('%o', (r, ligne, bouton) => {
    expect(vueAgenda(r)).toEqual({ ligne, bouton });
  });
});

describe('attendreIssue', () => {
  it('interroge tant que la connexion est en cours, puis rend l\'issue', async () => {
    const reponses: ReponseAgenda[] = [{ etat: 'en_cours', erreur: null }, { etat: 'en_cours', erreur: null }, { etat: 'connecte', erreur: null }];
    const attentes: number[] = [];
    const r = await attendreIssue({ agenda: async () => reponses.shift()! }, async (ms) => { attentes.push(ms); });
    expect(r.etat).toBe('connecte');
    expect(attentes).toEqual([1000, 1000]);
  });
  it('s\'arrête au bout des essais, encore en cours', async () => {
    const r = await attendreIssue({ agenda: async () => ({ etat: 'en_cours', erreur: null }) }, async () => {}, 3);
    expect(r.etat).toBe('en_cours');
  });
});
```

- [ ] **Step 2: Écrire le test e2e**

`apps/web/e2e/agenda.spec.ts` :
```ts
import { expect, test } from '@playwright/test';
import { CONNECTE, corpsDe, json, ligne, simuler } from './simul';

const rdv = ligne(1, 'Dentiste', { echeanceType: 'datee', echeanceDate: '2026-10-14T08:00:00.000Z' });
const draps = ligne(2, 'Changer les draps', { echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' });
const REGLAGES = { ...CONNECTE, 'GET /api/empreintes': json(200, []) };

test('alarme : un interrupteur sur un rendez-vous daté, rien sur un jour sans heure', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [rdv, draps], suggestions: [] }),
    [`PATCH /api/items/${rdv.itemId}`]: json(204),
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Dentiste/ }).click();
  const interrupteur = page.getByRole('switch', { name: 'Alarme 10 minutes avant' });
  await expect(interrupteur).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Elle sonne par Google Agenda, seulement pour ce rendez-vous.')).toBeVisible();
  await interrupteur.click();
  await expect.poll(() => corpsDe(appels, `PATCH /api/items/${rdv.itemId}`)).toEqual({ alarme: true });
  await expect(page.getByText('Alarme activée, 10 minutes avant.')).toBeVisible();
  await page.getByRole('button', { name: /Changer les draps/ }).click();
  await expect(page.getByRole('switch')).toHaveCount(0);
});

test('Réglages : « Connecter Google Agenda » mène à l\'écran de Google', async ({ page }) => {
  await simuler(page, {
    ...REGLAGES,
    'GET /api/agenda': json(200, { etat: 'deconnecte', erreur: null }),
    'POST /api/agenda/connexion': json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s' }),
  });
  await page.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Écran de Google</p>' }));
  await page.goto('/reglages');
  await expect(page.getByText('Tes rendez-vous datés peuvent aller dans ton Google Agenda.')).toBeVisible();
  await page.getByRole('button', { name: 'Connecter Google Agenda' }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
});

test('retour de Google : « en cours » puis connecté, adresse nettoyée, déconnexion', async ({ page }) => {
  let n = 0;
  await simuler(page, {
    ...REGLAGES,
    'GET /api/agenda': (route) => route.fulfill({ status: 200, json: n++ === 0 ? { etat: 'en_cours', erreur: null } : { etat: n > 3 ? 'deconnecte' : 'connecte', erreur: null } }),
    'DELETE /api/agenda': json(202),
  });
  await page.goto('/reglages?agenda=retour');
  await expect(page.getByText('Tes rendez-vous datés vont dans Google Agenda.')).toBeVisible();
  await expect(page).toHaveURL(/\/reglages$/);
  n = 3;
  await page.getByRole('button', { name: 'Déconnecter Google Agenda' }).click();
  await expect(page.getByText("L'agenda Organizer reste dans ton Google Agenda.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connecter Google Agenda' })).toBeVisible();
});

test('refus et accès décoché : des mots calmes, le bouton reste', async ({ page }) => {
  await simuler(page, { ...REGLAGES, 'GET /api/agenda': json(200, { etat: 'echec', erreur: 'portee_refusee' }) });
  await page.goto('/reglages?agenda=refus');
  await expect(page.getByText("Connexion annulée. Rien n'a changé.")).toBeVisible();
  await expect(page.getByText("Coche l'accès à l'agenda pour connecter.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connecter Google Agenda' })).toBeVisible();
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/web/test/agenda.test.ts && pnpm --filter @organizer/web e2e -- agenda.spec.ts`
Expected: FAIL : `../src/lib/agenda.js` introuvable ; l'interrupteur et la section n'existent pas.

- [ ] **Step 4: Écrire le code**

`apps/web/src/lib/messages.ts` : importer `MINUTES_ALARME` à côté de `MAX_CLES_PAR_COMPTE`, et ajouter avant la section Réglages :
```ts
  // Alarme et Google Agenda
  alarme: `Alarme ${MINUTES_ALARME} minutes avant`,
  alarmeAide: 'Elle sonne par Google Agenda, seulement pour ce rendez-vous.',
  alarmeActivee: `Alarme activée, ${MINUTES_ALARME} minutes avant.`,
  alarmeRetiree: 'Alarme retirée.',
  connecterAgenda: 'Connecter Google Agenda',
  deconnecterAgenda: 'Déconnecter Google Agenda',
  agendaConnecte: 'Tes rendez-vous datés vont dans Google Agenda.',
  agendaDeconnecte: 'Tes rendez-vous datés peuvent aller dans ton Google Agenda.',
  agendaSansPensees: "Seulement l'heure et un titre court. Jamais tes pensées.",
  agendaEnCours: 'Connexion à Google Agenda en cours.',
  agendaAttente: 'Ça prend du temps. Reviens dans un moment.',
  agendaDeconnexion: 'Déconnexion de Google Agenda en cours.',
  agendaRevoque: "Google Agenda n'est plus relié. Tu peux le reconnecter.",
  agendaSupprime: "L'agenda Organizer a été supprimé. Tu peux le recréer.",
  agendaEchec: "La connexion n'a pas abouti. Réessaie quand tu veux.",
  agendaPorteeRefusee: "Coche l'accès à l'agenda pour connecter.",
  agendaIndisponible: "Google Agenda n'est pas encore configuré.",
  agendaRefus: "Connexion annulée. Rien n'a changé.",
  agendaExpire: 'Lien expiré. Recommence.',
  agendaGarde: "L'agenda Organizer reste dans ton Google Agenda.",
```

`apps/web/src/lib/api.ts` : importer `ReponseAgenda, ReponseConnexionAgenda` ; ajouter à `ClientApi`
```ts
  agenda(): Promise<ReponseAgenda>;
  connecterAgenda(): Promise<ReponseConnexionAgenda>;
  deconnecterAgenda(): Promise<void>;
```
et à l'objet renvoyé par `creerClientApi`
```ts
    agenda: () => json(appeler('GET', '/api/agenda')),
    connecterAgenda: () => json(appeler('POST', '/api/agenda/connexion')),
    deconnecterAgenda: () => sansCorps(appeler('DELETE', '/api/agenda')),
```

`apps/web/src/lib/agenda.ts` :
```ts
import type { ReponseAgenda } from '@organizer/shared/api';
import type { ClientApi } from './api.js';
import { MESSAGES } from './messages.js';

export type RetourAgenda = 'retour' | 'refus' | 'expire';
export interface VueAgenda { ligne: string; bouton: 'connecter' | 'deconnecter' | null }

/** Issue posée par l'API dans l'adresse de retour (/reglages?agenda=…). Toute autre valeur est ignorée. */
export function lireRetour(recherche: string): RetourAgenda | null {
  const v = new URLSearchParams(recherche).get('agenda');
  return v === 'retour' || v === 'refus' || v === 'expire' ? v : null;
}

export function messageRetour(r: RetourAgenda): string | null {
  if (r === 'refus') return MESSAGES.agendaRefus;
  if (r === 'expire') return MESSAGES.agendaExpire;
  return null;
}

/** Ce que Réglages montre : une ligne d'état, et au plus un bouton. Rien n'est jamais signalé ailleurs. */
export function vueAgenda(r: ReponseAgenda): VueAgenda {
  switch (r.etat) {
    case 'indisponible': return { ligne: MESSAGES.agendaIndisponible, bouton: null };
    case 'deconnecte': return { ligne: MESSAGES.agendaDeconnecte, bouton: 'connecter' };
    case 'en_cours': return { ligne: MESSAGES.agendaEnCours, bouton: null };
    case 'connecte': return { ligne: MESSAGES.agendaConnecte, bouton: 'deconnecter' };
    case 'deconnexion': return { ligne: MESSAGES.agendaDeconnexion, bouton: null };
    case 'revoque': return { ligne: MESSAGES.agendaRevoque, bouton: 'connecter' };
    case 'agenda_supprime': return { ligne: MESSAGES.agendaSupprime, bouton: 'connecter' };
    case 'echec': return { ligne: r.erreur === 'portee_refusee' ? MESSAGES.agendaPorteeRefusee : MESSAGES.agendaEchec, bouton: 'connecter' };
  }
}

/** L'échange avec Google se fait sur le serveur en quelques secondes : on interroge tant qu'il est en cours. */
export async function attendreIssue(
  api: Pick<ClientApi, 'agenda'>, attendre: (ms: number) => Promise<void>, essais = 30, pasMs = 1000,
): Promise<ReponseAgenda> {
  let r = await api.agenda();
  for (let i = 0; i < essais && (r.etat === 'en_cours' || r.etat === 'deconnexion'); i++) {
    await attendre(pasMs);
    r = await api.agenda();
  }
  return r;
}
```

`apps/web/src/lib/composants/DetailItem.svelte` : après la section « Quand » (`</section>` qui suit `.choix`), insérer
```svelte
  {#if ligne.echeanceType === 'datee'}
    <section class="carte">
      <button
        class="interrupteur" role="switch" aria-checked={ligne.alarme} aria-disabled={envoi}
        onclick={() => corriger(() => ({ alarme: !ligne.alarme }), ligne.alarme ? MESSAGES.alarmeRetiree : MESSAGES.alarmeActivee)}
      >
        <span>{MESSAGES.alarme}</span><span class="curseur" aria-hidden="true"></span>
      </button>
      <p class="discret">{MESSAGES.alarmeAide}</p>
    </section>
  {/if}
```
et dans `<style>` :
```css
  .interrupteur {
    display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px;
    min-height: var(--touch-min); padding: 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left;
  }
  .curseur { position: relative; flex: none; width: 44px; height: 26px; border-radius: var(--radius-pill); background: var(--muted); }
  .curseur::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
    border-radius: var(--radius-pill); background: var(--surface); transition: transform 0.15s;
  }
  .interrupteur[aria-checked='true'] .curseur { background: var(--accent); }
  .interrupteur[aria-checked='true'] .curseur::after { transform: translateX(18px); }
```
La correction ferme le détail et recharge la liste (comportement existant de `surCorrige`) : la cloche de la ligne apparaît ou disparaît.

`apps/web/src/routes/reglages/+page.svelte` :
1. Script : importer `replaceState` depuis `$app/navigation` (à côté de `goto`), `attendreIssue, lireRetour, messageRetour, vueAgenda, type VueAgenda` depuis `$lib/agenda`, et ajouter
```ts
  let vueAg = $state<VueAgenda | null>(null);
  let messageAgenda = $state<string | null>(null);
  let occupeAgenda = $state(false);
  const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function chargerAgenda(): Promise<void> {
    const retour = lireRetour(location.search);
    if (retour) replaceState(CHEMINS.reglages, {});
    messageAgenda = retour ? messageRetour(retour) : null;
    try {
      if (retour === 'retour') vueAg = vueAgenda({ etat: 'en_cours', erreur: null });
      const r = retour === 'retour' ? await attendreIssue(api, dormir) : await api.agenda();
      vueAg = vueAgenda(r);
      if (r.etat === 'en_cours') messageAgenda = MESSAGES.agendaAttente;
    } catch {
      messageAgenda = MESSAGES.serveurIndisponible;
    }
  }

  async function connecterAgenda(): Promise<void> {
    occupeAgenda = true;
    messageAgenda = null;
    try {
      const { url } = await api.connecterAgenda();
      location.assign(url);
    } catch (e) {
      messageAgenda = e instanceof Error ? e.message : MESSAGES.serveurIndisponible;
      occupeAgenda = false;
    }
  }

  async function deconnecterAgenda(): Promise<void> {
    occupeAgenda = true;
    messageAgenda = null;
    try {
      await api.deconnecterAgenda();
      vueAg = vueAgenda(await attendreIssue(api, dormir));
      messageAgenda = MESSAGES.agendaGarde;
    } catch {
      messageAgenda = MESSAGES.serveurIndisponible;
    }
    occupeAgenda = false;
  }
```
et, en première ligne de `onMount`, `void chargerAgenda();`.
2. Gabarit : après le paragraphe `messageEmpreinte` et avant la carte « Ce qui sort de la maison » :
```svelte
  <h2 class="groupe">Google Agenda</h2>
  <div class="carte agenda">
    <p>{vueAg?.ligne ?? ''}</p>
    <p class="discret">{MESSAGES.agendaSansPensees}</p>
  </div>
  {#if vueAg?.bouton === 'connecter'}
    <button class="bouton activer" onclick={connecterAgenda} disabled={occupeAgenda}>{MESSAGES.connecterAgenda}</button>
  {:else if vueAg?.bouton === 'deconnecter'}
    <button class="lien activer" onclick={deconnecterAgenda} disabled={occupeAgenda}>{MESSAGES.deconnecterAgenda}</button>
  {/if}
  <p class="discret message" aria-live="polite">{messageAgenda ?? ''}</p>
```
3. Style : `.agenda { display: grid; gap: 4px; }`.

- [ ] **Step 5: Lancer les tests**

Run: `pnpm vitest run apps/web && pnpm --filter @organizer/web typecheck && pnpm --filter @organizer/web e2e && pnpm --filter @organizer/web budget && pnpm lint`
Expected: PASS ; `regles-produit.test.ts` valide les nouveaux messages (moins de 12 mots, ni « ! » ni « % ») et l'absence de couleur hors tokens ; le budget reste sous 150 Ko.

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La PWA porte l'interrupteur « Alarme 10 minutes avant » sur un rendez-vous daté, et une section Google Agenda dans Réglages : connecter (écran de Google), état après le retour, refus ou accès décoché dits calmement, déconnecter sans rien effacer dans Google ; e2e sur API simulée (2026-10-05). »
```bash
git add apps/web CHANGELOG.md
git commit -m "Ajoute l'interrupteur d'alarme et la section Google Agenda de la PWA" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: Le scheduler dans la stack, sa sortie et l'exploitation

**Files:**
- Modify: `infra/docker-compose.yml`, `infra/.env.example`, `infra/sortie/squid.conf`, `infra/image/Dockerfile`, `infra/image/essai.sh`, `.github/workflows/ci.yml`, `infra/test/compose.test.ts`, `infra/test/image.test.ts`, `infra/test/exploitation.test.ts`, `docs/exploitation.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `apps/scheduler` construit (`dist/main.mjs`, `dist/sonde.mjs`) ; variables `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET_FILE`, `AGENDA_CLE_FILE` (tâches 4 et 10) ; `MESSAGES_ADMIN` (tâche 9).
- Produces : service `scheduler` (image `ghcr.io/djkix/organizer-scheduler`, `10.201.2.12` sur `sortie`, `core`, 256 Mo) ; secrets `google_client_secret`, `agenda_cle` ; variable obligatoire `GOOGLE_CLIENT_ID` ; Squid : `depuis_scheduler` vers `www.googleapis.com` et `oauth2.googleapis.com` ; cinq images en CI ; essai de sortie du scheduler.

- [ ] **Step 1: Écrire les tests**

`infra/test/compose.test.ts`, dans `describe('stack de production', …)` :
1. Le premier test devient
```ts
  it('services du lot 2-A : migrations, proxy sortant et scheduler', () => {
    expect(Object.keys(S).sort()).toEqual(['api', 'db', 'migrate', 'queue', 'scheduler', 'sortie', 'web', 'worker']);
  });
```
2. Dans « conteneurs applicatifs non root », la liste devient `['api', 'worker', 'scheduler', 'migrate', 'web']`.
3. Dans les limites mémoire, ajouter `scheduler: '256m'`.
4. Dans « réseaux », ajouter `expect(reseaux(service('scheduler'))).toEqual(['core', 'sortie']);`.
5. Dans « les adresses du réseau sortie… », ajouter `expect(conf).toContain(`acl depuis_scheduler src ${ip('scheduler')}/32`);`.
6. « API et worker : production… » devient « API, worker et scheduler », boucle sur `['api', 'worker', 'scheduler']` (le scheduler reçoit les mêmes variables communes, dont `HTTPS_PROXY`).
7. Dans « migrations jouées avant… », boucler sur `['api', 'worker', 'scheduler']`.
8. Le test des secrets devient
```ts
  it('secrets : cinq fichiers du dossier secrets/, montés seulement là où ils servent', () => {
    const secrets = (parse(texte, { merge: true }) as { secrets: Record<string, { file: string }> }).secrets;
    expect(Object.keys(secrets).sort()).toEqual(['agenda_cle', 'gemini_api_key', 'google_client_secret', 'telegram_bot_token', 'telegram_webhook_secret']);
    for (const [n, s] of Object.entries(secrets)) expect(s.file, n).toBe(`./secrets/${n}`);
    const monte = (n: string): unknown => (service(n) as unknown as { secrets?: string[] }).secrets;
    expect(monte('api')).toEqual(['telegram_bot_token', 'telegram_webhook_secret']);
    expect(monte('worker')).toEqual(['gemini_api_key']);
    expect(monte('scheduler')).toEqual(['google_client_secret', 'agenda_cle']);
    for (const n of ['db', 'queue', 'web', 'sortie', 'migrate']) expect(monte(n), n).toBeUndefined();
    expect(service('scheduler').environment).toMatchObject({
      GOOGLE_CLIENT_SECRET_FILE: '/run/secrets/google_client_secret', AGENDA_CLE_FILE: '/run/secrets/agenda_cle',
    });
  });
```
9. Dans le test `tmpfs`, la liste devient `['api', 'worker', 'scheduler', 'migrate', 'sortie']`.
10. Nouveau test :
```ts
  it('Google Agenda : même client et même adresse de retour pour l\'API et le scheduler ; aucun volume pour le scheduler', () => {
    for (const n of ['api', 'scheduler']) {
      expect(service(n).environment, n).toMatchObject({
        GOOGLE_CLIENT_ID: '${GOOGLE_CLIENT_ID:?}', GOOGLE_REDIRECT_URI: 'https://${DOMAINE_APP:?}/api/agenda/retour',
      });
    }
    expect((service('scheduler') as unknown as { volumes?: string[] }).volumes).toBeUndefined();
    expect(service('api').environment).not.toHaveProperty('GOOGLE_CLIENT_SECRET_FILE');
  });
```

`infra/test/image.test.ts` :
1. « quatre cibles, aucune en root » devient « cinq cibles » avec `['api', 'worker', 'scheduler', 'web']` pour `USER 1000:1000`.
2. « api et worker finaux sans npm… » boucle sur `['api', 'worker', 'scheduler']`.
3. « dépendances de production… » ajoute `expect(d).toContain('pnpm install --frozen-lockfile --prod --filter @organizer/scheduler...');`.
4. Dans le test de la liste fermée de Squid :
```ts
    expect(s).toContain('acl depuis_scheduler src 10.201.2.12/32');
    expect(s).toContain('acl vers_scheduler dstdomain -n www.googleapis.com oauth2.googleapis.com');
```
et la liste attendue des règles gagne `'http_access allow depuis_scheduler vers_scheduler',` juste avant `'http_access deny all'`.
5. Nouveau test dans `describe('ci.yml', …)` :
```ts
  it('les cinq images sont construites, analysées et publiées', () => {
    const boucles = [...y.matchAll(/for cible in ([a-z ]+); do/g)].map((m) => m[1]);
    expect(boucles).toEqual(['api worker scheduler web sortie', 'api worker scheduler web sortie', 'api worker scheduler web sortie']);
  });
```

`infra/test/exploitation.test.ts`, dans « cite chaque commande de la CLI et de la sonde », ajouter :
```ts
    expect(doc).toContain('scheduler node apps/scheduler/dist/sonde.mjs agenda');
    expect(doc).toContain('scheduler node apps/scheduler/dist/sonde.mjs sortie');
```
et un nouveau test :
```ts
  it('reprend chaque alerte du scheduler', async () => {
    const { MESSAGES_ADMIN } = await import('../../apps/scheduler/src/file.js');
    expect(doc).toContain(MESSAGES_ADMIN.client);
    expect(doc).toContain(MESSAGES_ADMIN.echecs(3).replace('3', 'N'));
    for (const f of [MESSAGES_ADMIN.revoque, MESSAGES_ADMIN.agendaSupprime, MESSAGES_ADMIN.revocationImpossible]) {
      expect(doc).toContain(f('<compte>'));
    }
  });
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run infra/test`
Expected: FAIL : pas de service `scheduler`, pas de règle Squid, quatre images en CI.

- [ ] **Step 3: Écrire la configuration**

`infra/docker-compose.yml` :
1. En tête, remplacer « Le scheduler (agenda, rotation de l'audio) arrive au lot 2. » par « Le scheduler écrit dans Google Agenda (lot 2-A) ; la rotation de l'audio le rejoindra. » et « api et worker n'ont aucune route… » par « api, worker et scheduler n'ont aucune route… ».
2. Service `api`, `environment`, après `WEBAUTHN_ORIGIN` :
```yaml
      # Google Agenda (décision 10) : client OAuth de Franck ; l'API prépare le consentement, sans joindre Google.
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:?}
      GOOGLE_REDIRECT_URI: https://${DOMAINE_APP:?}/api/agenda/retour
```
3. Après le service `worker` :
```yaml
  # Google Agenda (lot 2-A) : seul conteneur qui parle à Google, par « sortie », vers www.googleapis.com
  # et oauth2.googleapis.com seulement. Jeton de rafraîchissement chiffré par agenda_cle.
  scheduler:
    <<: *app
    image: ghcr.io/djkix/organizer-scheduler:${ORGANIZER_VERSION:?}
    environment:
      <<: *app-env
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:?}
      GOOGLE_CLIENT_SECRET_FILE: /run/secrets/google_client_secret
      GOOGLE_REDIRECT_URI: https://${DOMAINE_APP:?}/api/agenda/retour
      AGENDA_CLE_FILE: /run/secrets/agenda_cle
    secrets: [google_client_secret, agenda_cle]
    networks:
      core: {}
      sortie:
        ipv4_address: 10.201.2.12
    depends_on:
      migrate:
        condition: service_completed_successfully
      queue:
        condition: service_healthy
      sortie:
        condition: service_started
    deploy:
      resources:
        limits:
          memory: 256m
```
4. Réseau `sortie` : commentaire « api, worker et scheduler vers le proxy sortant ; adresses fixes reprises dans squid.conf. » ; `core` : « api, worker, scheduler, migrations, base, file. »
5. Bloc `secrets` : ajouter
```yaml
  google_client_secret:
    file: ./secrets/google_client_secret
  agenda_cle:
    file: ./secrets/agenda_cle
```

`infra/.env.example`, après `DOMAINE_APP=…` :
```
# Identifiant du client OAuth « Application Web » de Google Agenda (console Google Cloud de Franck).
# Pas un secret, mais propre à ce déploiement : jamais dans le dépôt. Se termine par .apps.googleusercontent.com
GOOGLE_CLIENT_ID=
```
et dans le bloc des clés :
```
#   secrets/google_client_secret     secret du client OAuth Google Agenda (console Google Cloud)
#   secrets/agenda_cle               clé de chiffrement des jetons Google : openssl rand -base64 32
#                                    (la changer oblige chaque compte à reconnecter Google Agenda)
```

`infra/sortie/squid.conf` : en-tête « … seule route vers Internet de l'API, du worker et du scheduler … » ; après `acl depuis_worker …` :
```
acl depuis_scheduler src 10.201.2.12/32
```
après `acl vers_worker …` :
```
acl vers_scheduler dstdomain -n www.googleapis.com oauth2.googleapis.com
```
et avant `http_access deny all` :
```
http_access allow depuis_scheduler vers_scheduler
```

`infra/image/Dockerfile` :
1. En-tête : « Images d'Organizer : api, worker, scheduler, web, sortie. »
2. Étape `outils`, après `COPY apps/worker/package.json apps/worker/` : `COPY apps/scheduler/package.json apps/scheduler/`.
3. Étape `construction` : `RUN pnpm --filter @organizer/api --filter @organizer/worker --filter @organizer/scheduler build \`.
4. Après `dependances-worker` :
```dockerfile
FROM outils AS dependances-scheduler
RUN pnpm install --frozen-lockfile --prod --filter @organizer/scheduler...
```
5. Après la cible `worker` :
```dockerfile
FROM base-node AS scheduler
# Ni npm, ni npx, ni corepack à l'exécution (le CVE de tar est dans npm) : tout passe par node.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=dependances-scheduler /depot /app
COPY --from=construction /depot/apps/scheduler/dist /app/apps/scheduler/dist
USER 1000:1000
CMD ["node", "apps/scheduler/dist/main.mjs"]
```

`.github/workflows/ci.yml` : dans les trois boucles, `for cible in api worker web sortie; do` devient `for cible in api worker scheduler web sortie; do` ; le nom de l'étape « Construire les quatre images » devient « Construire les cinq images ».

`infra/image/essai.sh` :
1. Après les secrets factices :
```sh
printf 'secret-essai' > "$TRAVAIL/secrets/google_client_secret"
head -c 32 /dev/urandom | base64 | tr -d '\n' > "$TRAVAIL/secrets/agenda_cle"
```
(avant le `chmod 644`).
2. Dans le `.env` : `GOOGLE_CLIENT_ID=essai.apps.googleusercontent.com`.
3. Après la vérification de `migrate` :
```sh
# Scheduler : démarré, non root, racine en lecture seule
i=0
until dc logs --no-color scheduler 2>/dev/null | grep -q 'Scheduler démarré'; do
  i=$((i + 1)); [ "$i" -lt 20 ] || echec "le scheduler ne démarre pas"; sleep 3
done
[ "$(dc exec -T scheduler id -u)" = 1000 ] || echec "scheduler en root"
dc exec -T scheduler sh -c 'touch /essai' 2>/dev/null && echec "scheduler : racine inscriptible"
```
4. Après le contrôle des options d'empreinte :
```sh
# Retour OAuth sans état : toujours vers Réglages, jamais une erreur
[ "$(curl -sS -o /dev/null -w '%{redirect_url}' "$URL/api/agenda/retour?state=x&code=y")" = "$URL/reglages?agenda=expire" ] || echec "retour OAuth"
```
5. Dans le bloc « Sortie », après les essais du worker :
```sh
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://www.googleapis.com | grep -q '^joignable' || echec "scheduler : Google Agenda devrait être joignable"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://oauth2.googleapis.com | grep -q '^joignable' || echec "scheduler : OAuth Google devrait être joignable"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://generativelanguage.googleapis.com | grep -q '^refusé' || echec "scheduler : Gemini devrait être refusé"
dc exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://example.com | grep -q '^refusé' || echec "scheduler : example.com devrait être refusé"
dc exec -T worker node apps/worker/dist/sonde.mjs sortie https://www.googleapis.com | grep -q '^refusé' || echec "worker : Google Agenda devrait être refusé"
dc exec -T api node apps/api/dist/cli.mjs essai-sortie https://oauth2.googleapis.com | grep -q '^refusé' || echec "api : OAuth Google devrait être refusé"
dc exec -T scheduler node -e "fetch('https://www.googleapis.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))" \
  || echec "scheduler : sortie directe possible sans le proxy"
```
(`essayerSortie` n'envoie qu'un `GET` sans jeton : « joignable » veut dire que Squid a ouvert le tunnel et que Google a répondu, quel que soit le statut.)

- [ ] **Step 4: Documenter l'exploitation**

`docs/exploitation.md` :
1. « La stack » : la liste des secrets devient `telegram_bot_token`, `telegram_webhook_secret`, `gemini_api_key`, `google_client_secret`, `agenda_cle` ; dans le tableau des services, après `worker` :
```markdown
| `scheduler` | Google Agenda : connexion OAuth, agenda dédié, événements des rendez-vous datés. Sort par `sortie` vers `www.googleapis.com` et `oauth2.googleapis.com` seulement |
```
et remplacer « Le scheduler n'existe pas encore (lot 2). » par « Le scheduler écrit dans Google Agenda depuis la 1.2.0 ; la rotation de l'audio le rejoindra. » ; images : ajouter `-scheduler`.
2. Variables obligatoires, après `DOMAINE_APP` :
```markdown
| `GOOGLE_CLIENT_ID` | identifiant du client OAuth « Application Web » de Google Agenda (`….apps.googleusercontent.com`) |
```
et au paragraphe « Le compose pose lui-même… » : « , `GOOGLE_REDIRECT_URI` (`https://` + `DOMAINE_APP` + `/api/agenda/retour`) pour l'API et le scheduler ».
3. « Commandes courantes », ajouter deux lignes :
```markdown
| `vm docker compose exec -T scheduler node apps/scheduler/dist/sonde.mjs agenda` | Google Agenda par compte : état, nombre d'événements, jeton présent ou non, dernier rafraîchissement (aucun titre, aucun jeton) |
| `vm docker compose exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie <url>` | la sortie du scheduler vers cette adresse est-elle ouverte ? |
```
4. « Sortie vers Internet » : « l'API (`10.201.2.10`) n'atteint que `api.telegram.org`, le worker (`10.201.2.11`) que `generativelanguage.googleapis.com`, le scheduler (`10.201.2.12`) que `www.googleapis.com` et `oauth2.googleapis.com` ».
5. Nouvelle section, avant « ## Supervision » :
```markdown
## Google Agenda

Chaque compte relie son propre Google Agenda depuis Réglages (décision 10). Le scheduler crée un agenda
« Organizer » dans ce compte (portée `calendar.app.created` : il ne voit rien d'autre) et y écrit chaque
rendez-vous daté, titre court, 30 minutes, sans description et **sans rappel**, sauf alarme demandée sur
l'item (rappel 10 minutes avant). Cocher retire l'événement ; ce que L fait dans Google ne change rien ici.

- Client OAuth : type « Application Web » dans la console Google Cloud de Franck, adresse de retour autorisée
  `https://organizer.djkix.ovh/api/agenda/retour`, application **publiée** (« En production ») : en « Test »,
  Google fait expirer l'autorisation au bout de 7 jours. Identifiant dans `GOOGLE_CLIENT_ID`, secret dans
  `secrets/google_client_secret`.
- Jetons : le jeton de rafraîchissement est chiffré en base (`agenda_google.jeton_chiffre`) par `secrets/agenda_cle`.
  Changer cette clé (`openssl rand -base64 32`) rend les jetons illisibles : chaque compte passe en « n'est plus
  relié » et reconnecte depuis Réglages. Les jetons d'accès ne vivent qu'en mémoire du scheduler.
- Le retour OAuth (`/api/agenda/retour?code=…`) peut apparaître dans le journal d'accès du Nginx Proxy Manager :
  le code ne sert qu'une fois, quelques minutes, et rien sans le secret du client et le vérificateur PKCE.
- État : `sonde.mjs agenda`. États possibles : `connecte`, `en_cours` (échange en cours), `deconnexion`,
  `deconnecte`, `revoque` (autorisation retirée ou expirée), `echec` (`portee_refusee` : L a décoché l'accès à
  l'agenda ; `echange` : code refusé), `agenda_supprime` (L a supprimé l'agenda Organizer).
- Rattrapage : un balayage toutes les 10 minutes réécrit ce qui manque ; rien à faire à la main après une panne.
- Débrancher Google Agenda pour tous : `vm docker compose stop scheduler`. Les rendez-vous restent dans l'application ;
  au redémarrage, le balayage rattrape l'écart.
- Retirer l'accès à la main (révocation impossible) : sur le compte Google concerné, « Gérer votre compte Google »,
  « Sécurité », « Vos connexions à des applications et services tiers », Organizer, « Supprimer tous les accès ».
```
6. « Supervision » : nouveau tableau après celui des alertes du worker :
```markdown
Alertes du scheduler, vers les mêmes destinataires (jamais vers L) :

| Message | Que faire |
| --- | --- |
| « Google Agenda du compte <compte> : autorisation retirée ou expirée. Reconnecter depuis Réglages. » | demander à la personne de reconnecter depuis Réglages ; si cela revient tous les 7 jours, l'application est restée en « Test » dans la console Google |
| « Google Agenda refuse (403 ou 429, raison) : écritures suspendues 15 minutes. » | quota ou refus de Google : la file reprend seule ; si cela dure, console Google Cloud, API Calendar, quotas |
| « Google Agenda : client OAuth refusé. Vérifier GOOGLE_CLIENT_ID et google_client_secret. » | identifiant ou secret faux, ou client supprimé : voir « Changer un secret » |
| « Google Agenda du compte <compte> : l'agenda Organizer a été supprimé. Écritures arrêtées. » | choix de la personne, respecté ; « Connecter Google Agenda » dans Réglages recrée un agenda |
| « Google Agenda : N écritures en échec depuis une heure. » | `vm docker compose logs --since 1h scheduler` (statuts et raisons techniques seulement) |
| « Google Agenda du compte <compte> : révocation impossible. Retirer l'accès depuis le compte Google. » | voir « Google Agenda », retrait à la main |
```
7. « Changer un secret », deux lignes :
```markdown
| Secret du client OAuth | console Google Cloud, client « Organizer », ajouter un secret ; l'écrire dans `secrets/google_client_secret` ; `vm docker compose up -d --force-recreate scheduler` ; supprimer l'ancien secret dans la console. Les autorisations des comptes restent valables |
| Clé `agenda_cle` | `vm 'umask 077; head -c 32 /dev/urandom \| base64 \| tr -d "\n" > secrets/agenda_cle'` ; `vm docker compose up -d --force-recreate scheduler` ; chaque compte reconnecte Google Agenda depuis Réglages |
```
8. « Dépannage rapide », trois lignes :
```markdown
| « Connecter Google Agenda » : Google affiche « redirect_uri_mismatch » | l'adresse de retour du client OAuth doit être exactement `https://organizer.djkix.ovh/api/agenda/retour` |
| Réglages reste sur « Connexion à Google Agenda en cours » | `scheduler` arrêté ou sortie fermée : `vm docker compose ps -a`, `sonde.mjs sortie https://oauth2.googleapis.com` |
| Le bouton « Avec alarme » n'arrive jamais | `telegram-webhook etat`, puis `telegram-webhook poser` (le webhook doit recevoir les `callback_query`) ; agenda du compte connecté ? |
```

- [ ] **Step 5: Lancer les tests et l'essai de fumée**

Run: `pnpm vitest run infra/test`
Expected: PASS.

Run (Docker requis) :
```bash
for cible in api worker scheduler web sortie; do docker buildx build --load --target "$cible" -f infra/image/Dockerfile -t "ghcr.io/djkix/organizer-$cible:essai" .; done
infra/image/essai.sh essai
```
Expected: « Essai de fumée réussi. » ; à défaut de Docker local, la CI le joue (job `images`).

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Le service `scheduler` rejoint la stack (image `organizer-scheduler`, non root, racine en lecture seule, 256 Mo, réseaux `core` et `sortie`) ; Squid ne lui ouvre que `www.googleapis.com` et `oauth2.googleapis.com` ; nouvelle variable obligatoire `GOOGLE_CLIENT_ID`, nouveaux secrets `google_client_secret` et `agenda_cle` ; cinq images en CI ; l'essai de fumée éprouve la sortie du scheduler ; l'exploitation documente Google Agenda et ses alertes (2026-10-05). »
```bash
git add infra .github docs/exploitation.md CHANGELOG.md
git commit -m "Ajoute le scheduler à la stack et documente son exploitation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 15: Publication de la version 1.2.0 et mise en service avec Google

Cette tâche se fait **avec Franck**. L'étiquette, le push, toute action dans la console Google Cloud et sur la VM n'ont lieu qu'avec son accord explicite, donné dans la conversation ; à défaut, s'arrêter après l'étape 2 et lui remettre la procédure. Les libellés de la console Google ci-dessous sont ceux de la « Google Auth Platform » en 2026 tels que connus à la rédaction : **non vérifiés**, ils peuvent avoir bougé ; l'intention de chaque geste prime sur le libellé.

**Files:**
- Modify: `CHANGELOG.md` (publication)

**Interfaces:**
- Consumes: les tâches 1 à 14 fusionnées sur `main` ; `docs/exploitation.md` (« Publier une version », « Mettre à jour », « Revenir à la version précédente », « Google Agenda »).
- Produces: étiquette `v1.2.0`, images `ghcr.io/djkix/organizer-*:1.2.0` (dont la nouvelle `organizer-scheduler`, rendue publique), stack `/opt/stacks/organizer` en 1.2.0, client OAuth publié, Google Agenda relié pour L.

- [ ] **Step 1: Vérifier la branche entière**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @organizer/web e2e && pnpm --filter @organizer/web budget`
Expected: tout passe. Puis CI verte sur la branche `lot2-a-agenda` (jobs `tests` et `images` : cinq images, Trivy, essai de fumée qui éprouve la sortie du scheduler vers les vrais domaines de Google).

Fusion sur `main` : par le skill `superpowers:finishing-a-development-branch`, au choix de Franck.

- [ ] **Step 2: Préparer la publication dans `CHANGELOG.md`**

Sur `main` : renommer « ## [Non publié] » en « ## [1.2.0] - <date du jour> », rouvrir au-dessus une rubrique « ## [Non publié] » vide, et y ajouter sous Modifié : « Le journal publie la version 1.2.0 (<date>). ». Dans la rubrique 1.2.0, ajouter en tête une ligne « Mise à jour » : « Avant `pull` : nouvelle variable `GOOGLE_CLIENT_ID`, nouveaux secrets `google_client_secret` et `agenda_cle`, nouveau compose ; après : `telegram-webhook poser`. »
```bash
git add CHANGELOG.md
git commit -m "Publie la version 1.2.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Franck crée le client OAuth (console Google Cloud, sur son compte)**

1. `https://console.cloud.google.com` : créer un projet `organizer-agenda` (sans facturation : l'API Calendar est gratuite à ce volume), ou choisir le projet de Gemini (question ouverte 3).
2. « API et services », « Bibliothèque » : chercher « Google Calendar API », « Activer ».
3. « Google Auth Platform » (menu, ou « API et services », « Écran de consentement OAuth ») : « Commencer ».
   - Informations sur l'application : nom « Organizer », adresse e-mail d'assistance : celle de Franck.
   - Audience : **Externe** (un compte Gmail personnel ne peut pas choisir « Interne »).
   - Coordonnées : l'adresse de Franck. Accepter le règlement des données utilisateur. « Créer ».
4. « Branding » (Marque) : domaines autorisés : ajouter `djkix.ovh`. **Ne pas** téléverser de logo (un logo déclenche une vérification de la marque par Google). Les liens de page d'accueil et de confidentialité peuvent rester vides pour une application non vérifiée.
5. « Accès aux données » : « Ajouter ou supprimer des niveaux d'accès », saisir à la main `https://www.googleapis.com/auth/calendar.app.created`, « Ajouter à la table », « Mettre à jour », « Enregistrer ». Aucune autre portée. La console la range probablement parmi les portées « sensibles » ; c'est attendu.
6. « Clients » : « Créer un client », type **Application Web**, nom « Organizer ». Origines JavaScript : aucune. URI de redirection autorisés : exactement `https://organizer.djkix.ovh/api/agenda/retour`. « Créer ». Copier l'identifiant (`….apps.googleusercontent.com`) et **télécharger le JSON** ou copier le secret tout de suite : la console récente ne remontre plus le secret après la création (non vérifié ; sinon, « Ajouter un secret »). Ranger les deux dans le gestionnaire de mots de passe, jamais dans le dépôt ni dans une conversation.
7. « Audience » : état de publication « Test » → **« Publier l'application »**, confirmer « En production ». **Ne pas** demander la vérification. Pourquoi : une application externe restée « En test » voit chaque autorisation expirer au bout de **7 jours** (le scheduler alerterait chaque semaine « autorisation retirée ou expirée ») ; en production non vérifiée, l'autorisation dure, au prix d'un écran d'avertissement à la connexion et d'un plafond de 100 utilisateurs (deux suffisent). Si Franck préfère rester en « Test » quelques jours pour essayer, ajouter alors son adresse et celle de L dans « Utilisateurs test », puis publier avant de laisser L s'en servir.

- [ ] **Step 4: Étiqueter et pousser (Franck, ou avec son accord explicite)**

```bash
git tag -a v1.2.0 -m "Version 1.2.0 : Google Agenda et alarme item par item"
git push origin main v1.2.0
```
Expected: CI de l'étiquette verte, job `publication` compris. **Nouveau paquet** : `organizer-scheduler` est créé **privé** par GHCR à sa première publication : page du paquet, « Package settings », « Change visibility », « Public ». Contrôle sans authentification depuis la VM : `vm docker pull ghcr.io/djkix/organizer-scheduler:1.2.0` (et `vm docker pull ghcr.io/djkix/organizer-api:1.2.0`).

- [ ] **Step 5: Mettre à jour la stack sur la VM (Dockge)**

Avec les fonctions `vm` et `cli` de `docs/exploitation.md` (« Gestes depuis le Mac ») :
```bash
# 1. Copie de la base (étape 2 de « Mettre à jour »)
vm 'umask 077; mkdir -p -m 700 ~/sauvegardes; docker compose exec -T db pg_dump -U organizer -Fc organizer > ~/sauvegardes/organizer-$(date +%F).dump'
# 2. Les deux nouveaux secrets, sans passer par l'historique du shell ni par une conversation
ssh -t kix@192.168.1.201 'cd /opt/stacks/organizer && umask 077 && read -rs -p "Secret du client OAuth : " s && printf "%s" "$s" > secrets/google_client_secret && unset s && echo'
vm 'umask 077; head -c 32 /dev/urandom | base64 | tr -d "\n" > secrets/agenda_cle; ls -l secrets/'
```
Recopier aussitôt `agenda_cle` dans le gestionnaire de mots de passe (`vm cat secrets/agenda_cle`, puis effacer l'écran). Les deux fichiers : 600, propriétaire `kix` (uid 1000).

3. Dans **Dockge**, stack `organizer` : « Modifier » ; remplacer le contenu du compose par `infra/docker-compose.yml` de l'étiquette `v1.2.0` ; dans l'éditeur du `.env`, ajouter `GOOGLE_CLIENT_ID=<identifiant du client>` et passer `ORGANIZER_VERSION=1.2.0` ; « Enregistrer », puis **« Mettre à jour »** (tire les images et relance la stack). Sans `GOOGLE_CLIENT_ID`, Dockge affiche le refus du compose (« required variable GOOGLE_CLIENT_ID is missing a value ») : le corriger avant de relancer.
   Repli en ligne de commande : `scp infra/docker-compose.yml kix@192.168.1.201:/opt/stacks/organizer/compose.yaml`, ajout de la variable au `.env`, `sed` de `ORGANIZER_VERSION`, `vm docker compose pull`, `vm docker compose up -d --wait` (repli documenté si `--wait` bute sur `migrate`).
4. Webhook (il doit recevoir les `callback_query` du bouton) : `cli telegram-webhook poser`, puis `cli telegram-webhook etat` sans erreur récente.

Vérifier :
- `vm docker compose ps -a` : `migrate` « Exited (0) », `db`, `queue`, `api`, `web` « healthy », `worker`, `scheduler`, `sortie` « running » ;
- `vm docker compose logs migrate` cite `20261005180000_agenda` ; `vm docker compose logs --since 5m scheduler` contient « Scheduler démarré. » ;
- `vm docker compose exec -T scheduler node apps/scheduler/dist/sonde.mjs agenda` : « Aucun compte relié à Google Agenda. » ;
- `vm docker compose exec -T scheduler node apps/scheduler/dist/sonde.mjs sortie https://oauth2.googleapis.com` : « joignable » ; `… sortie https://example.com` : « refusé » ;
- `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://organizer.djkix.ovh/api/agenda/retour` : `303 https://organizer.djkix.ovh/reglages?agenda=expire` ;
- `curl -s https://organizer.djkix.ovh/api/sante` → `"ok":true`.

Retour arrière : la migration est additive ; remettre le compose de la 1.1.0 et `ORGANIZER_VERSION=1.1.0` dans Dockge, « Mettre à jour » (le conteneur `scheduler`, absent du compose, est retiré ; en ligne de commande : `vm docker compose up -d --remove-orphans`). Aucune restauration. Les événements déjà écrits restent dans Google, figés ; le webhook peut garder `callback_query` (la 1.1.0 ignore ces mises à jour).

- [ ] **Step 6: Essai réel, d'abord par Franck sur son propre compte**

Sur son téléphone Android, PWA installée et mise à jour (fermer toutes ses fenêtres, la rouvrir). Énoncés fabriqués seulement.

1. Réglages, section « Google Agenda » : « Tes rendez-vous datés peuvent aller dans ton Google Agenda. » ; « Connecter Google Agenda ».
2. Écran de Google : choisir le compte ; avertissement **« Google n'a pas validé cette application »** (attendu) → « Paramètres avancés » → « Accéder à djkix.ovh (non sécurisé) » (le nom affiché peut être « Organizer ») ; écran des autorisations : une seule ligne, du type « Créer des agendas secondaires et voir, créer, modifier et supprimer leurs événements », case **cochée** ; « Continuer ». Retour dans Réglages : « Connexion à Google Agenda en cours. » puis « Tes rendez-vous datés vont dans Google Agenda. ». `sonde.mjs agenda` : `connecte, 0 événement(s), jeton présent`.
3. Variante à tester une fois : refaire la connexion en **décochant** la case : Réglages dit « Coche l'accès à l'agenda pour connecter. » ; reconnecter normalement.
4. Application Google Agenda du téléphone : l'agenda « Organizer » apparaît dans la liste des agendas (menu), coché. Vérifier dans les réglages Android que les notifications de Google Agenda sont autorisées (sans quoi aucune alarme ne sonnera, ni ici ni ailleurs).
5. Vocal au bot : « rendez-vous test jeudi à 15 h » : « Reçu. », puis, en moins de deux minutes, un message **silencieux** en réponse au vocal : « Rendez-vous test : jeudi …, 15:00. » et le bouton « Avec alarme ». Dans Google Agenda : un événement 15:00–15:30 dans « Organizer », sans description, **sans notification**.
6. Appuyer sur « Avec alarme » : le message devient « … Alarme 10 minutes avant. » avec « Sans alarme » ; aucun autre message. L'événement affiche une notification 10 minutes avant, en quelques secondes.
7. **Sonnerie réelle** : vocal « rendez-vous test aujourd'hui à <heure dans 20 minutes>, mets-moi une alarme » : le message du bot dit déjà « Alarme 10 minutes avant. » (alarme comprise à la voix) ; 10 minutes avant, le téléphone sonne par Google Agenda.
8. **Sans alarme** : un autre rendez-vous test dans 20 minutes, sans rien demander : **aucune** notification, ni 10 minutes avant ni à l'heure.
9. PWA : ouvrir le premier rendez-vous ; l'interrupteur « Alarme 10 minutes avant » est actif ; le désactiver : « Alarme retirée. » ; la notification de l'événement disparaît.
10. PWA : cocher un rendez-vous et « Annuler » dans les 10 secondes : l'événement ne bouge pas. Cocher sans annuler : l'événement disparaît en moins d'une minute.
11. Supprimer un événement dans Google Agenda : rien ne change dans la PWA.
12. Une pensée dictée (« je me demande si … ») : rien dans l'agenda, aucun message du bot.
13. Journaux sans contenu ni jeton : `vm docker compose logs --since 1h scheduler api worker | grep -c -i -E 'rendez-vous test|ya29\.|1//'` donne `0`.
14. Réglages : « Déconnecter Google Agenda » : « L'agenda Organizer reste dans ton Google Agenda. » ; dans le compte Google (« Sécurité », « Vos connexions à des applications et services tiers »), Organizer n'apparaît plus. Reconnecter : le même agenda « Organizer » est repris (pas de second agenda).

- [ ] **Step 7: Mise en service pour L, sur son téléphone, avec Franck à côté**

Prévenir L avant : l'écran « Google n'a pas validé cette application » est normal (application personnelle, non vérifiée par Google) ; Organizer ne voit que son agenda « Organizer », jamais ses autres agendas ni ses contacts.
1. L ouvre Réglages, « Connecter Google Agenda », choisit **son** compte Google, passe l'avertissement comme à l'étape 6.2, laisse la case cochée, « Continuer ». Réglages : « Tes rendez-vous datés vont dans Google Agenda. ».
2. Dans son application Google Agenda : l'agenda « Organizer » est visible et coché ; les notifications de Google Agenda sont autorisées dans Android.
3. Un vrai rendez-vous daté de L **sans** alarme : il apparaît dans « Organizer », silencieux ; le bouton du bot est là, ignoré : rien ne revient ensuite.
4. Un vrai rendez-vous daté de L **avec** alarme (bouton du bot, ou à la voix, au choix de L) : notification 10 minutes avant.
5. Rien n'est déduit de l'importance : un rendez-vous dit « très important » sans demander d'alarme reste silencieux.

Noter le résultat (oui ou non par point, modèle de téléphone, sans prénom ni contenu) dans le dossier de revue du lot 2-A s'il est rédigé, sinon dans la description de la fusion. Un point en échec à l'étape 7 se traite avant de laisser L s'en servir seule ; Google Agenda se débranche pour tous par `vm docker compose stop scheduler` sans toucher au reste.

---

## Hors de ce plan

- Rotation de l'audio par le scheduler (job quotidien de 4 h), widget Home Assistant, notifications Web Push et canal Android `alarme` (lot 2-B) ; fils, désambiguïsation, sauvegarde (lot 2-C).
- Lecture des créneaux occupés de L (lot 3) ; tout autre portée Google.
- Flux iCalendar de repli (documenté au cahier, non construit).
- Vérification de l'application par Google, logo, page de confidentialité publique.
- Report d'une action (« demain », « la semaine prochaine ») : il n'existe pas encore ; quand il arrivera, il changera la date et le balayage suivra sans code de plus.
- Suppression d'un item (aucun chemin ne l'offre) : son événement resterait dans Google.
- Dossier de revue du lot 2-A (`docs/revue/`), à rédiger si Franck le demande.
