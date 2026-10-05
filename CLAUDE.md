# Organizer

Outil de capture vocale qui trie automatiquement les notes et les choses à faire.
Utilisatrice principale : L. Administrateur : Franck. Auto-hébergé, Android uniquement, interface en français.

## La contrainte qui prime sur tout

L produit des pensées plus vite qu'elle ne peut les écrire. Toute fonctionnalité qui ajoute
une étape avant l'enregistrement est un échec, quelle que soit sa valeur par ailleurs.
Le classement est **différé** et fait par la machine, jamais par l'utilisatrice.

## Règles produit non négociables

1. **Deux flux séparés.** Les actions (cochables, avec échéance) et les pensées (relues, jamais cochées) ne se mélangent dans aucune vue.
2. **Le système ne sollicite jamais de lui-même.** Pas de point du matin, pas de résumé hebdo, pas de relance sur une échéance floue. Une alarme ne sonne que si L l'a activée sur cet item précis.
3. **Zéro culpabilisation.** Aucun compteur de retard, aucun pourcentage, aucune série, aucun graphique, aucune mention « en retard », aucune couleur d'alerte.
4. **Aucun rouge dans l'interface.** Ni retard, ni urgence, ni suppression.
5. **Rien ne se perd.** Une capture non classifiable va en « à revoir » sans déclencher de relance. La transcription est conservée sans limite. L'audio ordinaire tourne quand il dépasse 40 Go, pour tenir la stack sous 50 Go ; l'audio privé, seule trace de la capture, n'est jamais purgé.
6. **Le mode privé est décidé par le point d'entrée, jamais par le contenu.** Une capture faite avec le bouton privé est marquée privée avant d'exister en base. Aucun chemin de code ne peut l'envoyer vers Gemini.
7. **Pas d'emoji dans l'interface**, pas d'illustration de personnage, pas d'état vide félicitant.
8. **Palier payé obligatoire sur l'API Gemini.** Le worker vérifie au démarrage que le projet Cloud est facturé et refuse de tourner sinon.

## Source de vérité

Les fichiers de ce dépôt font foi. Il n'existe aucune version ailleurs qui les
dépasse : le document de cadrage initial est archivé et n'est plus mis à jour.

- @docs/decisions.md — 23 décisions fermées. Ne pas les rouvrir sans demander.
- @docs/cahier-des-charges.md — spécification complète.

Quand une décision change : mettre à jour `docs/decisions.md`, répercuter dans
`docs/cahier-des-charges.md` et dans ce fichier, le tout dans le même commit.
Une contradiction entre ces trois fichiers est un bug à corriger, jamais une
ambiguïté à interpréter. Avant d'attaquer un lot, vérifier leur cohérence.

## Stack

| Brique | Choix |
| --- | --- |
| API | NestJS 11 sur Node 22 LTS |
| ORM | Prisma 6 |
| Base | PostgreSQL 17 + pgvector |
| File de jobs | BullMQ sur Valkey 8 |
| IA | API Gemini, `gemini-3.1-flash-lite` (repli `gemini-3.8-flash`) |
| Embeddings | fastembed `bge-small`, en local |
| Agenda | API Google Calendar v3, portée `calendar.app.created` |
| Bot | grammY |
| Front | SvelteKit 2 (Svelte 5), mode statique, PWA Workbox |
| Proxy | Nginx Proxy Manager existant, hors dépôt |

## Arborescence

```
apps/api          NestJS : ingestion, aiguillage privé/ordinaire, REST
apps/worker       traitement asynchrone : appel Gemini, items, rattachement
apps/scheduler    échéances, écriture dans Google Agenda
apps/web          PWA SvelteKit
packages/shared   types et schémas Zod partagés
packages/db       schéma Prisma, migrations, garde-fous SQL du mode privé
prompts/          prompts Gemini versionnés + responseSchema
fixtures/         énoncés FABRIQUÉS pour les tests
infra/            docker-compose.yml, caddy/, image/, sortie/ (production)
scripts/          empaquetage esbuild
infra/dev/        Postgres et Valkey de dev sur la VM Docker, tunnel SSH
design/           tokens et maquettes
docs/             cahier des charges, décisions
```

## Conventions

- TypeScript strict, aucun `any` implicite.
- Toute sortie de modèle est validée par un schéma Zod avant écriture en base.
- Le fournisseur d'IA est derrière une interface `ClassificationProvider`. Basculer sur un modèle local doit rester une affaire de configuration.
- Chaque item stocke la version de prompt et le nom du modèle qui l'a classé.
- Les messages visibles par l'utilisatrice sont en français, tutoiement, phrases de moins de 12 mots.
- Les tâches de traitement sont idempotentes et rejouables sans doublon.
- Chaque commit met à jour `CHANGELOG.md` (rubrique sous « Non publié »), dans le même commit. Toute la documentation est en français.

## Dépôt public — ce qui n'y entre jamais

Le dépôt GitHub est **public** et l'historique Git garde tout. Une seule fuite est définitive.

- Secrets : `.env`, clé d'API Gemini, jeton du bot, clés VAPID, identifiants OAuth Google.
- Corpus de L : captures réelles, transcriptions, exemples de corrections. Les tests utilisent `fixtures/`, qui ne contient que des énoncés fabriqués.
- Données nominatives : prénoms réels dans les prompts, les fixtures, les captures d'écran.

Avant tout commit, vérifier qu'aucun de ces éléments n'est indexé.

## Commandes

```bash
infra/dev/tunnel.sh      # à laisser ouvert : base et file de dev/test sur la VM
pnpm install
pnpm dev                 # api + worker + web en parallèle
pnpm test                # tests unitaires
pnpm lint && pnpm typecheck
pnpm db migrate dev      # CLI Prisma avec le .env racine chargé
```

## État du projet

Lots 0 et 1 menés en parallèle (décision 21, 3 octobre 2026). Le lot 0 collecte et
annote une semaine de captures réelles. Le lot 1 construit l'application sans attendre :
thèmes, types d'échéance et prompt ne sont jamais codés en dur (table ou configuration),
et sont branchés sur la typologie validée. Mise en service directe, sans attendre la
sortie du lot 0 (décision 22, 4 octobre 2026) : l'application démarre avec le prompt actuel
(`tri/v1`), affiné à l'usage ; le corpus du lot 0 reste le jeu de test.

Jalon du lot 0 franchi le 2 octobre 2026 : L confirme le besoin et accepte que ses
vocaux ordinaires passent par Gemini en palier payé. Le prompt peut donc être testé
sur le corpus réel une fois l'annotation faite (format : @docs/guide-annotation.md).

Banc d'essai terrain (décidé par Franck le 2 octobre 2026) : `infra/terrain/`, un bot Telegram seul qui envoie chaque
vocal à Gemini avec le prompt de tri et garde audio et résultats sur le serveur. Il sert
à éprouver le prompt en conditions réelles et à constituer le corpus du lot 0. Ce n'est
pas l'application : il sera retiré quand le lot 1 sera livré. `compose.yaml` est généré
par `genere.py`.

Lot 1-C : déploiement prêt (images, stack, CI, `docs/exploitation.md`) ; la mise en service suit la procédure du plan `docs/superpowers/plans/2026-10-05-lot1-c-deploiement.md`, sans attendre la sortie du lot 0 (décision 22).

Lot 1-D (décision 23, 4 octobre 2026) : reconnexion par empreinte digitale (WebAuthn), avancée du lot 3,
livrée juste après la mise en service. Le mot de passe reste toujours possible ; aucune invite biométrique
ne précède un enregistrement. Plan : `docs/superpowers/plans/2026-10-05-lot1-d-empreinte.md`.
