# Lot 1-C — Déploiement sur le homelab et mise en service : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizer tourne en production sur l'hôte Docker du homelab, publié en HTTPS par le Nginx Proxy Manager, reçoit les vocaux de L par le webhook de `@organizer_lud_bot` à la place du banc d'essai, sans qu'aucune capture ne se perde pendant la bascule, et toutes les portes de mise en service des lots 1-A, 1-B1 et 1-B2 sont vérifiées.

**Architecture:** Deux natures de travail. (1) **Tâches de dépôt 1 à 13**, sur une branche `lot1-c-deploiement`, par sous-agents avec TDD et relecture : configuration de production, erreurs sans contenu, démarrage Telegram robuste et CLI du webhook, bornes de l'API, proxy sortant côté code, Gemini en production, veille, import du banc d'essai, CSP de la PWA, empaquetage esbuild, images Docker et CI GitHub Actions vers GHCR, stack Compose de production avec essai de fumée, documentation d'exploitation. (2) **Mise en service**, partie séparée : procédure numérotée sur le réel (Google Cloud, VM, NPM, Telegram, téléphones), chaque étape avec qui, commande exacte, résultat attendu et retour arrière. Aucune étape d'exploitation n'est cachée dans une tâche de dépôt.

**Tech Stack:** Node 22 (Alpine), esbuild 0.28 (empaquetage), pnpm 12 (installation de production filtrée), Prisma 6 (`migrate deploy`), Caddy 2.11 (coquille, en-têtes, passage vers l'API), Squid (Alpine 3.22, proxy sortant à liste fermée), undici 7 et https-proxy-agent 7 (sortie par le proxy), Docker Compose (Dockge), GitHub Actions et GHCR, Trivy (analyse des images), Vitest 3, Playwright, `yaml` 2 (test du compose).

**Spec:** `docs/cahier-des-charges.md` (Déploiement Docker, Réseaux, Volumes persistants, Publication et TLS, Principes de configuration, Chaîne de livraison, Sécurité et confidentialité, Supervision, Exploitation courante, Rotation de l'audio, Coût estimé de l'API), `docs/decisions.md` (décisions 9, 11, 12, 13, 14, 15, 16, 20), `CLAUDE.md`, `docs/revue/2026-10-03-lot1-a.md` (sections 6.2 et 6.3), `docs/revue/2026-10-03-lot1-b1.md` (section 6.1), `docs/revue/2026-10-04-lot1-b2.md` (section 6.1).

## Global Constraints

- Mise en service directe, sans attendre la sortie du lot 0 (décision 22, 4 octobre 2026) : le prompt en service est `tri/v1`, affiné à l'usage. La procédure commence par confirmer cette version.
- « Une seule stack Docker Compose, déployée via Dockge sur l'hôte Docker existant du homelab (VM 105, décision 13), publiée par le Nginx Proxy Manager existant (conteneur 101). Aucun conteneur n'expose de port sur l'extérieur. »
- Réseaux : « `core` : `api`, `worker`, `scheduler`, `db`, `queue`. Aucune sortie Internet. » « `egress` : `api`, `worker` et `scheduler` uniquement, chacun avec une sortie HTTPS restreinte à une liste fermée de domaines. Aucun autre domaine, aucun autre conteneur. » `api` : `api.telegram.org` (et `fcm.googleapis.com` au lot des notifications) ; `worker` : `generativelanguage.googleapis.com`.
- Principes de configuration : « 1. Aucun secret dans le fichier Compose : un fichier `.env` hors dépôt, plus les secrets Docker [...]. 2. Images épinglées par version majeure et mineure, jamais `latest`. 3. `restart: unless-stopped` sur tous les services applicatifs. 4. Sondes de santé sur `api`, `db` et `queue`, avec dépendance conditionnée à l'état sain. 5. Limites mémoire explicites par service, et plafond de concurrence sur le worker [...]. 6. Journalisation en JSON, rotation à 10 Mo et trois fichiers. 7. Conteneurs applicatifs en utilisateur non root, système de fichiers racine en lecture seule. 8. Migrations Prisma jouées par un conteneur d'initialisation avant le démarrage de l'API. »
- « Limites mémoire par service : 1 Go pour PostgreSQL, 512 Mo pour l'API, 768 Mo pour le worker et son modèle d'embeddings, 256 Mo pour le scheduler, 128 Mo pour la file, 64 Mo pour le front »
- Publication : `organizer.djkix.ovh` (PWA, et l'API sur `/api`), `organizer-bot.djkix.ovh` (`/telegram/webhook`, « restreinte aux plages IP Telegram »). « Certificats Let's Encrypt gérés par le Nginx Proxy Manager. HSTS activé, HTTP/2, redirection HTTP vers HTTPS, taille de requête plafonnée à 30 Mo pour les envois audio. »
- Chaîne de livraison : « Build multi-étages, images publiées sur GHCR en privé, déploiement déclenché manuellement depuis Dockge. Pas de déploiement automatique ».
- Exposition : « Ports publics : Aucun ; seuls 80 et 443 du reverse proxy » ; « Limitation de débit : 60 requêtes par minute et par IP sur l'API, 10 sur l'authentification » ; « En-têtes : CSP stricte, `X-Content-Type-Options`, `Referrer-Policy: no-referrer` » ; « Dépendances : Analyse automatisée des vulnérabilités à chaque build » ; « Accès administrateur : Uniquement par le réseau local ou le VPN du homelab ».
- Session : « Jeton en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, durée 90 jours ». Webhook : « Jeton secret dans l'en-tête, vérifié à chaque appel ».
- « Aucun contenu en clair dans les journaux, même en mode debug, y compris les requêtes sortantes. » Seuls des identifiants, des noms d'erreur et des statuts HTTP sont journalisés.
- Règle n° 6 : « Le mode privé est décidé par le point d'entrée, jamais par le contenu. [...] Aucun chemin de code ne peut l'envoyer vers Gemini. »
- Règle n° 8 : « Palier payé obligatoire sur l'API Gemini. Le worker vérifie au démarrage que le projet Cloud est facturé et refuse de tourner sinon. » Cahier : « La facturation Cloud est activée avant le premier test, y compris avec des énoncés fabriqués. »
- « Un plafond atteint n'est pas une erreur de classement : le worker traite HTTP 402 et la pause du budget comme une indisponibilité temporaire. Les captures restent en file, dans l'ordre, sans passer en `à revoir` ni déclencher de relance [...]. L'administrateur est alerté ; L ne l'est jamais. »
- « Une indisponibilité du serveur ne doit jamais provoquer la perte d'une capture : Telegram sert de tampon. » Règle n° 5 : « Rien ne se perd. »
- « L'exploitation doit être nulle en régime normal [...]. Le système alerte l'administrateur, jamais l'utilisatrice. »
- Décision 12 : « 50 Go maximum pour la stack, en volumes Docker simples. Rotation de l'audio ordinaire déjà transcrit au-delà de 40 Go ». Décision 11 : aucune sauvegarde au démarrage.
- « Modèle Gemini : épinglé par version explicite, jamais un alias glissant ».
- Dépôt public : aucun secret, aucune capture réelle, aucun prénom réel dans le code, les tests, les fixtures, les journaux de CI. Les tests n'utilisent que des énoncés fabriqués.
- TypeScript strict, aucun `any` implicite. Messages vus par L : français, tutoiement, moins de 12 mots.
- Chaque commit met à jour `CHANGELOG.md` (rubrique sous « Non publié »), dans le même commit. Toute la documentation est en français. Message de commit en français, puis une ligne vide, puis `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests avec base et file : tunnel ouvert (`infra/dev/tunnel.sh`), comme aux lots précédents. Les tâches de dépôt ne touchent à aucun serveur de production ; seule la stack de dev `organizer-dev` est utilisée par les tests.

## Review Focus

1. **Bascule Telegram avec des messages en attente ou relivrés** : un vocal envoyé pendant l'arrêt du banc d'essai, ou relivré après l'import, n'est ni perdu, ni accusé « Ce compte n'est pas lié. », ni doublé. Tests : tâche 3 (« lier-chat lie un compte sans code ») et tâche 8 (« une capture déjà reçue par le webhook n'est pas réimportée », « réimporter ne crée rien »).
2. **Capture privée d'une heure (22 à 30 Mo) sur un réseau lent**, à travers NPM, Caddy et Node : aucune coupure par un délai (Node coupe une requête à 5 minutes par défaut). Tests : tâche 1 (« une capture d'une heure n'est jamais coupée par le serveur HTTP ») et tâche 11 (« corps de 30 Mio au moins sur /api, délais au moins égaux à celui de la PWA »).
3. **Erreur inattendue, ou corps JSON illisible qui contient du texte de L** : rien n'est recopié ni dans la réponse ni dans le journal. Tests : tâche 2 (« une erreur inattendue répond 500 sans rien recopier », « un JSON illisible répond 400 sans citer le corps »).
4. **Gemini qui refuse pour quota, budget ou clé (429, 403) ou crédit (402)** : captures gardées en file, ni `a_revoir` ni `a_transcrire`, une seule alerte à l'administrateur. Test : tâche 6 (« quota ou budget (429) : comme un crédit épuisé »).
5. **Coquille servie sous CSP stricte** alors que l'empreinte du script en ligne change à chaque build : l'application démarre sans violation, sur `/` et sur l'enregistreur privé. Tests : tâche 9 (e2e « la coquille démarre sous la CSP sans violation », « l'enregistreur privé enregistre sous la CSP ») et tâche 12 (essai de fumée : la CSP servie contient l'empreinte de l'`index.html` servi).

---

## Choix tranchés

| Sujet | Choix | Pourquoi |
| --- | --- | --- |
| Empaquetage | **esbuild** (`scripts/empaquetage.mjs`) : chaque application devient `dist/*.mjs` ; le code des paquets `@organizer/*` (sources `.ts`) est inclus, toute dépendance de `node_modules` reste externe. L'image installe les dépendances de production par `pnpm install --prod --filter @organizer/<app>...` avec le même `pnpm-lock.yaml`. | Les paquets du dépôt exportent des sources TypeScript avec décorateurs : ni Node (pas de décorateurs en « type stripping ») ni `tsx` en production (transpilation au démarrage, dépendances de dev). Laisser `node_modules` externe évite d'empaqueter NestJS, Prisma et les modules natifs (Argon2) ; un test vérifie que chaque import externe est une dépendance directe de l'application. |
| Prisma en production | `prisma` passe en dépendance de `@organizer/db` ; le service `migrate` (image de l'API) lance `node packages/db/node_modules/prisma/build/index.js migrate deploy`. | Principe 8 ; le client est généré pendant l'installation de production, dans l'image. |
| Chemins | En production, `PROMPTS_DIR` et `AUDIO_STORAGE_PATH` doivent être absolus (`/app/prompts`, `/data/audio`), sinon arrêt au démarrage. | `RACINE_DEPOT` n'a de sens que depuis les sources : dans `dist`, il pointerait vers `/`. |
| Frontal de la stack | **Caddy** (image `organizer-web`) sert la coquille **et** relaie `/api` et `/telegram/webhook` vers l'API. NPM n'a qu'une cible par domaine : `192.168.1.201:7070`. | Les en-têtes (CSP, cache, `no-store`, `Permissions-Policy`) vivent dans le dépôt et sont testés en CI ; NPM ne garde que TLS, HSTS, HTTP/2, taille de corps, délais et liste d'IP Telegram. |
| Coquille dans l'image | Le build de la PWA est copié dans l'image Caddy ; plus de volumes `web-dist` ni `caddy-data`. | Un volume nommé garderait l'ancienne coquille après une mise à jour d'image. Caddy n'a pas d'état (`auto_https off`). |
| Empreinte CSP | Calculée **au build de l'image web** par `apps/web/scripts/entetes.mjs` (lit `build/index.html`, écrit `/etc/caddy/csp.caddy`) ; le même module sert les en-têtes de `vite preview`, donc **tous les e2e tournent sous la vraie CSP**. Le `style="display: contents"` d'`app.html` devient une classe. | Le script en ligne de SvelteKit change à chaque build (`__sveltekit_<hash>`). Une seule source pour la production et les tests. |
| Proxy sortant | **Squid** (image `organizer-sortie`, Alpine 3.22), seule route vers Internet ; `api` et `worker` sont sur des réseaux internes. ACL par adresse source : `api` → `api.telegram.org`, `worker` → `generativelanguage.googleapis.com`, CONNECT 443 seulement. Côté code : `fetch` d'undici avec `EnvHttpProxyAgent` (jamais le `fetch` global modifié) et `https-proxy-agent` pour grammY. | Docker ne filtre pas par domaine. La liste fermée du cahier est une promesse de sécurité : elle n'est pas reportée. FCM et Google Agenda s'ajouteront à `squid.conf` avec leurs lots. |
| Réseaux | `publication` (web seul, port publié) ; `edge` interne (web ↔ api) ; `core` interne ; `sortie` interne (api, worker ↔ proxy) ; `egress` (proxy seul). Sous-réseaux fixes `10.201.1.0/24` (edge) et `10.201.2.0/24` (sortie). | Un réseau qui publie un port a une route vers Internet : l'API n'y est donc plus. `TRUSTED_PROXY` = sous-réseau de Caddy + IP du NPM. |
| Webhook | Posé **à la main** par une commande de la CLI (`telegram-webhook poser`) : `max_connections: 1`, secret, `allowed_updates: ['message']`, `drop_pending_updates: false`. L'API ne touche jamais au webhook au démarrage. | La pose est l'instant exact de la bascule ; elle ne doit pas arriver par un redémarrage. `max_connections: 1` ferme le dernier chemin d'une pensée voulue privée vers Gemini. |
| Liaison sans fenêtre | Nouvelle commande `lier-chat <nom> <chat_id>`, avec les identifiants de `ALLOWED_CHAT_IDS` du banc d'essai, **avant** la bascule. | Sans elle, les vocaux de L entre la bascule et son `/start <code>` recevraient « Ce compte n'est pas lié. » et ne seraient pas gardés. |
| Contrôle du palier | Gardé (`serviceTier`) ; nouvelle sonde `sonde palier` qui affiche statut, palier, réflexion et jetons, sans contenu ; porte vérifiée avec un vrai projet non facturé (étape A3, sous réserve de l'accord de Franck). | Si `serviceTier` ne distingue pas le projet non facturé, la mise en service s'arrête (voir Hors de ce plan). |
| Pause de budget | 402 → `CreditEpuise` ; 403 et 429 → `FournisseurIndisponible` : même pause de file, une alerte admin au libellé propre, jamais `a_revoir`. | Le code exact d'une pause de budget n'est pas documenté ; les trois codes plausibles sont couverts. L'étape A4 tente de l'observer. |
| Réflexion | `GEMINI_THINKING_LEVEL` (défaut de la stack : vide, valeur relevée en A2) → `generationConfig.thinkingConfig.thinkingLevel` ; vide = non envoyé. | Vérifié en A2 sur le vrai modèle ; si refusé (HTTP 400), la variable reste vide. |
| CI et GHCR | GitHub Actions : tests (Postgres et Valkey en services), e2e, construction des 4 images, essai de fumée sur la topologie réelle, Trivy ; publication sur GHCR **seulement sur une étiquette `v*`**, sous la version sans `v` (`1.0.0`). La VM s'authentifie par un jeton classique `read:packages` (étape B3), sauf si Franck rend les images publiques (question 4). | « Pas de déploiement automatique » : la CI publie, Franck déploie depuis Dockge. Le `GITHUB_TOKEN` suffit à publier. |
| Supervision | `GET /api/sante` (base et file, 200 ou 503, adresse vue) pour Uptime Kuma ; veille dans l'API toutes les 15 min (file > 50, plus de 3 échecs par heure, audio > 30 Go, base > 8 Go, latence > 120 s, 10 jours sans capture) vers la file d'alertes existante, une alerte par constat jusqu'au retour à la normale. | Seuils du cahier ; l'API reste le seul expéditeur. |
| Rotation de l'audio | **Reportée au lot 2** (elle appartient au scheduler, qui n'existe pas). Rien n'est supprimé d'ici là, donc rien ne se perd ; la veille alerte dès 30 Go, soit plusieurs mois avant le plafond de 40 Go (20 à 45 Go par an). | Écrire le scheduler pour un seuil atteint au mieux dans huit mois serait prématuré ; l'alerte laisse la marge. |
| Banc d'essai | Arrêté à la bascule, conservé arrêté 7 jours, puis retiré ; son volume n'est supprimé que sur décision de Franck. Import de ses captures dans l'application par `importer-terrain` (idempotent par `source_ref`), si Franck le décide (question 1). | Le volume sert encore à la relecture du corpus (`tools/relecture`). |

### Écarts au cahier, répercutés dans `docs/cahier-des-charges.md` par la tâche 12

- `scheduler` absent de la stack jusqu'au lot 2 ; rotation de l'audio rattachée au lot 2.
- Service `sortie` (Squid, 64 Mo) ajouté ; réseaux `publication`, `edge` interne et `sortie`.
- Volumes `web-dist`, `caddy-data` et `models-emb` retirés (coquille dans l'image ; embeddings au lot 2).
- Caddy relaie `/api` et le webhook ; NPM n'a qu'une cible.
- Seuil d'alerte audio à 30 Go tant que la rotation n'existe pas.

---

## Structure des fichiers

```
packages/shared/src/chemins.ts            + cheminConfigure (chemins absolus en production)
packages/shared/src/api.ts                + TAILLE_MAX_CAPTURE_PRIVEE, delaiEnvoiPriveMs, DELAI_ENVOI_PRIVE_MAX_MS
packages/shared/src/sortie.ts             creerFetchSortant, agentSortant, essayerSortie (proxy sortant)
packages/db/package.json                  prisma en dépendance (migrations en production)
apps/api/src/http.ts                      + lireConfianceProxy, configurerServeur, no-store, erreurs de corps, filtre global
apps/api/src/erreurs.ts                   FiltreSansContenu, erreurDeCorps
apps/api/src/sante.controller.ts          GET /api/sante
apps/api/src/telegram/demarrage.ts        demarrerTelegram, dormir (Telegram injoignable ≠ arrêt)
apps/api/src/telegram/webhook.ts          poserWebhook, retirerWebhook, etatWebhook
apps/api/src/telegram/client.ts           optionsClientTelegram (apiRoot, agent du proxy)
apps/api/src/ingestion/telechargeur.ts    TelechargeurTelegram (délai, plafond 20 Mo), FichierTropGros
apps/api/src/privees/reencodeur.ts        + ReencodeurBorne, ServeurOccupe
apps/api/src/veille/veille.ts             constater, Veille (alerte une fois par constat)
apps/api/src/veille/mesures.ts            mesurer, tailleDossier
apps/api/src/terrain/import.ts            importerTerrain (captures du banc d'essai)
apps/api/src/cli.ts                       table de commandes : + lier-chat, telegram-webhook, essai-sortie, veille, alerte-essai, importer-terrain
apps/worker/src/classement/provider.ts    + ErreurFournisseur, FournisseurIndisponible
apps/worker/src/classement/gemini.ts      + statuts 403/429, réflexion, délai, diagnostiquer, formaterDiagnostic
apps/worker/src/configuration.ts          lireConfigWorker (partagée par main et sonde)
apps/worker/src/sonde.ts                  CLI : sonde palier | sonde sortie <url>
apps/web/scripts/entetes.mjs              empreintes CSP, en-têtes de la coquille, extrait Caddy
apps/web/src/app.html, app.css            classe .coquille au lieu du style en ligne
apps/web/vite.config.ts                   preview.headers = en-têtes de production
apps/web/e2e/csp.spec.ts                  la PWA sous CSP stricte
scripts/empaquetage.mjs (+ .d.mts)        esbuild, imports externes
.dockerignore                             rien de secret ni de L dans le contexte de build
infra/image/Dockerfile                    cibles api, worker, web, sortie
infra/image/essai.sh                      essai de fumée sur la topologie réelle
infra/caddy/Caddyfile                     (déplacé depuis infra/Caddyfile) coquille, en-têtes, /api, webhook
infra/sortie/squid.conf                   liste fermée de domaines par conteneur
infra/docker-compose.yml                  stack de production réécrite
infra/.env.example                        variables de la stack
infra/test/image.test.ts                  .dockerignore, Dockerfile, Caddyfile, squid.conf
infra/test/compose.test.ts                invariants du compose
.github/workflows/ci.yml                  tests, e2e, images, fumée, Trivy, publication sur étiquette
docs/exploitation.md                      exploitation : déployer, mettre à jour, revenir, secrets, NPM, supervision
vitest.config.ts                          + infra/test
```

Les tests de base et de file demandent le tunnel ouvert (`infra/dev/tunnel.sh`). Les tests sans base (`infra/test`, `packages/shared/test/sortie.test.ts`, `apps/web/test`) se lancent seuls avec `pnpm exec vitest run <chemin>`.

Brancher depuis `main` : `git switch -c lot1-c-deploiement`. Les tâches 11 et 12 se vérifient aussi en CI : pousser la branche (`git push -u origin lot1-c-deploiement`, comme aux lots précédents) et suivre `gh run watch`.

---
## Partie 1 — Tâches de dépôt

### Task 1: Configuration de production (chemins, proxy de confiance, délais HTTP)

**Files:**
- Modify: `packages/shared/src/chemins.ts`, `packages/shared/src/api.ts`, `apps/api/src/config.ts`, `apps/api/src/http.ts`, `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `apps/web/src/lib/prive/file.ts`, `.env.example`, `CHANGELOG.md`
- Test: `packages/shared/test/chemins.test.ts`, `packages/shared/test/transport.test.ts` (nouveau), `apps/api/test/http.test.ts`, `apps/api/test/config.test.ts`

**Interfaces:**
- Consumes: `cheminDepuisRacine`, `lireVar`, `exigerVar` (`@organizer/shared`).
- Produces :
  - `cheminConfigure(nom: string, valeur: string, env?: NodeJS.ProcessEnv): string` dans `packages/shared/src/chemins.ts`.
  - `TAILLE_MAX_CAPTURE_PRIVEE: number` (31 457 280), `delaiEnvoiPriveMs(octets: number): number`, `DELAI_ENVOI_PRIVE_MAX_MS: number` dans `packages/shared/src/api.ts` (donc aussi `@organizer/shared/api`).
  - `lireConfianceProxy(env?: NodeJS.ProcessEnv): string`, `configurerServeur(serveur: import('node:http').Server): void`, `TAILLE_MAX_AUDIO: number` dans `apps/api/src/http.ts`.

- [ ] **Step 1: Écrire les tests**

Ajouter à la fin de `packages/shared/test/chemins.test.ts`, et `cheminConfigure` à son import de `../src/chemins.js` :
```ts
describe('cheminConfigure', () => {
  it('en production, refuse un chemin relatif en nommant la variable', () => {
    expect(() => cheminConfigure('PROMPTS_DIR', 'prompts', { NODE_ENV: 'production' }))
      .toThrow('PROMPTS_DIR doit être un chemin absolu en production');
  });

  it('en production, garde un chemin absolu', () => {
    expect(cheminConfigure('AUDIO_STORAGE_PATH', '/data/audio', { NODE_ENV: 'production' })).toBe('/data/audio');
  });

  it('hors production, résout depuis la racine du dépôt', () => {
    expect(cheminConfigure('PROMPTS_DIR', 'prompts', { NODE_ENV: 'test' })).toBe(join(RACINE_DEPOT, 'prompts'));
  });
});
```

`packages/shared/test/transport.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { DELAI_ENVOI_PRIVE_MAX_MS, delaiEnvoiPriveMs, TAILLE_MAX_CAPTURE_PRIVEE } from '../src/api.js';

describe('contrat de transport des captures privées', () => {
  it('30 Mio au plus par capture', () => {
    expect(TAILLE_MAX_CAPTURE_PRIVEE).toBe(30 * 1024 * 1024);
  });

  it('le délai d\'envoi suit la taille : 60 s, puis 20 Ko/s', () => {
    expect(delaiEnvoiPriveMs(0)).toBe(60_000);
    expect(delaiEnvoiPriveMs(22_000_000)).toBe(60_000 + 1_100_000);
  });

  it('le délai maximal couvre la plus grosse capture, bien au-delà de 5 minutes', () => {
    expect(DELAI_ENVOI_PRIVE_MAX_MS).toBe(delaiEnvoiPriveMs(TAILLE_MAX_CAPTURE_PRIVEE));
    expect(DELAI_ENVOI_PRIVE_MAX_MS).toBeGreaterThan(25 * 60_000);
  });
});
```

Ajouter à la fin de `apps/api/test/http.test.ts` (ajouter `describe` à l'import de `vitest`) :
```ts
import { createServer } from 'node:http';
import { DELAI_ENVOI_PRIVE_MAX_MS } from '@organizer/shared';
import { configurerServeur, lireConfianceProxy } from '../src/http.js';

describe('production', () => {
  it('TRUSTED_PROXY est obligatoire en production', () => {
    expect(() => lireConfianceProxy({ NODE_ENV: 'production' })).toThrow('TRUSTED_PROXY obligatoire en production');
    expect(lireConfianceProxy({ NODE_ENV: 'production', TRUSTED_PROXY: '10.201.1.0/24, 192.168.1.10' }))
      .toBe('10.201.1.0/24, 192.168.1.10');
    expect(lireConfianceProxy({ NODE_ENV: 'test' })).toBe('loopback');
  });

  it('une capture d\'une heure n\'est jamais coupée par le serveur HTTP (5 min par défaut dans Node)', () => {
    const serveur = createServer();
    configurerServeur(serveur);
    expect(serveur.requestTimeout).toBeGreaterThan(DELAI_ENVOI_PRIVE_MAX_MS);
    expect(serveur.keepAliveTimeout).toBeGreaterThan(120_000);
    expect(serveur.headersTimeout).toBeGreaterThan(serveur.keepAliveTimeout);
  });
});
```
(Placer les deux nouveaux `import` en tête du fichier, avec les autres.)

Ajouter dans le `describe` de `apps/api/test/config.test.ts` :
```ts
  it('en production, refuse un AUDIO_STORAGE_PATH relatif', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TELEGRAM_MODE', 'polling');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '0:test');
    vi.stubEnv('AUDIO_STORAGE_PATH', './data/audio');
    expect(() => lireConfigApi()).toThrow('AUDIO_STORAGE_PATH doit être un chemin absolu en production');
  });
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run packages/shared/test/chemins.test.ts packages/shared/test/transport.test.ts apps/api/test/http.test.ts apps/api/test/config.test.ts`
Expected: FAIL (`cheminConfigure`, `TAILLE_MAX_CAPTURE_PRIVEE`, `lireConfianceProxy`, `configurerServeur` introuvables).

- [ ] **Step 3: Implémenter**

Ajouter à `packages/shared/src/chemins.ts` :
```ts
/**
 * Chemin lu dans la configuration. En production, il doit être absolu : RACINE_DEPOT n'a de sens
 * que depuis les sources ; dans un paquet construit (dist), il désignerait la racine du système.
 */
export function cheminConfigure(nom: string, valeur: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production' && !isAbsolute(valeur)) {
    throw new Error(`${nom} doit être un chemin absolu en production : ${valeur}`);
  }
  return cheminDepuisRacine(valeur);
}
```

Ajouter à la fin de `packages/shared/src/api.ts` :
```ts
/** Taille maximale d'une capture privée envoyée par la PWA : 30 Mio (une heure à 48 kbit/s en fait environ 22). */
export const TAILLE_MAX_CAPTURE_PRIVEE = 30 * 1024 * 1024;

/** Délai d'un envoi de la PWA : 60 s de base, puis 20 Ko/s au plancher. Proxy et API attendent au moins autant. */
export const delaiEnvoiPriveMs = (octets: number): number => 60_000 + Math.ceil(octets / 20);

/** Délai de la plus grosse capture admise (environ 27 min). */
export const DELAI_ENVOI_PRIVE_MAX_MS = delaiEnvoiPriveMs(TAILLE_MAX_CAPTURE_PRIVEE);
```

Dans `apps/web/src/lib/prive/file.ts`, compléter l'import existant en `import { delaiEnvoiPriveMs, EN_TETES_CAPTURE_PRIVEE } from '@organizer/shared/api';` et remplacer la ligne `export const delaiEnvoiMs = (octets: number): number => 60_000 + Math.ceil(octets / 20);` (et son commentaire) par :
```ts
/** Contrat partagé avec l'API et le proxy : voir delaiEnvoiPriveMs. */
export const delaiEnvoiMs = delaiEnvoiPriveMs;
```

Dans `apps/api/src/http.ts`, remplacer l'en-tête du fichier jusqu'à la ligne `app.set('trust proxy', ...)` comprise par :
```ts
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DELAI_ENVOI_PRIVE_MAX_MS, lireVar, TAILLE_MAX_CAPTURE_PRIVEE } from '@organizer/shared';
import { json, raw, type NextFunction, type Request, type Response } from 'express';
import { LimiteurDebit } from './auth/limiteur.js';

export const TAILLE_MAX_AUDIO = TAILLE_MAX_CAPTURE_PRIVEE;

/**
 * Adresses dont X-Forwarded-For est cru : en production, le sous-réseau de Caddy et l'IP du Nginx Proxy Manager.
 * Absent en production : arrêt, sinon les limiteurs verraient tout le monde derrière une seule adresse.
 */
export function lireConfianceProxy(env: NodeJS.ProcessEnv = process.env): string {
  const valeur = lireVar('TRUSTED_PROXY', env);
  if (valeur) return valeur;
  if (env.NODE_ENV === 'production') {
    throw new Error('TRUSTED_PROXY obligatoire en production : sous-réseau de Caddy et adresse du Nginx Proxy Manager');
  }
  return 'loopback';
}

/**
 * Node coupe une requête au bout de 5 min par défaut : une capture d'une heure sur un réseau lent
 * en demande jusqu'à DELAI_ENVOI_PRIVE_MAX_MS. Keep-alive au-delà des 2 min de Caddy.
 */
export function configurerServeur(serveur: Server): void {
  serveur.requestTimeout = DELAI_ENVOI_PRIVE_MAX_MS + 60_000;
  serveur.keepAliveTimeout = 130_000;
  serveur.headersTimeout = 135_000;
}

/** Configuration HTTP commune à la production et aux tests. */
export function configurerApp(app: NestExpressApplication): void {
  // X-Forwarded-For n'est cru que des adresses de TRUSTED_PROXY, sinon n'importe qui le falsifierait.
  app.set('trust proxy', lireConfianceProxy());
```
(La suite de `configurerApp` ne change pas.)

Dans `apps/api/src/main.ts`, importer `configurerServeur` depuis `./http.js` et ajouter après `configurerApp(app);` :
```ts
configurerServeur(app.getHttpServer());
```

Dans `apps/api/src/config.ts`, remplacer l'import par `import { chargerPrompt, cheminConfigure, exigerVar, lireVar, valeursAdmises } from '@organizer/shared';` et les deux lignes `audioRacine` et `typesEcheance` par :
```ts
    audioRacine: cheminConfigure('AUDIO_STORAGE_PATH', exigerVar('AUDIO_STORAGE_PATH')),
    typesEcheance: valeursAdmises(
      chargerPrompt(cheminConfigure('PROMPTS_DIR', lireVar('PROMPTS_DIR') ?? 'prompts'), lireVar('PROMPT_VERSION') ?? 'tri/v1'),
      'echeance_type',
    ),
```

Dans `apps/worker/src/main.ts`, remplacer `cheminDepuisRacine` par `cheminConfigure` dans l'import, puis :
```ts
const prompt = chargerPrompt(cheminConfigure('PROMPTS_DIR', lireVar('PROMPTS_DIR') ?? 'prompts'), lireVar('PROMPT_VERSION') ?? 'tri/v1');
```
et `audioRacine: cheminConfigure('AUDIO_STORAGE_PATH', exigerVar('AUDIO_STORAGE_PATH')),`.

Dans `.env.example`, remplacer le commentaire de `TRUSTED_PROXY` par :
```
# Adresses dont X-Forwarded-For est cru, séparées par des virgules. Obligatoire en production
# (sous-réseau de Caddy et IP du Nginx Proxy Manager, voir infra/docker-compose.yml). Défaut ailleurs : loopback
```

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run packages/shared apps/api/test/http.test.ts apps/api/test/config.test.ts apps/web/test/file.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Sécurité : « En production, l'API refuse de démarrer sans proxy de confiance ou avec un chemin relatif, et n'interrompt plus une capture d'une heure au bout de 5 minutes ; taille et délai d'envoi des captures privées sont un contrat partagé entre la PWA et l'API (2026-10-05). »
```bash
git add packages/shared apps/api apps/worker/src/main.ts apps/web/src/lib/prive/file.ts .env.example CHANGELOG.md
git commit -m "Ajoute la configuration de production de l'API et du worker"   # + ligne vide + Co-Authored-By
```

---

### Task 2: Erreurs sans contenu, `/api` jamais en cache, sonde de santé

**Files:**
- Create: `apps/api/src/erreurs.ts`, `apps/api/src/sante.controller.ts`
- Modify: `apps/api/src/http.ts`, `apps/api/src/items/items.controller.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/erreurs.test.ts`, `apps/api/test/sante.test.ts` (nouveaux), `apps/api/test/items.test.ts`

**Interfaces:**
- Consumes: `configurerApp` (tâche 1), jetons `PRISMA`, `REDIS`.
- Produces :
  - `FiltreSansContenu` (filtre NestJS global) et `erreurDeCorps(erreur, req, res, suite): void` dans `apps/api/src/erreurs.ts`.
  - `GET /api/sante` → 200 `{ ok: true, vu: string }` ou 503 `{ ok: false, vu: string }` (`vu` : adresse du client vue par l'API).
  - Toute réponse sous `/api` porte `Cache-Control: no-store`.
  - Corps illisible : 400 `{ message: 'Requête illisible.' }` ; corps trop gros : 413 `{ message: 'Requête trop grosse.' }` ; erreur inattendue : 500 `{ statusCode: 500, message: 'Erreur interne.' }`.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/erreurs.test.ts` (application démarrée avec le journal de production, pour que le test voie ce que la production écrirait) :
```ts
import 'reflect-metadata';
import { BadRequestException, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configurerApp } from '../src/http.js';

@Controller('api/essai')
class EssaiController {
  @Get('panne')
  panne(): never {
    throw new Error('Argument texteEcrit invalide : secret de L');
  }

  @Get('refus')
  refus(): never {
    throw new BadRequestException('Mois attendu au format AAAA-MM.');
  }

  @Post('json')
  json(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [EssaiController] })
class ModuleEssai {}

async function demarrer(): Promise<{ url: string; fermer(): Promise<void> }> {
  const app = await NestFactory.create<NestExpressApplication>(ModuleEssai, { logger: ['error', 'warn', 'log'], bodyParser: false });
  configurerApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, fermer: () => app.close() };
}

function capterJournal(): string[] {
  const journal: string[] = [];
  const capter = (...a: unknown[]): void => {
    journal.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' '));
  };
  for (const m of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation(capter);
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { journal.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { journal.push(String(s)); return true; });
  return journal;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('erreurs de l\'API', () => {
  it('une erreur inattendue répond 500 sans rien recopier, ni dans la réponse ni dans le journal', async () => {
    const app = await demarrer();
    try {
      const journal = capterJournal();
      const r = await fetch(`${app.url}/api/essai/panne`);
      const corps = await r.text();
      vi.restoreAllMocks();
      expect(r.status).toBe(500);
      expect(JSON.parse(corps)).toEqual({ statusCode: 500, message: 'Erreur interne.' });
      expect(journal.join('\n')).not.toContain('secret');
      expect(journal.join('\n')).toContain('Erreur Error sur GET /api/essai/panne');
    } finally {
      await app.fermer();
    }
  });

  it('une erreur HTTP prévue garde son statut et son message', async () => {
    const app = await demarrer();
    try {
      const r = await fetch(`${app.url}/api/essai/refus`);
      expect(r.status).toBe(400);
      expect((await r.json()).message).toBe('Mois attendu au format AAAA-MM.');
    } finally {
      await app.fermer();
    }
  });

  it('un JSON illisible répond 400 sans citer le corps', async () => {
    const app = await demarrer();
    try {
      const journal = capterJournal();
      const r = await fetch(`${app.url}/api/essai/json`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nom":"secret de L", oups',
      });
      const corps = await r.text();
      vi.restoreAllMocks();
      expect(r.status).toBe(400);
      expect(JSON.parse(corps)).toEqual({ message: 'Requête illisible.' });
      expect(journal.join('\n')).not.toContain('secret');
    } finally {
      await app.fermer();
    }
  });

  it('un JSON de plus de 1 Mo répond 413', async () => {
    const app = await demarrer();
    try {
      const r = await fetch(`${app.url}/api/essai/json`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(1_100_000) }),
      });
      expect(r.status).toBe(413);
      expect(await r.json()).toEqual({ message: 'Requête trop grosse.' });
    } finally {
      await app.fermer();
    }
  });

  it('toute réponse sous /api est no-store, erreurs comprises', async () => {
    const app = await demarrer();
    try {
      for (const chemin of ['/api/essai/refus', '/api/essai/panne', '/api/inconnue']) {
        const r = await fetch(`${app.url}${chemin}`);
        expect(r.headers.get('cache-control'), chemin).toBe('no-store');
      }
    } finally {
      await app.fermer();
    }
  });
});
```

`apps/api/test/sante.test.ts` :
```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { afterAll, describe, expect, it } from 'vitest';
import { PRISMA, REDIS } from '../src/jetons.js';
import { SanteController } from '../src/sante.controller.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

async function monter(redis: { ping(): Promise<string> }) {
  class M {}
  Module({ controllers: [SanteController], providers: [{ provide: PRISMA, useValue: prisma }, { provide: REDIS, useValue: redis }] })(M);
  return demarrerAppTest(M);
}

describe('GET /api/sante', () => {
  it('200 quand base et file répondent, avec l\'adresse vue par l\'API, jamais en cache', async () => {
    const app = await monter({ ping: async () => 'PONG' });
    try {
      const r = await fetch(`${app.url}/api/sante`);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual({ ok: true, vu: expect.stringMatching(/127\.0\.0\.1$/) });
    } finally {
      await app.fermer();
    }
  });

  it('503 quand la file ne répond pas', async () => {
    const app = await monter({ ping: async () => { throw new Error('valkey arrêté'); } });
    try {
      const r = await fetch(`${app.url}/api/sante`);
      expect(r.status).toBe(503);
      expect((await r.json()).ok).toBe(false);
    } finally {
      await app.fermer();
    }
  });
});
```

Dans `apps/api/test/items.test.ts`, test « sert l'audio sous un dossier caché… », après `expect(ok.headers.get('content-type')).toContain('audio/ogg');` ajouter :
```ts
      // L'audio, privé compris, ne doit jamais finir dans le cache HTTP du téléphone.
      expect(ok.headers.get('cache-control')).toBe('no-store');
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/api/test/erreurs.test.ts apps/api/test/sante.test.ts apps/api/test/items.test.ts`
Expected: FAIL (500 « Internal server error » avec le message et la pile au journal ; page d'erreur Express qui cite le corps ; `sante.controller.js` introuvable ; pas de `cache-control`).

- [ ] **Step 3: Implémenter**

`apps/api/src/erreurs.ts` :
```ts
import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';

/**
 * Erreur inattendue : nom et route seulement, jamais le message ni la pile.
 * Une erreur Prisma ou Postgres peut recopier des valeurs, donc du texte de capture.
 * Les erreurs HTTP prévues (400, 401, 404…) gardent la réponse par défaut de NestJS.
 */
@Catch()
export class FiltreSansContenu extends BaseExceptionFilter {
  override catch(erreur: unknown, hote: ArgumentsHost): void {
    if (erreur instanceof HttpException) {
      super.catch(erreur, hote);
      return;
    }
    const http = hote.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const nom = erreur instanceof Error ? erreur.name : 'inconnue';
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    console.error(`Erreur ${nom} sur ${req.method} ${route}`);
    if (!res.headersSent) res.status(500).json({ statusCode: 500, message: 'Erreur interne.' });
  }
}

/** Erreurs des analyseurs de corps (JSON illisible, corps trop gros) : leur message d'origine cite le corps. */
export function erreurDeCorps(erreur: unknown, req: Request, res: Response, suite: NextFunction): void {
  if (res.headersSent) {
    suite(erreur);
    return;
  }
  const e = erreur as { status?: number; type?: string; name?: string };
  const statut = e.status === 413 ? 413 : e.status !== undefined && e.status >= 400 && e.status < 500 ? e.status : 400;
  console.error(`Requête refusée sur ${req.method} ${req.path} : ${e.type ?? e.name ?? 'erreur'}`);
  res.status(statut).json({ message: statut === 413 ? 'Requête trop grosse.' : 'Requête illisible.' });
}
```

`apps/api/src/sante.controller.ts` :
```ts
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { PrismaClient } from '@organizer/db';
import type { Request, Response } from 'express';
import { PRISMA, REDIS } from './jetons.js';

const DELAI_MS = 3_000;

/**
 * Sonde d'Uptime Kuma : base et file joignables. « vu » est l'adresse du client telle que l'API la voit :
 * depuis un téléphone en 4G, elle doit être son adresse publique (contrôle de TRUSTED_PROXY).
 */
@Controller('api/sante')
export class SanteController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: { ping(): Promise<string> },
  ) {}

  @Get()
  async sante(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: boolean; vu: string }> {
    let minuteur: NodeJS.Timeout | undefined;
    const delai = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error('délai')), DELAI_MS);
    });
    const ok = await Promise.race([Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]), delai])
      .then(() => true, () => false);
    clearTimeout(minuteur);
    if (!ok) res.status(503);
    return { ok, vu: req.ip ?? 'inconnue' };
  }
}
```

Dans `apps/api/src/http.ts` : importer `{ erreurDeCorps, FiltreSansContenu } from './erreurs.js'` ; juste après `app.set('trust proxy', lireConfianceProxy());`, ajouter :
```ts
  // Aucune réponse de l'API (listes, audio privé compris) ne doit rester dans un cache HTTP.
  app.use('/api', (_req: Request, res: Response, suite: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    suite();
  });
```
et, après `app.use(json({ limit: '1mb' }));`, ajouter :
```ts
  app.use(erreurDeCorps);
  app.useGlobalFilters(new FiltreSansContenu(app.getHttpAdapter()));
```

Dans `apps/api/src/items/items.controller.ts`, ligne `sendFile`, ajouter `cacheControl: false` aux options :
```ts
    res.type(a.mime).sendFile(a.chemin, { root: this.config.audioRacine, dotfiles: 'allow', cacheControl: false }, (err) => {
```

Dans `apps/api/src/app.module.ts`, importer `SanteController` depuis `./sante.controller.js` et l'ajouter à la liste `controllers`.

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run apps/api`
Expected: PASS (les tests existants de l'API aussi : leurs réponses d'erreur prévues sont inchangées).

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Sécurité : « Une erreur inattendue ou un corps illisible ne recopie plus rien dans la réponse ni dans le journal, aucune réponse de l'API n'est mise en cache, et `GET /api/sante` sert de sonde de supervision (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute le filtre d'erreurs sans contenu et la sonde de santé de l'API"   # + ligne vide + Co-Authored-By
```

---

### Task 3: Telegram en production (démarrage sans Telegram, webhook, liaison directe)

**Files:**
- Create: `apps/api/src/telegram/demarrage.ts`, `apps/api/src/telegram/webhook.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/app.module.ts`, `apps/api/src/telegram/liaison.service.ts`, `apps/api/src/cli.ts`, `.env.example`, `CHANGELOG.md`
- Test: `apps/api/test/telegram-demarrage.test.ts`, `apps/api/test/webhook.test.ts`, `apps/api/test/demarrage-api.test.ts` (nouveaux), `apps/api/test/liaison.test.ts`

**Interfaces:**
- Consumes: `creerBot(token, deps, options?)`, `LiaisonService`, `AuthService`, `lireConfigApi`.
- Produces :
  - `ConfigApi` gagne `telegramApiRoot?: string` (`TELEGRAM_API_ROOT`) et `webhookUrl?: string` (`TELEGRAM_WEBHOOK_URL`), optionnels.
  - `demarrerTelegram(o: OptionsTelegram): Promise<void>` et `dormir(ms: number, signal: AbortSignal): Promise<void>` dans `telegram/demarrage.ts`.
  - `poserWebhook(api: Api, o: { url: string; secret: string }): Promise<void>`, `retirerWebhook(api: Api): Promise<void>`, `etatWebhook(api: Api): Promise<string>` dans `telegram/webhook.ts`.
  - `LiaisonService.lierDirectement(nom: string, chat: bigint): Promise<void>`.
  - CLI réécrite en table `COMMANDES: Record<string, { usage: string; lancer(args: string[], prisma: PrismaClient): Promise<void> }>` ; classe `Usage` ; fonction `apiTelegram(): Api`. Les tâches 5, 7 et 8 ajoutent des entrées à cette table.
  - Commandes : `lier-chat <nom> <chat_id>`, `telegram-webhook poser|retirer|etat`.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/telegram-demarrage.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { demarrerTelegram } from '../src/telegram/demarrage.js';

function fauxBot(echecs: number) {
  let essais = 0;
  const appels: string[] = [];
  const bot = {
    async init(): Promise<void> {
      essais++;
      if (essais <= echecs) throw Object.assign(new Error('getMe 0:secret refusé'), { name: 'HttpError' });
    },
    async start(): Promise<void> { appels.push('start'); },
    api: { async deleteWebhook(): Promise<true> { appels.push('deleteWebhook'); return true; } },
  };
  return { bot, appels, essais: () => essais };
}

const options = (bot: unknown, mode: 'polling' | 'webhook', delais: number[], journal: string[] = [], signal = new AbortController().signal) => ({
  bot: bot as Parameters<typeof demarrerTelegram>[0]['bot'],
  mode, signal, journal: (m: string) => { journal.push(m); },
  attendre: async (ms: number) => { delais.push(ms); },
  quitter: () => {},
});

describe('demarrerTelegram', () => {
  it('réessaie à 5 s en doublant, sans jamais lever ni journaliser le jeton', async () => {
    const f = fauxBot(3);
    const delais: number[] = [];
    const journal: string[] = [];
    await demarrerTelegram(options(f.bot, 'webhook', delais, journal));
    expect(f.essais()).toBe(4);
    expect(delais).toEqual([5_000, 10_000, 20_000]);
    expect(f.appels).toEqual([]);
    expect(journal.join('\n')).not.toContain('secret');
    expect(journal[0]).toContain('HttpError');
  });

  it('plafonne l\'attente à 5 minutes', async () => {
    const f = fauxBot(8);
    const delais: number[] = [];
    await demarrerTelegram(options(f.bot, 'webhook', delais));
    expect(delais).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });

  it('en polling, retire le webhook puis lance le polling une fois prêt', async () => {
    const f = fauxBot(1);
    await demarrerTelegram(options(f.bot, 'polling', []));
    expect(f.appels).toEqual(['deleteWebhook', 'start']);
  });

  it('s\'arrête avec l\'API, même si Telegram ne répond jamais', async () => {
    const arret = new AbortController();
    const f = fauxBot(Number.POSITIVE_INFINITY);
    let attentes = 0;
    await demarrerTelegram({
      ...options(f.bot, 'polling', [], [], arret.signal),
      attendre: async () => { if (++attentes === 2) arret.abort(); },
    });
    expect(f.essais()).toBe(2);
    expect(f.appels).toEqual([]);
  });
});
```

`apps/api/test/demarrage-api.test.ts` :
```ts
import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configurerApp } from '../src/http.js';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('l\'API démarre et répond même si Telegram est injoignable', async () => {
  vi.stubEnv('TELEGRAM_MODE', 'webhook');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'secret-essai');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '0:faux');
  // Port 9 de la boucle locale : connexion refusée, comme un Telegram injoignable.
  vi.stubEnv('TELEGRAM_API_ROOT', 'http://127.0.0.1:9');
  vi.stubEnv('AUDIO_STORAGE_PATH', mkdtempSync(join(tmpdir(), 'audio-')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configurerApp(app);
  await app.listen(0, '127.0.0.1');
  try {
    const { port } = app.getHttpServer().address() as { port: number };
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  } finally {
    await app.close();
  }
}, 20_000);
```

`apps/api/test/webhook.test.ts` :
```ts
import { Api } from 'grammy';
import { describe, expect, it } from 'vitest';
import { etatWebhook, poserWebhook, retirerWebhook } from '../src/telegram/webhook.js';

function api(resultat: unknown = true) {
  const appels: { method: string; payload: unknown }[] = [];
  const a = new Api('0:test');
  a.config.use(async (_prev, method, payload) => {
    appels.push({ method, payload });
    return { ok: true, result: resultat } as never;
  });
  return { a, appels };
}

const URL_BOT = 'https://organizer-bot.djkix.ovh/telegram/webhook';

describe('webhook Telegram', () => {
  it('pose le webhook avec le secret, une seule connexion, sans perdre les messages en attente', async () => {
    const { a, appels } = api();
    await poserWebhook(a, { url: URL_BOT, secret: 'abc_DEF-123' });
    expect(appels).toEqual([{
      method: 'setWebhook',
      payload: { url: URL_BOT, secret_token: 'abc_DEF-123', max_connections: 1, allowed_updates: ['message'], drop_pending_updates: false },
    }]);
  });

  it('refuse une adresse qui n\'est pas https://…/telegram/webhook, ou un secret hors de l\'alphabet de Telegram', async () => {
    const { a, appels } = api();
    await expect(poserWebhook(a, { url: 'http://organizer-bot.djkix.ovh/telegram/webhook', secret: 'abc' })).rejects.toThrow('TELEGRAM_WEBHOOK_URL');
    await expect(poserWebhook(a, { url: 'https://organizer.djkix.ovh/api', secret: 'abc' })).rejects.toThrow('TELEGRAM_WEBHOOK_URL');
    await expect(poserWebhook(a, { url: URL_BOT, secret: 'pas de blanc' })).rejects.toThrow('TELEGRAM_WEBHOOK_SECRET');
    expect(appels).toEqual([]);
  });

  it('retirer garde les messages en attente', async () => {
    const { a, appels } = api();
    await retirerWebhook(a);
    expect(appels).toEqual([{ method: 'deleteWebhook', payload: { drop_pending_updates: false } }]);
  });

  it('état : adresse, messages en attente, connexions, dernière erreur', async () => {
    const { a } = api({
      url: URL_BOT, has_custom_certificate: false, pending_update_count: 3, max_connections: 1,
      last_error_date: 1_791_270_720, last_error_message: 'Wrong response from the webhook: 500 Internal Server Error',
    });
    const etat = await etatWebhook(a);
    expect(etat).toContain(`adresse : ${URL_BOT}`);
    expect(etat).toContain('en attente : 3');
    expect(etat).toContain('connexions max : 1');
    expect(etat).toContain('500 Internal Server Error');
  });

  it('état sans webhook : polling ou rien', async () => {
    const { a } = api({ url: '', has_custom_certificate: false, pending_update_count: 0 });
    const etat = await etatWebhook(a);
    expect(etat).toContain('adresse : (aucune)');
    expect(etat).toContain('dernière erreur : aucune');
  });
});
```

Ajouter à la fin de `apps/api/test/liaison.test.ts` :
```ts
describe('lierDirectement (CLI, avant la bascule)', () => {
  it('lier-chat lie un compte sans code, et le rejouer ne change rien', async () => {
    await service().lierDirectement('a', 7n);
    await service().lierDirectement('a', 7n);
    expect((await service().utilisateurDuChat(7))?.id).toBe((await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'a' } })).id);
  });

  it('refuse un chat déjà lié à un autre compte', async () => {
    await service().lierDirectement('a', 7n);
    await expect(service().lierDirectement('b', 7n)).rejects.toThrow('Ce chat est déjà lié à un autre compte.');
  });

  it('refuse d\'écraser le lien d\'un compte : delier d\'abord', async () => {
    await service().lierDirectement('a', 7n);
    await expect(service().lierDirectement('a', 8n)).rejects.toThrow('delier');
  });

  it('refuse un compte inconnu', async () => {
    await expect(service().lierDirectement('inconnu', 9n)).rejects.toThrow('Compte introuvable.');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/api/test/telegram-demarrage.test.ts apps/api/test/webhook.test.ts apps/api/test/demarrage-api.test.ts apps/api/test/liaison.test.ts`
Expected: FAIL (modules introuvables ; `demarrage-api` : `listen` rejette sur l'échec de `bot.init`).

- [ ] **Step 3: Implémenter**

`apps/api/src/telegram/demarrage.ts` :
```ts
import type { Bot } from 'grammy';

const DELAI_INITIAL_MS = 5_000;
const DELAI_MAX_MS = 5 * 60_000;

export interface OptionsTelegram {
  bot: Pick<Bot, 'init' | 'start'> & { api: Pick<Bot['api'], 'deleteWebhook'> };
  mode: 'polling' | 'webhook';
  attendre: (ms: number, signal: AbortSignal) => Promise<void>;
  journal: (message: string) => void;
  signal: AbortSignal;
  quitter: (code: number) => void;
}

/**
 * Prépare le bot sans jamais bloquer ni arrêter l'API : Telegram injoignable au démarrage, on réessaie
 * de 5 s à 5 min. En webhook, grammY initialise de toute façon le bot à la première mise à jour.
 */
export async function demarrerTelegram(o: OptionsTelegram): Promise<void> {
  let delai = DELAI_INITIAL_MS;
  while (!o.signal.aborted) {
    try {
      await o.bot.init();
      break;
    } catch (e) {
      // Nom d'erreur seulement : le message d'une erreur grammY peut citer l'URL, donc le jeton.
      o.journal(`Telegram injoignable (${(e as Error).name}), nouvel essai dans ${delai / 1000} s.`);
      await o.attendre(delai, o.signal);
      delai = Math.min(delai * 2, DELAI_MAX_MS);
    }
  }
  if (o.signal.aborted || o.mode !== 'polling') return;
  await o.bot.api.deleteWebhook({ drop_pending_updates: false });
  // Le polling tourne en tâche de fond : s'il meurt (jeton refusé, conflit), l'API s'arrête, délibérément.
  o.bot.start().catch((err: unknown) => {
    o.journal(`Bot Telegram arrêté : ${(err as Error).name}`);
    o.quitter(1);
  });
}

export const dormir = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resoudre) => {
    const minuteur = setTimeout(resoudre, ms);
    signal.addEventListener('abort', () => { clearTimeout(minuteur); resoudre(); }, { once: true });
  });
```

`apps/api/src/telegram/webhook.ts` :
```ts
import type { Api } from 'grammy';

const ADRESSE = /^https:\/\/[^/\s]+\/telegram\/webhook$/;
const SECRET = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Pose le webhook : c'est l'instant de la bascule depuis le banc d'essai.
 * max_connections 1 : une mise à jour à la fois, donc « prochaine capture privée » est toujours
 * enregistré avant le vocal suivant (dernier chemin d'une pensée voulue privée vers Gemini).
 * drop_pending_updates false : les messages arrivés pendant la bascule sont livrés, jamais jetés.
 */
export async function poserWebhook(api: Api, o: { url: string; secret: string }): Promise<void> {
  if (!ADRESSE.test(o.url)) throw new Error('TELEGRAM_WEBHOOK_URL doit être https://<domaine>/telegram/webhook');
  if (!SECRET.test(o.secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET : 1 à 256 caractères parmi A-Z, a-z, 0-9, _ et -');
  await api.setWebhook(o.url, {
    secret_token: o.secret, max_connections: 1, allowed_updates: ['message'], drop_pending_updates: false,
  });
}

/** Retour arrière : les messages en attente restent chez Telegram pour le prochain lecteur. */
export async function retirerWebhook(api: Api): Promise<void> {
  await api.deleteWebhook({ drop_pending_updates: false });
}

export async function etatWebhook(api: Api): Promise<string> {
  const i = await api.getWebhookInfo();
  const erreur = i.last_error_date
    ? `${new Date(i.last_error_date * 1000).toISOString()} ${i.last_error_message ?? ''}`.trim()
    : 'aucune';
  return [
    `adresse : ${i.url || '(aucune)'}`,
    `en attente : ${i.pending_update_count}`,
    `connexions max : ${i.max_connections ?? '-'}`,
    `dernière erreur : ${erreur}`,
  ].join('\n');
}
```

Dans `apps/api/src/telegram/liaison.service.ts`, ajouter dans la classe :
```ts
  /** Liaison par l'administrateur, sans code : avant la bascule, aucun vocal ne peut tomber sur un chat non lié. */
  async lierDirectement(nom: string, chat: bigint): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.utilisateur.findUnique({ where: { nom } });
      if (!u) throw new Error('Compte introuvable.');
      if (u.telegramChatId === chat) return;
      if (u.telegramChatId !== null) throw new Error('Ce compte est déjà lié à un autre chat : delier d\'abord.');
      if (await tx.utilisateur.findUnique({ where: { telegramChatId: chat } })) throw new Error('Ce chat est déjà lié à un autre compte.');
      await tx.utilisateur.update({ where: { id: u.id }, data: { telegramChatId: chat } });
    });
  }
```

Dans `apps/api/src/config.ts`, ajouter à `ConfigApi` :
```ts
  /** Racine de l'API Bot (tests, serveur Bot API local). Défaut : https://api.telegram.org */
  telegramApiRoot?: string;
  /** Adresse publique du webhook, pour la CLI telegram-webhook. */
  webhookUrl?: string;
```
et à l'objet renvoyé par `lireConfigApi` :
```ts
    telegramApiRoot: lireVar('TELEGRAM_API_ROOT'),
    webhookUrl: lireVar('TELEGRAM_WEBHOOK_URL'),
```

Dans `apps/api/src/app.module.ts` :
- importer `{ demarrerTelegram, dormir } from './telegram/demarrage.js'` ;
- remplacer la classe `Cycle` jusqu'à la fin de `onApplicationBootstrap` et `onApplicationShutdown` par :
```ts
class Cycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private minuterie?: NodeJS.Timeout;
  private alertes?: Worker;
  private readonly arret = new AbortController();

  constructor(
    @Inject(CONFIG) private readonly config: ConfigApi,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(INGESTION) private readonly ingestion: IngestionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Jamais attendu : l'API sert la PWA et /health même si Telegram est injoignable.
    void demarrerTelegram({
      bot: this.bot, mode: this.config.telegramMode, attendre: dormir, signal: this.arret.signal,
      journal: (m) => console.error(m), quitter: (code) => process.exit(code),
    }).catch((err: unknown) => {
      console.error(`Démarrage de Telegram en échec : ${(err as Error).name}`);
      if (this.config.telegramMode === 'polling') process.exit(1);
    });
    this.alertes = demarrerAlertes(this.redis, this.prisma, this.bot);
    this.minuterie = setInterval(() => {
      this.ingestion.reprendre().catch((err: unknown) => {
        console.error(`Reprise des captures en échec (${(err as Error).name})`);
      });
    }, 5 * 60_000);
  }

  async onApplicationShutdown(): Promise<void> {
    this.arret.abort();
    clearInterval(this.minuterie);
    if (this.config.telegramMode === 'polling' && this.bot.isRunning()) await this.bot.stop();
    await this.alertes?.close();
    await this.prisma.$disconnect();
    this.redis.disconnect();
  }
}
```
- fournisseur `BOT` : passer la racine de l'API Bot quand elle est configurée :
```ts
      useFactory: (c: ConfigApi, prisma: PrismaClient, ingestion: IngestionService) =>
        creerBot(c.telegramToken, { liaison: new LiaisonService(prisma), ingestion },
          c.telegramApiRoot ? { client: { apiRoot: c.telegramApiRoot } } : undefined),
```

Remplacer `apps/api/src/cli.ts` par (la fonction `saisirMasque` est reprise telle quelle) :
```ts
import { creerPrisma, type PrismaClient } from '@organizer/db';
import { exigerVar, lireVar } from '@organizer/shared';
import { Api } from 'grammy';
import { AuthService } from './auth/auth.service.js';
import { LiaisonService } from './telegram/liaison.service.js';
import { etatWebhook, poserWebhook, retirerWebhook } from './telegram/webhook.js';

/** Lit une ligne sans l'afficher : la sortie de readline est coupée pendant la frappe. */
async function saisirMasque(invite: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const { Writable } = await import('node:stream');
  let muet = false;
  const sortie = new Writable({ write(morceau, _enc, fin) { if (!muet) process.stdout.write(morceau); fin(); } });
  const saisie = createInterface({ input: process.stdin, output: sortie, terminal: process.stdin.isTTY });
  try {
    const reponse = saisie.question(invite);
    muet = true;
    return await reponse;
  } finally {
    muet = false;
    saisie.close();
    process.stdout.write('\n');
  }
}

/** Arguments manquants ou mal formés : la CLI affiche l'usage de la commande. */
class Usage extends Error {}

export function apiTelegram(): Api {
  const apiRoot = lireVar('TELEGRAM_API_ROOT');
  return new Api(exigerVar('TELEGRAM_BOT_TOKEN'), apiRoot ? { apiRoot } : undefined);
}

interface Commande { usage: string; lancer(args: string[], prisma: PrismaClient): Promise<void> }

// Aucune inscription libre : les comptes se créent ici, par l'administrateur.
const COMMANDES: Record<string, Commande> = {
  'creer-utilisateur': {
    usage: 'creer-utilisateur <nom> [--admin]',
    async lancer([nom, option], prisma) {
      if (!nom) throw new Usage();
      await prisma.utilisateur.create({ data: { nom, admin: option === '--admin' } });
      console.log(`Compte ${nom} créé.`);
    },
  },
  'code-liaison': {
    usage: 'code-liaison <nom>',
    async lancer([nom], prisma) {
      if (!nom) throw new Usage();
      console.log(`Code valable 10 minutes : /start ${await new LiaisonService(prisma).creerCode(nom)}`);
    },
  },
  'lier-chat': {
    usage: 'lier-chat <nom> <chat_id>',
    async lancer([nom, chat], prisma) {
      if (!nom || !chat || !/^-?\d{1,20}$/.test(chat)) throw new Usage();
      await new LiaisonService(prisma).lierDirectement(nom, BigInt(chat));
      console.log(`Compte ${nom} lié au chat ${chat}.`);
    },
  },
  delier: {
    usage: 'delier <nom>',
    async lancer([nom], prisma) {
      if (!nom) throw new Usage();
      await new LiaisonService(prisma).delier(nom);
      console.log(`Compte ${nom} délié.`);
    },
  },
  'mot-de-passe': {
    usage: 'mot-de-passe <nom>',
    async lancer([nom], prisma) {
      if (!nom) throw new Usage();
      const motDePasse = await saisirMasque('Mot de passe (12 caractères minimum) : ');
      if (motDePasse !== (await saisirMasque('Confirme le mot de passe : '))) throw new Error('Les deux saisies diffèrent.');
      await new AuthService(prisma).definirMotDePasse(nom, motDePasse);
      console.log(`Mot de passe de ${nom} enregistré.`);
    },
  },
  'telegram-webhook': {
    usage: 'telegram-webhook poser|retirer|etat',
    async lancer([action]) {
      const api = apiTelegram();
      if (action === 'poser') {
        await poserWebhook(api, { url: exigerVar('TELEGRAM_WEBHOOK_URL'), secret: exigerVar('TELEGRAM_WEBHOOK_SECRET') });
        console.log('Webhook posé.');
      } else if (action === 'retirer') {
        await retirerWebhook(api);
        console.log('Webhook retiré. Les messages en attente restent chez Telegram.');
      } else if (action !== 'etat') {
        throw new Usage();
      }
      console.log(await etatWebhook(api));
    },
  },
};

const [nomCommande, ...args] = process.argv.slice(2);
const commande = nomCommande ? COMMANDES[nomCommande] : undefined;
if (!commande) {
  console.log(`Usage : cli ${Object.values(COMMANDES).map((c) => c.usage).join('\n        cli ')}`);
  process.exitCode = 1;
} else {
  const prisma = creerPrisma();
  try {
    await commande.lancer(args, prisma);
  } catch (err) {
    console.error(err instanceof Usage ? `Usage : cli ${commande.usage}` : (err as Error).message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
```

Dans `.env.example`, après `TELEGRAM_WEBHOOK_SECRET=` :
```
# Adresse publique du webhook, utilisée par « cli telegram-webhook poser »
TELEGRAM_WEBHOOK_URL=https://organizer-bot.djkix.ovh/telegram/webhook
```

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run apps/api`
Expected: PASS.

Run: `pnpm --filter @organizer/api cli`
Expected: l'usage de toutes les commandes, code de sortie 1, aucune connexion à la base.

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « L'API démarre et sert la PWA même si Telegram est injoignable ; la CLI pose, retire et décrit le webhook (une connexion, secret, messages en attente gardés) et lie un compte à un chat sans code (2026-10-05). »
```bash
git add apps/api .env.example CHANGELOG.md
git commit -m "Ajoute le démarrage robuste de Telegram et la CLI du webhook"   # + ligne vide + Co-Authored-By
```

---

### Task 4: Bornes de l'API (ffmpeg, corps sans session, sessions expirées)

**Files:**
- Modify: `apps/api/src/privees/reencodeur.ts`, `apps/api/src/privees/privees.controller.ts`, `apps/api/src/http.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/telegram/liaison.service.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/reencodeur.test.ts`, `apps/api/test/privees.test.ts`, `apps/api/test/auth.test.ts`, `apps/api/test/liaison.test.ts`

**Interfaces:**
- Consumes: `Reencodeur`, `ReencodeurFfmpeg`, `AuthService`, `LiaisonService`, `lireCookie`, `NOM_COOKIE`, `Cycle` (tâche 3).
- Produces :
  - `ServeurOccupe` (erreur) et `ReencodeurBorne(interne: Reencodeur, max = 2, attenteMax = 4)` dans `privees/reencodeur.ts`.
  - `POST /api/captures/privees` : 503 `{ message: 'Serveur occupé. Réessaie plus tard.' }` quand ffmpeg est saturé ; 401 avant lecture du corps sans cookie de session.
  - `AuthService.purgerExpirees(): Promise<number>`, `LiaisonService.purgerCodesExpires(): Promise<number>`.

- [ ] **Step 1: Écrire les tests**

Ajouter à la fin de `apps/api/test/reencodeur.test.ts` (compléter l'import : `import { AudioIllisible, ReencodeurBorne, ReencodeurFfmpeg, ServeurOccupe, type Reencodeur } from '../src/privees/reencodeur.js';`) :
```ts
class Lent implements Reencodeur {
  enCours = 0;
  max = 0;
  liberer: Array<(erreur?: Error) => void> = [];
  async versOpus(d: Buffer): Promise<Buffer> {
    this.enCours++;
    this.max = Math.max(this.max, this.enCours);
    try {
      await new Promise<void>((ok, ko) => this.liberer.push((e) => (e ? ko(e) : ok())));
      return d;
    } finally {
      this.enCours--;
    }
  }
}

const tour = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('ReencodeurBorne', () => {
  it('jamais plus de deux ffmpeg à la fois ; les suivants attendent leur tour, dans l\'ordre', async () => {
    const lent = new Lent();
    const borne = new ReencodeurBorne(lent, 2, 4);
    const envois = [1, 2, 3, 4].map((n) => borne.versOpus(Buffer.from([n])));
    await tour();
    expect(lent.enCours).toBe(2);
    while (lent.liberer.length > 0) {
      lent.liberer.shift()!();
      await tour();
    }
    expect((await Promise.all(envois)).map((b) => b[0])).toEqual([1, 2, 3, 4]);
    expect(lent.max).toBe(2);
  });

  it('au-delà de quatre en attente, refuse tout de suite', async () => {
    const lent = new Lent();
    const borne = new ReencodeurBorne(lent, 2, 4);
    const envois = Array.from({ length: 6 }, () => borne.versOpus(Buffer.from('x')));
    await tour();
    await expect(borne.versOpus(Buffer.from('y'))).rejects.toBeInstanceOf(ServeurOccupe);
    while (lent.liberer.length > 0) {
      lent.liberer.shift()!();
      await tour();
    }
    await Promise.all(envois);
  });

  it('une erreur de ffmpeg libère sa place', async () => {
    const lent = new Lent();
    const borne = new ReencodeurBorne(lent, 1, 4);
    const premier = borne.versOpus(Buffer.from('a'));
    const second = borne.versOpus(Buffer.from('b'));
    await tour();
    lent.liberer.shift()!(new AudioIllisible('ffmpeg : code 1'));
    await expect(premier).rejects.toBeInstanceOf(AudioIllisible);
    await tour();
    lent.liberer.shift()!();
    expect((await second).toString()).toBe('b');
  });
});
```

Ajouter à la fin de `apps/api/test/privees.test.ts` (importer `ServeurOccupe` avec `AudioIllisible`) :
```ts
describe('/api/captures/privees : bornes', () => {
  it('503 quand ffmpeg est saturé : la PWA garde la capture et réessaiera', async () => {
    const auth = new AuthService(prisma);
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const occupe = new CapturesPriveesService(prisma, new StockageAudio(racine), {
      versOpus: async () => { throw new ServeurOccupe('ffmpeg saturé'); },
    });
    class M {}
    Module({ controllers: [PriveesController], providers: [
      { provide: PRIVEES, useValue: occupe }, { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      const r = await fetch(`${app.url}/api/captures/privees`, {
        method: 'POST',
        headers: { cookie: `${NOM_COOKIE}=${s!.jeton}`, 'content-type': 'audio/webm', 'x-capture-id': ID },
        body: Buffer.from('webm'),
      });
      expect(r.status).toBe(503);
      expect((await r.json()).message).toBe('Serveur occupé. Réessaie plus tard.');
      expect(await prisma.capture.count()).toBe(0);
    } finally {
      await app.fermer();
    }
  });

  it('sans cookie de session, 401 avant de lire le corps', async () => {
    class M {}
    Module({ controllers: [PriveesController], providers: [
      { provide: PRIVEES, useValue: service }, { provide: AUTH, useValue: new AuthService(prisma) }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      const r = await fetch(`${app.url}/api/captures/privees`, {
        method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(1024),
      });
      expect(r.status).toBe(401);
      expect((await r.json()).message).toBe('Connecte-toi pour continuer.');
      expect(reencodeur.appels).toBe(0);
    } finally {
      await app.fermer();
    }
  });
});
```

Ajouter à la fin de `apps/api/test/auth.test.ts` :
```ts
describe('purge des sessions', () => {
  it('supprime les sessions expirées, garde les autres', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'p' } });
    await prisma.session.createMany({ data: [
      { jetonHash: 'a'.repeat(64), utilisateurId: u.id, expireLe: new Date('2026-10-01T00:00:00Z') },
      { jetonHash: 'b'.repeat(64), utilisateurId: u.id, expireLe: new Date('2027-01-01T00:00:00Z') },
    ] });
    expect(await auth.purgerExpirees()).toBe(1);
    expect((await prisma.session.findMany()).map((s) => s.jetonHash)).toEqual(['b'.repeat(64)]);
  });
});
```

Ajouter à la fin de `apps/api/test/liaison.test.ts` :
```ts
describe('purge des codes', () => {
  it('supprime les codes expirés, garde les valides', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    await service().creerCode('a');
    horloge = new Date('2026-10-06T08:20:00Z');
    const valide = await service().creerCode('b');
    expect(await service().purgerCodesExpires()).toBe(1);
    expect((await prisma.codeLiaison.findMany()).map((c) => c.code)).toEqual([valide]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/api/test/reencodeur.test.ts apps/api/test/privees.test.ts apps/api/test/auth.test.ts apps/api/test/liaison.test.ts`
Expected: FAIL (`ReencodeurBorne`, `ServeurOccupe`, `purgerExpirees`, `purgerCodesExpires` introuvables ; 500 au lieu de 503).

- [ ] **Step 3: Implémenter**

Ajouter à `apps/api/src/privees/reencodeur.ts` :
```ts
export class ServeurOccupe extends Error {
  override name = 'ServeurOccupe';
}

/**
 * Plafond de ffmpeg simultanés : au plus `max` en cours, `attenteMax` en attente, dans l'ordre d'arrivée.
 * Au-delà, refus immédiat (503) : la PWA garde la capture et réessaie, rien ne se perd.
 */
export class ReencodeurBorne implements Reencodeur {
  private enCours = 0;
  private readonly attente: Array<() => void> = [];

  constructor(private readonly interne: Reencodeur, private readonly max = 2, private readonly attenteMax = 4) {}

  async versOpus(donnees: Buffer): Promise<Buffer> {
    if (this.enCours < this.max) {
      this.enCours++;
    } else {
      if (this.attente.length >= this.attenteMax) throw new ServeurOccupe('ffmpeg saturé');
      // La place est transmise par celui qui sort : enCours ne bouge pas.
      await new Promise<void>((tour) => this.attente.push(tour));
    }
    try {
      return await this.interne.versOpus(donnees);
    } finally {
      const suivant = this.attente.shift();
      if (suivant) suivant();
      else this.enCours--;
    }
  }
}
```

Dans `apps/api/src/privees/privees.controller.ts`, importer `ServeurOccupe` avec `AudioIllisible` et ajouter dans le `catch` de `deposer`, avant `throw e;` :
```ts
      if (e instanceof ServeurOccupe) throw new HttpException({ message: 'Serveur occupé. Réessaie plus tard.' }, 503);
```

Dans `apps/api/src/http.ts`, importer `{ lireCookie, NOM_COOKIE } from './auth/cookies.js'` et remplacer le `app.use('/api/captures/privees', …)` par :
```ts
  app.use('/api/captures/privees', (req: Request, res: Response, suite: NextFunction) => {
    if (req.method !== 'POST' || req.path !== '/') return suite();
    // Sans cookie de session, inutile de lire jusqu'à 30 Mio : refus avant le corps.
    if (!lireCookie(req.headers.cookie, NOM_COOKIE)) {
      res.status(401).json({ message: 'Connecte-toi pour continuer.' });
      return;
    }
    audio(req, res, suite);
  });
```

Dans `apps/api/src/auth/auth.service.ts`, ajouter :
```ts
  /** Sessions expirées : jamais gardées. Renvoie le nombre supprimé. */
  async purgerExpirees(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({ where: { expireLe: { lte: this.maintenant() } } });
    return count;
  }
```

Dans `apps/api/src/telegram/liaison.service.ts`, ajouter :
```ts
  async purgerCodesExpires(): Promise<number> {
    const { count } = await this.prisma.codeLiaison.deleteMany({ where: { expireLe: { lte: this.maintenant() } } });
    return count;
  }
```

Dans `apps/api/src/app.module.ts` :
- importer `ReencodeurBorne` avec `ReencodeurFfmpeg`, et `AuthService` est déjà importé ;
- fournisseur `PRIVEES` : `new CapturesPriveesService(prisma, new StockageAudio(c.audioRacine), new ReencodeurBorne(new ReencodeurFfmpeg()))` ;
- dans `Cycle`, ajouter `@Inject(AUTH) private readonly auth: AuthService,` au constructeur, un champ `private purge?: NodeJS.Timeout;`, puis à la fin de `onApplicationBootstrap` :
```ts
    const purger = (): void => {
      Promise.all([this.auth.purgerExpirees(), new LiaisonService(this.prisma).purgerCodesExpires()]).catch((err: unknown) => {
        console.error(`Purge des sessions en échec (${(err as Error).name})`);
      });
    };
    purger();
    this.purge = setInterval(purger, 6 * 3600_000);
```
et `clearInterval(this.purge);` dans `onApplicationShutdown`, après `clearInterval(this.minuterie);`.

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run apps/api`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Sécurité : « L'API plafonne ffmpeg à deux réencodages simultanés et quatre en attente (503 au-delà, la PWA réessaie), refuse un envoi privé sans cookie avant d'en lire le corps, et purge les sessions et codes de liaison expirés (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute les bornes de l'API : ffmpeg, corps sans session, sessions expirées"   # + ligne vide + Co-Authored-By
```

---
### Task 5: Sortie par le proxy, côté code (fetch, grammY, téléchargeur borné)

**Files:**
- Create: `packages/shared/src/sortie.ts`, `apps/api/src/telegram/client.ts`, `apps/api/src/ingestion/telechargeur.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/package.json`, `apps/api/src/ingestion/ingestion.service.ts`, `apps/api/src/app.module.ts`, `apps/api/src/cli.ts`, `pnpm-lock.yaml`, `CHANGELOG.md`
- Test: `packages/shared/test/sortie.test.ts`, `apps/api/test/sortie-telegram.test.ts`, `apps/api/test/telechargeur.test.ts` (nouveaux), `apps/api/test/ingestion.test.ts`

**Interfaces:**
- Consumes: `IngestionService`, `Telechargeur`, `COMMANDES` et `apiTelegram` de la CLI (tâche 3), `ConfigApi.telegramApiRoot`.
- Produces :
  - `proxySortant(env?): string | undefined`, `creerFetchSortant(env?): typeof fetch`, `agentSortant(env?): HttpsProxyAgent<string> | undefined`, `essayerSortie(url: string, f: typeof fetch): Promise<string>` (« joignable (HTTP n) » ou « refusé (cause) ») dans `@organizer/shared`.
  - `optionsClientTelegram(apiRoot: string | undefined, env?): NonNullable<BotConfig<Context>['client']>` dans `apps/api/src/telegram/client.ts`.
  - `TelechargeurTelegram(jeton: string, f: typeof fetch, o?: { apiRoot?: string; delaiMs?: number; tailleMax?: number })`, `FichierTropGros`, `TAILLE_MAX_TELEGRAM` (20 Mio) dans `apps/api/src/ingestion/telechargeur.ts`.
  - Une capture ordinaire dont l'audio dépasse 20 Mio passe `a_revoir`, erreur `audio_trop_gros`, sans être enfilée ni reprise.
  - CLI : `essai-sortie <url>`.

- [ ] **Step 1: Ajouter les dépendances**

Dans `packages/shared/package.json`, `dependencies` devient :
```json
  "dependencies": { "https-proxy-agent": "^7.0.6", "undici": "^7.0.0", "zod": "^4.1.0" }
```
Run: `pnpm install`
Expected: `pnpm-lock.yaml` mis à jour, aucune erreur.

- [ ] **Step 2: Écrire les tests**

`packages/shared/test/sortie.test.ts` :
```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { agentSortant, creerFetchSortant, essayerSortie, proxySortant } from '../src/sortie.js';

/** Proxy local qui note chaque CONNECT et le refuse, comme Squid pour un domaine hors liste. */
async function proxyQuiRefuse(): Promise<{ url: string; connects: string[]; fermer(): Promise<void> }> {
  const connects: string[] = [];
  const s = createServer((_req, res) => { res.statusCode = 403; res.end(); });
  s.on('connect', (req, socket) => {
    connects.push(req.url ?? '');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`,
    connects,
    fermer: () => new Promise((r) => s.close(() => r())),
  };
}

describe('sortie par le proxy', () => {
  it('sans HTTPS_PROXY, aucun proxy', () => {
    expect(proxySortant({})).toBeUndefined();
    expect(agentSortant({})).toBeUndefined();
  });

  it('fetch passe par le proxy déclaré : le domaine demandé lui est présenté', async () => {
    const p = await proxyQuiRefuse();
    try {
      const f = creerFetchSortant({ HTTPS_PROXY: p.url, NO_PROXY: '' });
      await expect(f('https://domaine-interdit.invalid/')).rejects.toThrow();
      expect(p.connects).toEqual(['domaine-interdit.invalid:443']);
    } finally {
      await p.fermer();
    }
  });

  it('essayerSortie dit « refusé » sans lever quand le proxy refuse', async () => {
    const p = await proxyQuiRefuse();
    try {
      expect(await essayerSortie('https://domaine-interdit.invalid/', creerFetchSortant({ HTTPS_PROXY: p.url }))).toMatch(/^refusé \(/);
    } finally {
      await p.fermer();
    }
  });

  it('NO_PROXY : une adresse locale est jointe directement, et essayerSortie la dit joignable', async () => {
    const p = await proxyQuiRefuse();
    const cible = createServer((_req, res) => { res.statusCode = 204; res.end(); });
    await new Promise<void>((r) => cible.listen(0, '127.0.0.1', r));
    try {
      const f = creerFetchSortant({ HTTPS_PROXY: p.url, NO_PROXY: '127.0.0.1' });
      const url = `http://127.0.0.1:${(cible.address() as AddressInfo).port}/`;
      expect(await essayerSortie(url, f)).toBe('joignable (HTTP 204)');
      expect(p.connects).toEqual([]);
    } finally {
      await p.fermer();
      await new Promise<void>((r) => cible.close(() => r()));
    }
  });
});
```

`apps/api/test/sortie-telegram.test.ts` :
```ts
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Api } from 'grammy';
import { expect, it } from 'vitest';
import { optionsClientTelegram } from '../src/telegram/client.js';

it('grammY passe par le proxy sortant : seul api.telegram.org lui est demandé', async () => {
  const connects: string[] = [];
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    connects.push(req.url ?? '');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const api = new Api('0:faux', optionsClientTelegram(undefined, { HTTPS_PROXY: url }));
    await expect(api.getMe()).rejects.toThrow();
    expect(connects).toEqual(['api.telegram.org:443']);
  } finally {
    await new Promise<void>((r) => proxy.close(() => r()));
  }
});

it('sans proxy ni racine, grammY garde ses réglages par défaut', () => {
  expect(optionsClientTelegram(undefined, {})).toEqual({});
});
```

`apps/api/test/telechargeur.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { FichierTropGros, TelechargeurTelegram } from '../src/ingestion/telechargeur.js';

type Reponse = { status?: number; json?: unknown; octets?: number };

function faux(reponses: Reponse[]) {
  const urls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const r = reponses.shift();
    if (!r) throw new Error('appel inattendu');
    if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
    return new Response(Buffer.alloc(r.octets ?? 4), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, urls };
}

describe('TelechargeurTelegram', () => {
  it('télécharge le fichier et garde son extension', async () => {
    const { f, urls } = faux([{ json: { ok: true, result: { file_path: 'voice/file_1.oga', file_size: 4 } } }, { octets: 4 }]);
    const r = await new TelechargeurTelegram('0:jeton', f).telecharger('F1');
    expect(r.extension).toBe('oga');
    expect(r.donnees.length).toBe(4);
    expect(urls[1]).toBe('https://api.telegram.org/file/bot0:jeton/voice/file_1.oga');
  });

  it('un fichier annoncé au-delà de 20 Mio est trop gros, sans second appel', async () => {
    const { f, urls } = faux([{ json: { ok: true, result: { file_path: 'voice/x.oga', file_size: 25_000_000 } } }]);
    await expect(new TelechargeurTelegram('0:j', f).telecharger('F')).rejects.toBeInstanceOf(FichierTropGros);
    expect(urls).toHaveLength(1);
  });

  it('« file is too big » de Telegram est aussi un fichier trop gros', async () => {
    const { f } = faux([{ status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: file is too big' } }]);
    await expect(new TelechargeurTelegram('0:j', f).telecharger('F')).rejects.toBeInstanceOf(FichierTropGros);
  });

  it('borne chaque appel par un délai', async () => {
    const lent = ((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, rejeter) => {
      init?.signal?.addEventListener('abort', () => rejeter(init.signal!.reason as Error));
    })) as typeof fetch;
    await expect(new TelechargeurTelegram('0:j', lent, { delaiMs: 20 }).telecharger('F')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
```

Ajouter à la fin de `apps/api/test/ingestion.test.ts` (importer `FichierTropGros` depuis `../src/ingestion/telechargeur.js`) :
```ts
describe('audio trop gros pour Telegram', () => {
  it('passe en à revoir, sans enfilage ni boucle de reprise', async () => {
    const s = new IngestionService(prisma, new StockageAudio(racine), {
      telecharger: async () => { throw new FichierTropGros('25000000 octets'); },
    }, file, () => {});
    const { id } = await s.recevoir(utilisateurId, {
      sourceRef: 'tg:7:99', emisLe: new Date('2026-10-06T06:00:00Z'), dureeS: 2400, fichier: { id: 'F', mime: 'audio/ogg' }, texte: null,
    });
    await s.finaliser(id);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({ etat: 'a_revoir', erreur: 'audio_trop_gros' });
    expect(file.ids).toEqual([]);
    expect(await s.reprendre(new Date(Date.now() + 10 * 60_000))).toBe(0);
  });
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `pnpm exec vitest run packages/shared/test/sortie.test.ts apps/api/test/sortie-telegram.test.ts apps/api/test/telechargeur.test.ts apps/api/test/ingestion.test.ts`
Expected: FAIL (modules introuvables).

- [ ] **Step 4: Implémenter**

`packages/shared/src/sortie.ts` :
```ts
import { HttpsProxyAgent } from 'https-proxy-agent';
import { EnvHttpProxyAgent, fetch as fetchUndici } from 'undici';

/** Adresse du proxy sortant (HTTPS_PROXY) ; rien en développement. */
export function proxySortant(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HTTPS_PROXY || env.https_proxy || undefined;
}

/**
 * fetch qui passe par le proxy sortant quand il est configuré (cahier, section Réseaux).
 * undici porte son propre fetch : le fetch global de Node n'est jamais modifié.
 */
export function creerFetchSortant(env: NodeJS.ProcessEnv = process.env): typeof fetch {
  const proxy = proxySortant(env);
  if (!proxy) return (entree, init) => fetch(entree, init);
  const agent = new EnvHttpProxyAgent({ httpProxy: proxy, httpsProxy: proxy, noProxy: env.NO_PROXY ?? env.no_proxy ?? '' });
  const viaProxy = (entree: string | URL, init?: RequestInit) =>
    fetchUndici(entree, { ...(init as object), dispatcher: agent } as unknown as Parameters<typeof fetchUndici>[1]);
  return viaProxy as unknown as typeof fetch;
}

/** Agent pour grammY, qui passe par node-fetch : même proxy, mêmes règles. */
export function agentSortant(env: NodeJS.ProcessEnv = process.env): HttpsProxyAgent<string> | undefined {
  const proxy = proxySortant(env);
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

/** Essai de sortie pour l'exploitation. Aucun corps n'est lu ni affiché. */
export async function essayerSortie(url: string, f: typeof fetch): Promise<string> {
  try {
    const r = await f(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel();
    return `joignable (HTTP ${r.status})`;
  } catch (e) {
    const cause = (e as { cause?: { code?: string; name?: string } }).cause;
    return `refusé (${cause?.code ?? cause?.name ?? (e as Error).name})`;
  }
}
```

Dans `packages/shared/src/index.ts`, ajouter `export * from './sortie.js';`.

`apps/api/src/telegram/client.ts` :
```ts
import { agentSortant } from '@organizer/shared';
import type { BotConfig, Context } from 'grammy';

export type OptionsClient = NonNullable<BotConfig<Context>['client']>;

/** Réglages du client grammY : racine de l'API Bot (tests) et passage par le proxy sortant (production). */
export function optionsClientTelegram(apiRoot: string | undefined, env: NodeJS.ProcessEnv = process.env): OptionsClient {
  const agent = agentSortant(env);
  return {
    ...(apiRoot ? { apiRoot } : {}),
    // compress : réglage par défaut de grammY sous Node, à garder quand on remplace baseFetchConfig.
    ...(agent ? { baseFetchConfig: { agent, compress: true } } : {}),
  };
}
```

`apps/api/src/ingestion/telechargeur.ts` :
```ts
import type { Telechargeur } from './ingestion.service.js';

/** Limite de l'API Bot : au-delà, Telegram ne livre jamais le fichier. */
export const TAILLE_MAX_TELEGRAM = 20 * 1024 * 1024;

export class FichierTropGros extends Error {
  override name = 'FichierTropGros';
}

export interface OptionsTelechargeur { apiRoot?: string; delaiMs?: number; tailleMax?: number }

interface ReponseGetFile { ok: boolean; description?: string; result?: { file_path?: string; file_size?: number } }

/** Téléchargement d'un fichier Telegram : chaque appel borné dans le temps, taille plafonnée. */
export class TelechargeurTelegram implements Telechargeur {
  constructor(private readonly jeton: string, private readonly f: typeof fetch, private readonly o: OptionsTelechargeur = {}) {}

  async telecharger(fichierId: string): Promise<{ donnees: Buffer; extension: string }> {
    const base = this.o.apiRoot ?? 'https://api.telegram.org';
    const max = this.o.tailleMax ?? TAILLE_MAX_TELEGRAM;
    const delai = (): AbortSignal => AbortSignal.timeout(this.o.delaiMs ?? 60_000);
    // Les messages d'erreur ne citent jamais l'URL : elle contient le jeton.
    const r = await this.f(`${base}/bot${this.jeton}/getFile?file_id=${encodeURIComponent(fichierId)}`, { signal: delai() });
    const j = (await r.json()) as ReponseGetFile;
    if (j.description?.includes('file is too big')) throw new FichierTropGros('refusé par Telegram');
    if ((j.result?.file_size ?? 0) > max) throw new FichierTropGros(`${j.result?.file_size} octets`);
    const chemin = j.result?.file_path;
    if (!j.ok || !chemin) throw new Error('Telegram getFile en échec');
    const fichier = await this.f(`${base}/file/bot${this.jeton}/${chemin}`, { signal: delai() });
    if (!fichier.ok) throw new Error(`Téléchargement Telegram : HTTP ${fichier.status}`);
    const donnees = Buffer.from(await fichier.arrayBuffer());
    if (donnees.length > max) throw new FichierTropGros(`${donnees.length} octets`);
    return { donnees, extension: chemin.split('.').pop() ?? 'bin' };
  }
}
```

Dans `apps/api/src/ingestion/ingestion.service.ts`, importer `{ FichierTropGros } from './telechargeur.js'` et, dans `finaliser`, remplacer le bloc `if (c.sourceFichier && !c.audioPath) { … }` par :
```ts
    if (c.sourceFichier && !c.audioPath) {
      let f: { donnees: Buffer; extension: string };
      try {
        f = await this.telechargeur.telecharger(c.sourceFichier);
      } catch (e) {
        if (!(e instanceof FichierTropGros)) throw e;
        // Telegram ne livrera jamais ce fichier : visible dans À revoir, plus jamais retenté.
        await this.prisma.capture.updateMany({ where: { id, etat: 'recue' }, data: { etat: 'a_revoir', erreur: 'audio_trop_gros' } });
        return;
      }
      const audioPath = await this.stockage.ecrire(c.id, c.emisLe, f.donnees, f.extension, 'ordinaire');
      await this.prisma.capture.update({ where: { id }, data: { audioPath } });
    }
```

Dans `apps/api/src/app.module.ts` :
- importer `creerFetchSortant` depuis `@organizer/shared`, `TelechargeurTelegram` depuis `./ingestion/telechargeur.js`, `optionsClientTelegram` depuis `./telegram/client.js` ;
- dans la fabrique `INGESTION`, remplacer l'objet `telechargeur` et son commentaire par :
```ts
        const telechargeur = new TelechargeurTelegram(c.telegramToken, creerFetchSortant(), { apiRoot: c.telegramApiRoot });
```
- fabrique `BOT` :
```ts
      useFactory: (c: ConfigApi, prisma: PrismaClient, ingestion: IngestionService) =>
        creerBot(c.telegramToken, { liaison: new LiaisonService(prisma), ingestion }, { client: optionsClientTelegram(c.telegramApiRoot) }),
```

Dans `apps/api/src/cli.ts` : importer `creerFetchSortant, essayerSortie` depuis `@organizer/shared` et `optionsClientTelegram` depuis `./telegram/client.js` ; `apiTelegram` devient :
```ts
export function apiTelegram(): Api {
  return new Api(exigerVar('TELEGRAM_BOT_TOKEN'), optionsClientTelegram(lireVar('TELEGRAM_API_ROOT')));
}
```
et ajouter à `COMMANDES` :
```ts
  'essai-sortie': {
    usage: 'essai-sortie <url>',
    async lancer([url]) {
      if (!url) throw new Usage();
      console.log(await essayerSortie(url, creerFetchSortant()));
    },
  },
```

- [ ] **Step 5: Vérifier le succès**

Run: `pnpm exec vitest run packages/shared apps/api`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « L'API et le worker sortent par le proxy déclaré dans HTTPS_PROXY (fetch d'undici, agent pour grammY), le téléchargement Telegram est borné à 60 s et 20 Mio, et un audio trop gros passe en À revoir au lieu d'être retenté sans fin (2026-10-05). »
```bash
git add packages/shared apps/api pnpm-lock.yaml CHANGELOG.md
git commit -m "Ajoute la sortie par le proxy et le téléchargement Telegram borné"   # + ligne vide + Co-Authored-By
```

---

### Task 6: Gemini en production (indisponibilités, réflexion, délai, sonde)

**Files:**
- Create: `apps/worker/src/configuration.ts`, `apps/worker/src/sonde.ts`
- Modify: `apps/worker/src/classement/provider.ts`, `apps/worker/src/classement/gemini.ts`, `apps/worker/src/worker.ts`, `apps/worker/src/demarrage.ts`, `apps/worker/src/main.ts`, `apps/worker/package.json`, `.env.example`, `CHANGELOG.md`
- Test: `apps/worker/test/gemini.test.ts`, `apps/worker/test/worker.test.ts`, `apps/worker/test/demarrage.test.ts`

**Interfaces:**
- Consumes: `creerFetchSortant`, `essayerSortie`, `cheminConfigure` (tâches 1 et 5).
- Produces :
  - `ErreurFournisseur(statut: number, message: string)`, `FournisseurIndisponible extends ErreurFournisseur`, `CreditEpuise extends FournisseurIndisponible` (constructeur `(message?: string)`, statut 402) dans `provider.ts`.
  - `OptionsGemini` gagne `niveauReflexion?: string` et `delaiMs?: number` (défaut 120 000).
  - `GeminiProvider.diagnostiquer(): Promise<Diagnostic>` ; `interface Diagnostic { statut: number; tier: string | null; paye: boolean; niveauReflexion: string | null; jetons: { entree: number; sortie: number; reflexion: number } | null }` ; `formaterDiagnostic(d: Diagnostic): string`.
  - `messageIndisponibilite(statut: number): string` dans `worker.ts`.
  - `lireConfigWorker(): { prompt: Prompt; provider: GeminiProvider }` dans `configuration.ts`.
  - Script `pnpm --filter @organizer/worker sonde palier|sortie <url>`.

- [ ] **Step 1: Écrire les tests**

Ajouter à `apps/worker/test/gemini.test.ts` (compléter l'import de `provider.js` avec `FournisseurIndisponible` et celui de `gemini.js` avec `formaterDiagnostic`) :
```ts
describe('GeminiProvider : indisponibilités, réflexion, délai', () => {
  it.each([403, 429])('HTTP %i : indisponibilité temporaire, sans tenter le repli', async (statut) => {
    const { fetch, appels } = faux([{ status: statut }]);
    const e = await provider(fetch).classer({ systeme: 'S', texte: 'x' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FournisseurIndisponible);
    expect((e as FournisseurIndisponible).statut).toBe(statut);
    expect((e as Error).message).not.toContain('contenu');
    expect(appels).toHaveLength(1);
  });

  it('HTTP 402 reste un crédit épuisé, qui est une indisponibilité', async () => {
    const { fetch } = faux([{ status: 402 }]);
    const e = await provider(fetch).classer({ systeme: 'S', texte: 'x' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CreditEpuise);
    expect(e).toBeInstanceOf(FournisseurIndisponible);
  });

  it('demande le niveau de réflexion configuré, et rien s\'il n\'est pas configuré', async () => {
    const avec = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    await new GeminiProvider({ cle: 'c', modele: 'm', repli: 'r', prompt, tiersPayes: ['standard'], fetch: avec.fetch, niveauReflexion: 'minimal' })
      .classer({ systeme: 'S', texte: 'x' });
    expect((avec.appels[0]!.corps.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    const sans = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    await provider(sans.fetch).classer({ systeme: 'S', texte: 'x' });
    expect((sans.appels[0]!.corps.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it('borne l\'appel par un délai', async () => {
    const lent = ((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, rejeter) => {
      init?.signal?.addEventListener('abort', () => rejeter(init.signal!.reason as Error));
    })) as typeof fetch;
    const p = new GeminiProvider({ cle: 'c', modele: 'm', repli: 'r', prompt, tiersPayes: ['standard'], fetch: lent, delaiMs: 20 });
    await expect(p.classer({ systeme: 'S', texte: 'x' })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('GeminiProvider.diagnostiquer', () => {
  it('palier payé : statut, palier, jetons ; aucun contenu', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: 'standard' }]);
    const d = await provider(fetch).diagnostiquer();
    expect(d).toEqual({ statut: 200, tier: 'standard', paye: true, niveauReflexion: null, jetons: { entree: 100, sortie: 20, reflexion: 0 } });
    expect(formaterDiagnostic(d)).toBe('HTTP 200 · palier « standard » : payé · réflexion non demandée · jetons : entrée 100, sortie 20, réflexion 0');
  });

  it('palier absent : REFUSÉ', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: null }]);
    const d = await provider(fetch).diagnostiquer();
    expect(d.paye).toBe(false);
    expect(formaterDiagnostic(d)).toContain('palier « absent » : REFUSÉ');
  });

  it('erreur HTTP : non vérifiable, sans lever', async () => {
    const { fetch } = faux([{ status: 400 }]);
    const d = await provider(fetch).diagnostiquer();
    expect(d).toMatchObject({ statut: 400, paye: false, jetons: null });
    expect(formaterDiagnostic(d)).toBe('HTTP 400 : palier non vérifiable.');
  });
});
```

Ajouter dans le `describe('demarrerWorker', …)` de `apps/worker/test/worker.test.ts` (importer `FournisseurIndisponible` avec `CreditEpuise`) :
```ts
  it('quota ou budget (429) : comme un crédit épuisé, file gardée, une alerte, jamais à revoir', async () => {
    const a = await creerCaptureTexte(prisma, 'un');
    const alertes: string[] = [];
    lancer(new FauxProvider([new FournisseurIndisponible(429, 'Gemini principal : HTTP 429'), resultatExemple()]), alertes);
    await file.add('classer', { captureId: a.id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: a.id });
    await attendre(async () => (await etat(a.id)) === 'classee');
    expect(alertes).toEqual(['Gemini refuse pour quota ou budget (429) : classement suspendu.']);
    expect(await prisma.capture.count({ where: { etat: { in: ['a_revoir', 'a_transcrire'] } } })).toBe(0);
  });
```

Ajouter dans le `describe` de `apps/worker/test/demarrage.test.ts` (importer `ErreurFournisseur`) :
```ts
  it('journalise le statut HTTP de Gemini, jamais plus', async () => {
    const p = faux([new ErreurFournisseur(400, 'Gemini principal : HTTP 400')]);
    const journal: string[] = [];
    await verifierPalierAuDemarrage(p, async () => {}, (m) => { journal.push(m); });
    expect(journal[0]).toContain('Gemini principal : HTTP 400');
  });
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/worker`
Expected: FAIL (`FournisseurIndisponible`, `ErreurFournisseur`, `diagnostiquer`, `formaterDiagnostic` introuvables).

- [ ] **Step 3: Implémenter**

Dans `apps/worker/src/classement/provider.ts`, remplacer la classe `CreditEpuise` par :
```ts
/** Erreur HTTP du fournisseur. Le message ne contient que le modèle et le statut, jamais le corps. */
export class ErreurFournisseur extends Error {
  override name = 'ErreurFournisseur';
  constructor(readonly statut: number, message: string) {
    super(message);
  }
}

/** Crédit, budget, quota ou clé refusés (402, 403, 429) : indisponibilité temporaire, pas une erreur de classement. */
export class FournisseurIndisponible extends ErreurFournisseur {
  override name = 'FournisseurIndisponible';
}

/** Prépaiement épuisé (HTTP 402). */
export class CreditEpuise extends FournisseurIndisponible {
  override name = 'CreditEpuise';
  constructor(message = 'HTTP 402') {
    super(402, message);
  }
}
```

Dans `apps/worker/src/classement/gemini.ts` :
- import : `import { CreditEpuise, ErreurFournisseur, FournisseurIndisponible, PalierNonPaye, SortieNonConforme, type ClassificationProvider, type EntreeClassement, type ResultatClassement } from './provider.js';`
- `OptionsGemini` gagne :
```ts
  /** generationConfig.thinkingConfig.thinkingLevel ; absent = non envoyé. */
  niveauReflexion?: string;
  /** Délai d'un appel, en ms. Défaut : 120 s. */
  delaiMs?: number;
```
- `ReponseGemini.usageMetadata` gagne `thoughtsTokenCount?: number` ; `Brut` gagne `reflexion: number` ;
- ajouter, au niveau du module :
```ts
const CONTROLE: EntreeClassement = { systeme: 'Contrôle de palier. Réponds le JSON minimal.', texte: 'ok' };

export interface Diagnostic {
  statut: number;
  tier: string | null;
  paye: boolean;
  niveauReflexion: string | null;
  jetons: { entree: number; sortie: number; reflexion: number } | null;
}

/** Une ligne pour l'exploitation : statut, palier, réflexion, jetons. Aucun contenu. */
export function formaterDiagnostic(d: Diagnostic): string {
  if (d.statut !== 200 || !d.jetons) return `HTTP ${d.statut} : palier non vérifiable.`;
  return `HTTP 200 · palier « ${d.tier ?? 'absent'} » : ${d.paye ? 'payé' : 'REFUSÉ'} · réflexion ${d.niveauReflexion ?? 'non demandée'}`
    + ` · jetons : entrée ${d.jetons.entree}, sortie ${d.jetons.sortie}, réflexion ${d.jetons.reflexion}`;
}
```
- `verifierPalierPaye` devient :
```ts
  async verifierPalierPaye(): Promise<void> {
    const r = await this.appeler(this.o.modele, CONTROLE);
    if (!r.tier || !this.o.tiersPayes.includes(r.tier)) {
      throw new PalierNonPaye(`Palier Gemini « ${r.tier ?? 'inconnu'} » : palier payé exigé`);
    }
  }

  /** Même requête que le contrôle du palier, sans jamais lever sur une erreur HTTP : pour la sonde. */
  async diagnostiquer(): Promise<Diagnostic> {
    const { statut, brut } = await this.requete(this.o.modele, CONTROLE);
    return {
      statut,
      tier: brut?.tier ?? null,
      paye: !!brut?.tier && this.o.tiersPayes.includes(brut.tier),
      niveauReflexion: this.o.niveauReflexion ?? null,
      jetons: brut ? { entree: brut.entree, sortie: brut.sortie, reflexion: brut.reflexion } : null,
    };
  }
```
- la méthode privée `appeler` est remplacée par ces deux méthodes :
```ts
  private async requete(modele: string, e: EntreeClassement): Promise<{ statut: number; brut: Brut | null }> {
    const parts: Part[] = [];
    if (e.audio) {
      parts.push({ inlineData: { mimeType: e.audio.mime, data: e.audio.donnees.toString('base64') } }, { text: 'Voici le vocal.' });
    }
    if (e.texte) parts.push({ text: `Message écrit, pas de vocal. Ce texte est la transcription :\n${e.texte}` });
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2, responseMimeType: 'application/json', responseSchema: this.o.prompt.responseSchema,
    };
    if (this.o.niveauReflexion) generationConfig.thinkingConfig = { thinkingLevel: this.o.niveauReflexion };

    const r = await (this.o.fetch ?? fetch)(`${URL_API}${modele}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.o.cle },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: e.systeme }] }, contents: [{ role: 'user', parts }], generationConfig }),
      signal: AbortSignal.timeout(this.o.delaiMs ?? 120_000),
    });
    if (!r.ok) {
      // Jamais le corps d'erreur : il peut citer la requête.
      await r.body?.cancel().catch(() => undefined);
      return { statut: r.status, brut: null };
    }
    const j = (await r.json().catch(() => ({}))) as ReponseGemini;
    return {
      statut: r.status,
      brut: {
        texte: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
        entree: j.usageMetadata?.promptTokenCount ?? 0,
        sortie: j.usageMetadata?.candidatesTokenCount ?? 0,
        reflexion: j.usageMetadata?.thoughtsTokenCount ?? 0,
        tier: j.usageMetadata?.serviceTier,
      },
    };
  }

  private async appeler(modele: string, e: EntreeClassement): Promise<Brut> {
    const { statut, brut } = await this.requete(modele, e);
    if (statut === 402) throw new CreditEpuise(`Gemini ${modele} : HTTP 402`);
    // 403 et 429 : clé, budget en pause ou quota. Le code exact d'une pause de budget n'est pas documenté.
    if (statut === 403 || statut === 429) throw new FournisseurIndisponible(statut, `Gemini ${modele} : HTTP ${statut}`);
    if (!brut) throw new ErreurFournisseur(statut, `Gemini ${modele} : HTTP ${statut}`);
    return brut;
  }
```

Dans `apps/worker/src/worker.ts` :
- import : `import { FournisseurIndisponible } from './classement/provider.js';` (à la place de `CreditEpuise`) ;
- ajouter :
```ts
/** Alerte administrateur selon le refus de Gemini. L ne reçoit jamais rien. */
export function messageIndisponibilite(statut: number): string {
  if (statut === 402) return 'Crédit Gemini épuisé : classement suspendu.';
  if (statut === 429) return 'Gemini refuse pour quota ou budget (429) : classement suspendu.';
  return `Gemini refuse la clé ou le projet (${statut}) : classement suspendu.`;
}
```
- dans le processeur, `if (e instanceof CreditEpuise) {` devient `if (e instanceof FournisseurIndisponible) {` et `await d.alerter('Crédit Gemini épuisé : classement suspendu.');` devient `await d.alerter(messageIndisponibilite(e.statut));`. Renommer la variable `creditSignale` en `indisponibiliteSignalee` (trois occurrences) et le commentaire « Indisponibilité, pas un échec » reste.

Dans `apps/worker/src/demarrage.ts`, importer `ErreurFournisseur` et remplacer la ligne de journal par :
```ts
      // Le message d'une ErreurFournisseur ne contient que le modèle et le statut HTTP.
      const raison = e instanceof ErreurFournisseur ? e.message : (e as Error).name;
      journal(`Contrôle du palier impossible (${raison}), nouvel essai dans ${delai / 1000} s.`);
```

`apps/worker/src/configuration.ts` :
```ts
import { chargerPrompt, cheminConfigure, creerFetchSortant, exigerVar, lireVar, type Prompt } from '@organizer/shared';
import { GeminiProvider } from './classement/gemini.js';

/** Prompt et fournisseur, lus de l'environnement : communs au worker et à la sonde. */
export function lireConfigWorker(): { prompt: Prompt; provider: GeminiProvider } {
  const prompt = chargerPrompt(cheminConfigure('PROMPTS_DIR', lireVar('PROMPTS_DIR') ?? 'prompts'), lireVar('PROMPT_VERSION') ?? 'tri/v1');
  const provider = new GeminiProvider({
    cle: exigerVar('GEMINI_API_KEY'),
    modele: lireVar('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite',
    repli: lireVar('GEMINI_MODEL_FALLBACK') ?? 'gemini-3.8-flash',
    prompt,
    tiersPayes: (lireVar('GEMINI_TIERS_PAYES') ?? 'standard').split(',').map((s) => s.trim()),
    niveauReflexion: lireVar('GEMINI_THINKING_LEVEL'),
    fetch: creerFetchSortant(),
  });
  return { prompt, provider };
}
```

Dans `apps/worker/src/main.ts`, supprimer les constructions de `prompt` et `provider` (et les imports devenus inutiles : `chargerPrompt`, `GeminiProvider`) et les remplacer, après `const connexion = …`, par :
```ts
const { prompt, provider } = lireConfigWorker();
```
avec `import { lireConfigWorker } from './configuration.js';`.

`apps/worker/src/sonde.ts` :
```ts
import { creerFetchSortant, essayerSortie } from '@organizer/shared';
import { formaterDiagnostic } from './classement/gemini.js';
import { lireConfigWorker } from './configuration.js';

// Sonde d'exploitation : aucun contenu de capture n'est envoyé ni affiché.
const [commande, cible] = process.argv.slice(2);
if (commande === 'sortie' && cible) {
  console.log(await essayerSortie(cible, creerFetchSortant()));
} else if (commande === 'palier') {
  const d = await lireConfigWorker().provider.diagnostiquer();
  console.log(formaterDiagnostic(d));
  process.exitCode = d.paye ? 0 : 1;
} else {
  console.log('Usage : sonde palier | sonde sortie <url>');
  process.exitCode = 1;
}
```

Dans `apps/worker/package.json`, ajouter le script :
```json
    "sonde": "tsx --env-file=../../.env src/sonde.ts",
```

Dans `.env.example`, après `GEMINI_MODEL_FALLBACK=` :
```
# Niveau de réflexion demandé à Gemini (thinkingLevel). Vide : rien n'est demandé
GEMINI_THINKING_LEVEL=minimal
```

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run apps/worker`
Expected: PASS (dont les tests existants du crédit épuisé, inchangés).

Run: `pnpm --filter @organizer/worker sonde`
Expected: `Usage : sonde palier | sonde sortie <url>`, code 1. **Ne pas lancer `sonde palier` ici** : c'est l'étape A2 de la mise en service.

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Le worker traite les refus de Gemini pour quota, budget ou clé (429, 403) comme le crédit épuisé, borne chaque appel à 120 s, demande le niveau de réflexion configuré, et la sonde `sonde palier` affiche statut, palier et jetons sans aucun contenu (2026-10-05). »
```bash
git add apps/worker .env.example CHANGELOG.md
git commit -m "Ajoute la gestion des refus de Gemini et la sonde du palier"   # + ligne vide + Co-Authored-By
```

---

### Task 7: Veille (supervision de base)

**Files:**
- Create: `apps/api/src/veille/veille.ts`, `apps/api/src/veille/mesures.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/cli.ts`, `CHANGELOG.md`
- Test: `apps/api/test/veille.test.ts`, `apps/api/test/mesures.test.ts` (nouveaux)

**Interfaces:**
- Consumes: `FILE_CLASSEMENT`, `FILE_ALERTES`, `OPTIONS_JOB_ALERTE`, `JobAlerte` (`@organizer/shared`), `Cycle` (tâches 3 et 4), `COMMANDES` (tâche 3).
- Produces :
  - `interface Mesures { enAttente: number; echecsHeure: number; audioOctets: number; baseOctets: number; latenceMoyenneS: number | null; derniereCapture: Date | null }`.
  - `SEUILS`, `interface Constat { cle: string; message: string }`, `constater(m: Mesures, maintenant: Date, s?: typeof SEUILS): Constat[]`, `class Veille { constructor(mesurer: () => Promise<Mesures>, alerter: (message: string) => Promise<void>, maintenant?: () => Date); passer(): Promise<string[]> }` dans `veille/veille.ts`.
  - `mesurer(d: { prisma: PrismaClient; file: Queue; audioRacine: string; maintenant?: () => Date }): Promise<Mesures>`, `tailleDossier(dossier: string): Promise<number>`, `formaterMesures(m: Mesures): string` dans `veille/mesures.ts`.
  - CLI : `veille` (affiche les mesures), `alerte-essai` (envoie une alerte d'essai aux administrateurs liés).

- [ ] **Step 1: Écrire les tests**

`apps/api/test/veille.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { constater, Veille, type Mesures } from '../src/veille/veille.js';

const GO = 1024 ** 3;
const T = new Date('2026-10-16T09:00:00Z');
const BASE: Mesures = {
  enAttente: 0, echecsHeure: 0, audioOctets: 0, baseOctets: 0, latenceMoyenneS: null, derniereCapture: new Date('2026-10-16T08:00:00Z'),
};
const cles = (m: Partial<Mesures>): string[] => constater({ ...BASE, ...m }, T).map((c) => c.cle);

describe('constater', () => {
  it('rien à signaler en régime normal', () => {
    expect(constater(BASE, T)).toEqual([]);
  });

  it('seuils du cahier : plus de 50 en attente, plus de 3 échecs par heure, base au-delà de 8 Go, latence au-delà de 120 s', () => {
    expect(cles({ enAttente: 50, echecsHeure: 3, baseOctets: 8 * GO, latenceMoyenneS: 120 })).toEqual([]);
    expect(cles({ enAttente: 51 })).toEqual(['file']);
    expect(cles({ echecsHeure: 4 })).toEqual(['echecs']);
    expect(cles({ baseOctets: 8 * GO + 1 })).toEqual(['base']);
    expect(cles({ latenceMoyenneS: 121 })).toEqual(['latence']);
  });

  it('audio au-delà de 30 Go : la rotation n\'existe pas encore', () => {
    expect(cles({ audioOctets: 30 * GO })).toEqual([]);
    const [c] = constater({ ...BASE, audioOctets: 31 * GO }, T);
    expect(c).toEqual({ cle: 'audio', message: 'Audio : 31 Go. La rotation arrive au lot 2.' });
  });

  it('dix jours sans capture : une information, pas une alerte ; rien sur une base neuve', () => {
    expect(cles({ derniereCapture: new Date('2026-10-06T08:59:00Z') })).toEqual(['silence']);
    expect(cles({ derniereCapture: new Date('2026-10-06T09:01:00Z') })).toEqual([]);
    expect(cles({ derniereCapture: null })).toEqual([]);
    expect(constater({ ...BASE, derniereCapture: new Date('2026-10-01T00:00:00Z') }, T)[0]!.message).toMatch(/^Information :/);
  });
});

describe('Veille', () => {
  it('alerte une fois par constat, puis de nouveau seulement après un retour à la normale', async () => {
    let m: Mesures = { ...BASE, enAttente: 60 };
    const envoyees: string[] = [];
    const v = new Veille(async () => m, async (x) => { envoyees.push(x); }, () => T);
    await v.passer();
    await v.passer();
    expect(envoyees).toEqual(['File de classement : 60 captures en attente.']);
    m = BASE;
    await v.passer();
    m = { ...BASE, enAttente: 70 };
    await v.passer();
    expect(envoyees).toHaveLength(2);
  });

  it('une alerte en échec est retentée au passage suivant', async () => {
    let panne = true;
    const envoyees: string[] = [];
    const v = new Veille(async () => ({ ...BASE, echecsHeure: 9 }), async (x) => {
      if (panne) throw new Error('file des alertes indisponible');
      envoyees.push(x);
    }, () => T);
    await v.passer();
    panne = false;
    await v.passer();
    expect(envoyees).toEqual(['9 classements en échec depuis une heure.']);
  });
});
```

`apps/api/test/mesures.test.ts` :
```ts
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { formaterMesures, mesurer, tailleDossier } from '../src/veille/mesures.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
afterAll(async () => { await prisma.$disconnect(); connexion.disconnect(); });
beforeEach(() => viderBase(prisma));

describe('mesurer', () => {
  it('file, taille de l\'audio et de la base, latence de l\'heure, dernière capture', async () => {
    const file = new Queue(`veille-test-${randomUUID()}`, { connection: connexion });
    try {
      await file.add('classer', { captureId: 'a' });
      await file.add('classer', { captureId: 'b' }, { delay: 60_000 });
      const racine = mkdtempSync(join(tmpdir(), 'audio-'));
      mkdirSync(join(racine, 'ordinaire', '2026', '10'), { recursive: true });
      writeFileSync(join(racine, 'ordinaire', '2026', '10', 'x.ogg'), Buffer.alloc(1000));
      writeFileSync(join(racine, 'y.ogg'), Buffer.alloc(24));
      const maintenant = new Date();
      const recuLe = new Date(maintenant.getTime() - 30_000);
      const u = await prisma.utilisateur.create({ data: { nom: 'l' } });
      await prisma.capture.create({
        data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', emisLe: recuLe, recuLe, classeLe: maintenant },
      });
      const m = await mesurer({ prisma, file, audioRacine: racine, maintenant: () => maintenant });
      expect(m.enAttente).toBe(2);
      expect(m.echecsHeure).toBe(0);
      expect(m.audioOctets).toBe(1024);
      expect(m.baseOctets).toBeGreaterThan(0);
      expect(m.latenceMoyenneS).toBeCloseTo(30, 0);
      expect(m.derniereCapture?.getTime()).toBe(recuLe.getTime());
      expect(formaterMesures(m)).toContain('en attente : 2');
    } finally {
      await file.obliterate({ force: true });
      await file.close();
    }
  });

  it('un dossier audio absent pèse zéro', async () => {
    expect(await tailleDossier(join(tmpdir(), `absent-${randomUUID()}`))).toBe(0);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/api/test/veille.test.ts apps/api/test/mesures.test.ts`
Expected: FAIL (modules introuvables).

- [ ] **Step 3: Implémenter**

`apps/api/src/veille/veille.ts` :
```ts
const GO = 1024 ** 3;

export interface Mesures {
  enAttente: number;
  echecsHeure: number;
  audioOctets: number;
  baseOctets: number;
  latenceMoyenneS: number | null;
  derniereCapture: Date | null;
}

/** Seuils du cahier (section Supervision) ; audio à 30 Go tant que la rotation du lot 2 n'existe pas. */
export const SEUILS = {
  enAttente: 50, echecsHeure: 3, audioOctets: 30 * GO, baseOctets: 8 * GO, latenceS: 120, silenceJours: 10,
} as const;

export interface Constat { cle: string; message: string }

/** Messages techniques, pour l'administrateur seul : jamais de contenu de capture. */
export function constater(m: Mesures, maintenant: Date, s: typeof SEUILS = SEUILS): Constat[] {
  const c: Constat[] = [];
  if (m.enAttente > s.enAttente) c.push({ cle: 'file', message: `File de classement : ${m.enAttente} captures en attente.` });
  if (m.echecsHeure > s.echecsHeure) c.push({ cle: 'echecs', message: `${m.echecsHeure} classements en échec depuis une heure.` });
  if (m.audioOctets > s.audioOctets) c.push({ cle: 'audio', message: `Audio : ${Math.round(m.audioOctets / GO)} Go. La rotation arrive au lot 2.` });
  if (m.baseOctets > s.baseOctets) c.push({ cle: 'base', message: `Base : ${Math.round(m.baseOctets / GO)} Go, au-delà de 8 Go.` });
  if (m.latenceMoyenneS !== null && m.latenceMoyenneS > s.latenceS) {
    c.push({ cle: 'latence', message: `Classement lent : ${Math.round(m.latenceMoyenneS)} s en moyenne sur une heure.` });
  }
  if (m.derniereCapture && maintenant.getTime() - m.derniereCapture.getTime() > s.silenceJours * 86_400_000) {
    c.push({ cle: 'silence', message: 'Information : aucune capture depuis 10 jours.' });
  }
  return c;
}

/** Une alerte par constat ; elle ne revient qu'après un retour à la normale. Rien n'est envoyé à L. */
export class Veille {
  private readonly actifs = new Set<string>();

  constructor(
    private readonly mesurer: () => Promise<Mesures>,
    private readonly alerter: (message: string) => Promise<void>,
    private readonly maintenant: () => Date = () => new Date(),
  ) {}

  async passer(): Promise<string[]> {
    const constats = constater(await this.mesurer(), this.maintenant());
    const envoyees: string[] = [];
    for (const c of constats) {
      if (this.actifs.has(c.cle)) continue;
      try {
        await this.alerter(c.message);
        this.actifs.add(c.cle);
        envoyees.push(c.message);
      } catch (e) {
        console.error(`Alerte de veille impossible (${(e as Error).name})`);
      }
    }
    const presents = new Set(constats.map((c) => c.cle));
    for (const cle of [...this.actifs]) if (!presents.has(cle)) this.actifs.delete(cle);
    return envoyees;
  }
}
```

`apps/api/src/veille/mesures.ts` :
```ts
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@organizer/db';
import type { Queue } from 'bullmq';
import type { Mesures } from './veille.js';

/** Taille d'un dossier, sous-dossiers compris ; 0 s'il n'existe pas. */
export async function tailleDossier(dossier: string): Promise<number> {
  let entrees;
  try {
    entrees = await readdir(dossier, { recursive: true, withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw e;
  }
  let total = 0;
  for (const e of entrees) if (e.isFile()) total += (await stat(join(e.parentPath, e.name))).size;
  return total;
}

export async function mesurer(d: { prisma: PrismaClient; file: Queue; audioRacine: string; maintenant?: () => Date }): Promise<Mesures> {
  const maintenant = (d.maintenant ?? (() => new Date()))();
  const depuis = new Date(maintenant.getTime() - 3600_000);
  const comptes = await d.file.getJobCounts('waiting', 'delayed', 'prioritized', 'paused');
  const echecs = await d.file.getFailed(0, 499);
  const [base] = await d.prisma.$queryRaw<{ taille: bigint }[]>`SELECT pg_database_size(current_database()) AS taille`;
  const [latence] = await d.prisma.$queryRaw<{ moyenne: number | null }[]>`
    SELECT avg(extract(epoch FROM classe_le - recu_le))::float8 AS moyenne FROM capture WHERE classe_le > ${depuis}`;
  const derniere = await d.prisma.capture.findFirst({ orderBy: { recuLe: 'desc' }, select: { recuLe: true } });
  return {
    enAttente: Object.values(comptes).reduce((a, b) => a + b, 0),
    echecsHeure: echecs.filter((j) => (j.finishedOn ?? 0) > depuis.getTime()).length,
    audioOctets: await tailleDossier(d.audioRacine),
    baseOctets: Number(base?.taille ?? 0),
    latenceMoyenneS: latence?.moyenne ?? null,
    derniereCapture: derniere?.recuLe ?? null,
  };
}

export function formaterMesures(m: Mesures): string {
  const go = (o: number): string => `${(o / 1024 ** 3).toFixed(2)} Go`;
  return [
    `en attente : ${m.enAttente}`,
    `échecs depuis une heure : ${m.echecsHeure}`,
    `audio : ${go(m.audioOctets)}`,
    `base : ${go(m.baseOctets)}`,
    `latence moyenne sur une heure : ${m.latenceMoyenneS === null ? '-' : `${Math.round(m.latenceMoyenneS)} s`}`,
    `dernière capture : ${m.derniereCapture?.toISOString() ?? '-'}`,
  ].join('\n');
}
```

Dans `apps/api/src/app.module.ts` :
- importer `FILE_ALERTES, OPTIONS_JOB_ALERTE, type JobAlerte` (avec `FILE_CLASSEMENT`) depuis `@organizer/shared`, `{ mesurer } from './veille/mesures.js'`, `{ Veille } from './veille/veille.js'` ;
- dans `Cycle`, ajouter les champs `private veille?: NodeJS.Timeout;` et `private files: Queue[] = [];`, puis à la fin de `onApplicationBootstrap` :
```ts
    const classement = new Queue(FILE_CLASSEMENT, { connection: this.redis });
    const alertes = new Queue<JobAlerte>(FILE_ALERTES, { connection: this.redis });
    this.files = [classement, alertes];
    const veille = new Veille(
      () => mesurer({ prisma: this.prisma, file: classement, audioRacine: this.config.audioRacine }),
      async (message) => { await alertes.add('alerte', { message }, OPTIONS_JOB_ALERTE); },
    );
    this.veille = setInterval(() => {
      veille.passer().catch((err: unknown) => console.error(`Veille en échec (${(err as Error).name})`));
    }, 15 * 60_000);
```
et dans `onApplicationShutdown`, après `clearInterval(this.purge);` : `clearInterval(this.veille); await Promise.all(this.files.map((f) => f.close()));`.

Dans `apps/api/src/cli.ts`, importer `FILE_ALERTES, FILE_CLASSEMENT, OPTIONS_JOB_ALERTE, cheminConfigure` depuis `@organizer/shared`, `{ Queue } from 'bullmq'`, `{ Redis } from 'ioredis'`, `{ formaterMesures, mesurer } from './veille/mesures.js'`, puis ajouter :
```ts
/** Ouvre une file BullMQ le temps d'une commande. */
async function avecFile<T>(nom: string, travail: (file: Queue) => Promise<T>): Promise<T> {
  const connexion = new Redis(exigerVar('REDIS_URL'), { maxRetriesPerRequest: null });
  const file = new Queue(nom, { connection: connexion });
  try {
    return await travail(file);
  } finally {
    await file.close();
    connexion.disconnect();
  }
}
```
et, dans `COMMANDES` :
```ts
  veille: {
    usage: 'veille',
    async lancer(_args, prisma) {
      const audioRacine = cheminConfigure('AUDIO_STORAGE_PATH', exigerVar('AUDIO_STORAGE_PATH'));
      console.log(formaterMesures(await avecFile(FILE_CLASSEMENT, (file) => mesurer({ prisma, file, audioRacine }))));
    },
  },
  'alerte-essai': {
    usage: 'alerte-essai',
    async lancer() {
      await avecFile(FILE_ALERTES, (file) => file.add('alerte', { message: 'Essai d\'alerte : la veille joint les administrateurs.' }, OPTIONS_JOB_ALERTE));
      console.log('Alerte d\'essai en file : elle part vers les administrateurs liés.');
    },
  },
```

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run apps/api`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La veille de l'API mesure toutes les 15 minutes la file, les échecs, la taille de l'audio et de la base, la latence et le silence, et alerte l'administrateur une fois par constat ; la CLI affiche les mesures et envoie une alerte d'essai (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute la veille de supervision"   # + ligne vide + Co-Authored-By
```

---

### Task 8: Import des captures du banc d'essai

**Files:**
- Create: `apps/api/src/terrain/import.ts`
- Modify: `apps/api/src/cli.ts`, `CHANGELOG.md`
- Test: `apps/api/test/import-terrain.test.ts` (nouveau)

**Interfaces:**
- Consumes: `StockageAudio`, `FileClassement`, `FileClassementBullmq`, `avecFile` et `COMMANDES` de la CLI (tâches 3 et 7).
- Produces :
  - `interface BilanImport { importees: number; dejaLa: number; sansCompte: number; illisibles: number; sansAudio: number }`.
  - `importerTerrain(prisma: PrismaClient, stockage: StockageAudio, file: FileClassement, dossier: string): Promise<BilanImport>` : lit `<dossier>/captures.jsonl` et `<dossier>/audio/`, crée chaque capture ordinaire sous `source_ref = tg:<chat>:<message>` (le format de l'ingestion), la range dans `ordinaire/` et l'enfile pour un classement par le prompt de l'application.
  - CLI : `importer-terrain <dossier>`.

- [ ] **Step 1: Écrire le test** (énoncés fabriqués uniquement)

`apps/api/test/import-terrain.test.ts` :
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FileClassement } from '../src/ingestion/ingestion.service.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { importerTerrain } from '../src/terrain/import.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

class FausseFile implements FileClassement {
  ids: string[] = [];
  async enfiler(id: string): Promise<void> { this.ids.push(id); }
}

/** Ligne au format du banc d'essai (infra/terrain/bot.mjs), contenu fabriqué. */
const ligne = (message: number, o: Partial<Record<string, unknown>> = {}): string => JSON.stringify({
  id: `7_${message}`, chat: '7', message_id: message, emis_le: '2026-10-02T08:12:00+02:00', recu_le: '2026-10-02T08:12:01+02:00',
  duree_s: 4, audio: `audio/7_${message}.oga`, texte_ecrit: null, version_prompt: 'tri/v1', modele: 'm', etat: 'classee',
  erreur: null, resultat: { transcription: 'acheter du pain', items: [] }, usage: null, ...o,
});

let dossier: string;
let racine: string;
let file: FausseFile;

beforeEach(async () => {
  await viderBase(prisma);
  await prisma.utilisateur.create({ data: { nom: 'l', telegramChatId: 7n } });
  dossier = mkdtempSync(join(tmpdir(), 'terrain-'));
  mkdirSync(join(dossier, 'audio'));
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  file = new FausseFile();
});

const importer = () => importerTerrain(prisma, new StockageAudio(racine), file, dossier);

describe('importerTerrain', () => {
  it('crée une capture ordinaire par vocal, range l\'audio, l\'enfile pour le classement', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n${ligne(11, { audio: null, texte_ecrit: 'rappeler le garage', duree_s: null })}\n`);
    expect(await importer()).toEqual({ importees: 2, dejaLa: 0, sansCompte: 0, illisibles: 0, sansAudio: 0 });
    const c = await prisma.capture.findUniqueOrThrow({ where: { sourceRef: 'tg:7:10' } });
    expect(c).toMatchObject({ canal: 'telegram', prive: false, etat: 'en_file', audioMime: 'audio/ogg', dureeS: 4 });
    expect(c.emisLe.toISOString()).toBe('2026-10-02T06:12:00.000Z');
    expect(c.audioPath).toBe(`ordinaire/2026/10/${c.id}.oga`);
    expect((await prisma.capture.findUniqueOrThrow({ where: { sourceRef: 'tg:7:11' } })).texteEcrit).toBe('rappeler le garage');
    expect(file.ids).toHaveLength(2);
  });

  it('réimporter ne crée rien', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n`);
    await importer();
    expect(await importer()).toMatchObject({ importees: 0, dejaLa: 1 });
    expect(await prisma.capture.count()).toBe(1);
  });

  it('une capture déjà reçue par le webhook n\'est pas réimportée', async () => {
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', sourceRef: 'tg:7:10', emisLe: new Date() } });
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n`);
    expect(await importer()).toMatchObject({ importees: 0, dejaLa: 1 });
  });

  it('compte sans l\'importer un chat sans compte, une ligne illisible, un vocal sans fichier', async () => {
    writeFileSync(join(dossier, 'captures.jsonl'), [
      ligne(20, { chat: '999' }), '{"pas du json', ligne(21, { emis_le: 'hier' }), ligne(22, { audio: 'audio/../../secret.oga' }), '',
    ].join('\n'));
    expect(await importer()).toEqual({ importees: 0, dejaLa: 0, sansCompte: 1, illisibles: 2, sansAudio: 1 });
    expect(await prisma.capture.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/api/test/import-terrain.test.ts`
Expected: FAIL (`../src/terrain/import.js` introuvable).

- [ ] **Step 3: Implémenter**

`apps/api/src/terrain/import.ts` :
```ts
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Prisma, type PrismaClient } from '@organizer/db';
import type { FileClassement } from '../ingestion/ingestion.service.js';
import type { StockageAudio } from '../ingestion/stockage.js';

/** Ligne de captures.jsonl du banc d'essai (infra/terrain/bot.mjs) : seuls ces champs servent. */
interface LigneTerrain { chat: unknown; message_id: unknown; emis_le: unknown; duree_s: unknown; audio: unknown; texte_ecrit: unknown }

export interface BilanImport { importees: number; dejaLa: number; sansCompte: number; illisibles: number; sansAudio: number }

const MIMES: Record<string, string> = {
  oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
};

/**
 * Importe les captures du banc d'essai. Même source_ref que l'ingestion (tg:<chat>:<message>) :
 * une capture relivrée par Telegram après la bascule, ou un second import, ne crée jamais de doublon.
 * Les captures sont reclassées par le prompt de l'application ; le résultat du banc d'essai est ignoré.
 */
export async function importerTerrain(prisma: PrismaClient, stockage: StockageAudio, file: FileClassement, dossier: string): Promise<BilanImport> {
  const bilan: BilanImport = { importees: 0, dejaLa: 0, sansCompte: 0, illisibles: 0, sansAudio: 0 };
  const lignes = (await readFile(join(dossier, 'captures.jsonl'), 'utf8')).split('\n').filter((l) => l.trim() !== '');
  for (const brute of lignes) {
    let l: LigneTerrain;
    try {
      l = JSON.parse(brute) as LigneTerrain;
    } catch {
      bilan.illisibles++;
      continue;
    }
    const emisLe = new Date(String(l.emis_le));
    if (!/^-?\d{1,20}$/.test(String(l.chat)) || !Number.isInteger(l.message_id) || Number.isNaN(emisLe.getTime())) {
      bilan.illisibles++;
      continue;
    }
    const sourceRef = `tg:${String(l.chat)}:${String(l.message_id)}`;
    if (await prisma.capture.findUnique({ where: { sourceRef }, select: { id: true } })) {
      bilan.dejaLa++;
      continue;
    }
    const u = await prisma.utilisateur.findUnique({ where: { telegramChatId: BigInt(String(l.chat)) }, select: { id: true } });
    if (!u) {
      bilan.sansCompte++;
      continue;
    }
    const id = randomUUID();
    const texte = typeof l.texte_ecrit === 'string' && l.texte_ecrit !== '' ? l.texte_ecrit : null;
    let audioPath: string | null = null;
    let audioMime: string | null = null;
    if (typeof l.audio === 'string') {
      // basename : jamais un fichier hors du dossier audio du banc d'essai.
      const nom = basename(l.audio);
      const extension = extname(nom).slice(1).toLowerCase();
      try {
        audioPath = await stockage.ecrire(id, emisLe, await readFile(join(dossier, 'audio', nom)), extension, 'ordinaire');
        audioMime = MIMES[extension] ?? 'audio/ogg';
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    if (!audioPath && !texte) {
      bilan.sansAudio++;
      continue;
    }
    try {
      await prisma.capture.create({
        data: {
          id, utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'recue', sourceRef, audioPath, audioMime,
          dureeS: typeof l.duree_s === 'number' ? Math.round(l.duree_s) : null, texteEcrit: texte, emisLe,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        bilan.dejaLa++;
        continue;
      }
      throw e;
    }
    // Comme l'ingestion : un échec ici laisse la capture en « recue », reprise par l'API sous 5 min.
    await file.enfiler(id);
    await prisma.capture.updateMany({ where: { id, etat: 'recue' }, data: { etat: 'en_file' } });
    bilan.importees++;
  }
  return bilan;
}
```

Dans `apps/api/src/cli.ts`, importer `FileClassementBullmq` depuis `./ingestion/file.js`, `StockageAudio` depuis `./ingestion/stockage.js`, `importerTerrain` depuis `./terrain/import.js`, puis ajouter à `COMMANDES` :
```ts
  'importer-terrain': {
    usage: 'importer-terrain <dossier du banc d\'essai, qui contient captures.jsonl et audio/>',
    async lancer([dossier], prisma) {
      if (!dossier) throw new Usage();
      const stockage = new StockageAudio(cheminConfigure('AUDIO_STORAGE_PATH', exigerVar('AUDIO_STORAGE_PATH')));
      const b = await avecFile(FILE_CLASSEMENT, (file) =>
        importerTerrain(prisma, stockage, new FileClassementBullmq(file as Queue<JobClassement>), dossier));
      console.log(`Import : ${b.importees} importées, ${b.dejaLa} déjà là, ${b.sansCompte} sans compte, ${b.illisibles} illisibles, ${b.sansAudio} sans audio.`);
    },
  },
```
(Ajouter `type JobClassement` à l'import de `@organizer/shared`.)

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run apps/api`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La CLI importe les captures du banc d'essai, sans doublon avec celles que Telegram relivre après la bascule, et les fait reclasser par le prompt de l'application (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute l'import des captures du banc d'essai"   # + ligne vide + Co-Authored-By
```

---
### Task 9: En-têtes et CSP stricte de la PWA

**Files:**
- Create: `apps/web/scripts/entetes.mjs`, `apps/web/e2e/csp.spec.ts`
- Modify: `apps/web/src/app.html`, `apps/web/src/app.css`, `apps/web/vite.config.ts`, `CHANGELOG.md`
- Test: `apps/web/test/entetes.test.ts` (nouveau), `apps/web/e2e/csp.spec.ts`

**Interfaces:**
- Consumes: la construction de la PWA (`apps/web/build/index.html`).
- Produces (`apps/web/scripts/entetes.mjs`, JavaScript typé par JSDoc) :
  - `empreintesScripts(html: string): string[]` (`'sha256-…'` de chaque script en ligne).
  - `politiqueCsp(empreintes: string[]): string`.
  - `entetesCoquille(html: string): Record<string, string>` : `Content-Security-Policy`, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options`.
  - `entetesPreview(index?: string): Record<string, string>` (vide si la construction n'existe pas).
  - En ligne de commande : `node apps/web/scripts/entetes.mjs caddy <index.html>` écrit la directive Caddy `header Content-Security-Policy "…"` ; `… empreintes <index.html>` écrit les empreintes, une par ligne.

- [ ] **Step 1: Écrire les tests**

`apps/web/test/entetes.test.ts` :
```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { empreintesScripts, entetesCoquille, entetesPreview, politiqueCsp } from '../scripts/entetes.mjs';

const sha = (s: string): string => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

describe('en-têtes de la coquille', () => {
  it('une empreinte par script en ligne, au caractère près ; rien pour un script externe', () => {
    const html = '<script type="module" src="/_app/a.js"></script><div>\n\t<script>\n\t\tkit.start();\n\t</script></div>';
    expect(empreintesScripts(html)).toEqual([sha('\n\t\tkit.start();\n\t')]);
  });

  it('CSP stricte : rien hors de l\'origine, pas de cadre, pas de style en ligne', () => {
    const csp = politiqueCsp(["'sha256-abc'"]);
    expect(csp).toBe([
      "default-src 'none'", "script-src 'self' 'sha256-abc'", "style-src 'self'", "img-src 'self'", "media-src 'self'",
      "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '));
    expect(csp).not.toContain('unsafe');
  });

  it('micro limité à l\'origine, aucun référent, pas de devinette de type', () => {
    expect(entetesCoquille('<html></html>')).toMatchObject({
      'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('la coquille ne garde aucun attribut style, que la CSP bloquerait', () => {
    const html = readFileSync(fileURLToPath(new URL('../src/app.html', import.meta.url)), 'utf8');
    expect(html).not.toMatch(/\sstyle=/);
  });

  it('sans construction, vite preview ne pose aucun en-tête', () => {
    expect(entetesPreview('/nexiste/pas/index.html')).toEqual({});
  });
});
```

`apps/web/e2e/csp.spec.ts` (tous les e2e tournent désormais sous les en-têtes de production, posés par `vite preview`) :
```ts
import { expect, test, type Page } from '@playwright/test';
import { CONNECTE, json, simuler } from './simul';

async function surveillerViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener('securitypolicyviolation', (e) => { w.violations.push(`${e.violatedDirective} ${e.blockedURI}`); });
  });
}

const violations = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { violations: string[] }).violations);

test('la coquille démarre sous la CSP sans violation', async ({ page }) => {
  await surveillerViolations(page);
  await simuler(page, { ...CONNECTE, 'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }) });
  const r = await page.goto('/');
  expect(r?.headers()['content-security-policy']).toContain("script-src 'self' 'sha256-");
  expect(r?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page.locator('h1')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('l\'enregistreur privé enregistre sous la CSP, micro compris', async ({ page }) => {
  await surveillerViolations(page);
  await simuler(page, { ...CONNECTE, 'GET /api/captures/privees': json(200, []), 'POST /api/captures/privees': json(201, { id: 'x' }) });
  const r = await page.goto('/prive/enregistrer');
  expect(r?.headers()['permissions-policy']).toContain('microphone=(self)');
  await page.getByRole('button', { name: "Commencer l'enregistrement" }).click();
  await expect(page.getByRole('heading', { name: "J'écoute" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Arrêter et garder' }).click();
  await expect(page).toHaveURL(/\/prive$/);
  expect(await violations(page)).toEqual([]);
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/web/test/entetes.test.ts`
Expected: FAIL (`../scripts/entetes.mjs` introuvable).

Run: `pnpm --filter @organizer/web exec playwright test csp.spec.ts`
Expected: FAIL (aucun en-tête `content-security-policy`).

- [ ] **Step 3: Implémenter**

`apps/web/scripts/entetes.mjs` :
```js
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INDEX = fileURLToPath(new URL('../build/index.html', import.meta.url));

/**
 * Empreintes CSP des scripts en ligne d'une page. La coquille SvelteKit en a un, qui change à chaque build.
 * @param {string} html
 * @returns {string[]}
 */
export function empreintesScripts(html) {
  /** @type {string[]} */
  const empreintes = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    empreintes.push(`'sha256-${createHash('sha256').update(m[1] ?? '', 'utf8').digest('base64')}'`);
  }
  return empreintes;
}

/**
 * CSP stricte : rien hors de l'origine, aucun style ni script en ligne hors empreinte, aucun cadre.
 * @param {string[]} empreintes
 * @returns {string}
 */
export function politiqueCsp(empreintes) {
  return [
    "default-src 'none'",
    `script-src 'self' ${empreintes.join(' ')}`.trim(),
    "style-src 'self'",
    "img-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * En-têtes de la coquille, communs à Caddy (production) et à vite preview (tests e2e).
 * @param {string} html
 * @returns {Record<string, string>}
 */
export function entetesCoquille(html) {
  return {
    'Content-Security-Policy': politiqueCsp(empreintesScripts(html)),
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

/**
 * En-têtes de vite preview : ceux de la dernière construction ; aucun si elle n'existe pas encore.
 * @param {string} [index]
 * @returns {Record<string, string>}
 */
export function entetesPreview(index = INDEX) {
  return existsSync(index) ? entetesCoquille(readFileSync(index, 'utf8')) : {};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [commande, fichier] = process.argv.slice(2);
  const html = readFileSync(fichier ?? INDEX, 'utf8');
  if (commande === 'caddy') {
    console.log(`header Content-Security-Policy "${politiqueCsp(empreintesScripts(html))}"`);
  } else if (commande === 'empreintes') {
    console.log(empreintesScripts(html).join('\n'));
  } else {
    console.error('Usage : entetes.mjs caddy|empreintes [index.html]');
    process.exit(1);
  }
}
```

Dans `apps/web/src/app.html`, remplacer `<div style="display: contents">%sveltekit.body%</div>` par :
```html
    <div class="coquille">%sveltekit.body%</div>
```
Ajouter en tête des règles de `apps/web/src/app.css` :
```css
/* Conteneur de SvelteKit : sans boîte, comme style="display: contents", que la CSP bloquerait. */
.coquille { display: contents; }
```

Dans `apps/web/vite.config.ts`, importer `import { entetesPreview } from './scripts/entetes.mjs';` et ajouter à la configuration, après `server` :
```ts
  // vite preview sert la construction avec les en-têtes de production : les e2e tournent sous la vraie CSP.
  preview: { headers: entetesPreview() },
```

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run apps/web`
Expected: PASS.

Run: `pnpm --filter @organizer/web e2e`
Expected: PASS, les 32 tests existants et les 2 nouveaux. Si un test existant échoue sur une violation de CSP, la corriger dans le code de la PWA (jamais en relâchant la politique) et le noter dans le rapport.

Run: `pnpm --filter @organizer/web build && node apps/web/scripts/entetes.mjs caddy apps/web/build/index.html`
Expected: une ligne `header Content-Security-Policy "default-src 'none'; script-src 'self' 'sha256-…'; …"`.

Run: `pnpm --filter @organizer/web typecheck && pnpm lint && pnpm --filter @organizer/web budget`
Expected: aucune erreur ; budget tenu.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Sécurité : « La PWA est servie et testée sous une CSP stricte calculée à chaque build (empreinte du script de la coquille, aucun style en ligne), avec micro limité à l'origine, sans référent ni devinette de type (2026-10-05). »
```bash
git add apps/web CHANGELOG.md
git commit -m "Ajoute la CSP stricte de la PWA et ses en-têtes de production"   # + ligne vide + Co-Authored-By
```

---

### Task 10: Empaquetage de l'API et du worker (esbuild)

**Files:**
- Create: `scripts/empaquetage.mjs`, `scripts/empaquetage.d.mts`
- Modify: `package.json` (racine), `apps/api/package.json`, `apps/worker/package.json`, `packages/db/package.json`, `pnpm-lock.yaml`, `CHANGELOG.md`
- Test: `apps/api/test/paquet.test.ts`, `apps/worker/test/paquet.test.ts` (nouveaux)

**Interfaces:**
- Consumes: `apps/api/src/main.ts`, `apps/api/src/cli.ts`, `apps/worker/src/main.ts`, `apps/worker/src/sonde.ts`.
- Produces :
  - `empaqueter(dossierApp: string, entrees: string[], sortie?: string): Promise<BuildResult & { metafile: Metafile }>` et `importsExternes(metafile: Metafile): string[]` dans `scripts/empaquetage.mjs`.
  - `pnpm --filter @organizer/api build` → `apps/api/dist/main.mjs`, `apps/api/dist/cli.mjs` ; `pnpm --filter @organizer/worker build` → `apps/worker/dist/main.mjs`, `apps/worker/dist/sonde.mjs`.
  - `prisma` est une dépendance de production de `@organizer/db` ; `@prisma/client`, `undici`, `https-proxy-agent` sont des dépendances directes de l'API et du worker.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/paquet.test.ts` :
```ts
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { empaqueter, importsExternes } from '../../../scripts/empaquetage.mjs';

const APP = join(import.meta.dirname, '..');
const ENV_VIDE = { PATH: process.env.PATH ?? '', NODE_ENV: 'production' };

describe('paquet de l\'API', () => {
  it('chaque paquet importé à l\'exécution est une dépendance directe de l\'API', async () => {
    const r = await empaqueter(APP, ['src/main.ts', 'src/cli.ts']);
    const deps = Object.keys((JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies);
    expect(importsExternes(r.metafile).filter((n) => !deps.includes(n))).toEqual([]);
  }, 60_000);

  it('dist/main.mjs se charge sans module manquant et s\'arrête sur la configuration', () => {
    const r = spawnSync(process.execPath, [join(APP, 'dist/main.mjs')], { env: ENV_VIDE, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/);
    expect(r.stderr).toMatch(/obligatoire|Variable manquante/);
  });

  it('dist/cli.mjs affiche son usage', () => {
    const r = spawnSync(process.execPath, [join(APP, 'dist/cli.mjs')], { env: ENV_VIDE, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('telegram-webhook poser|retirer|etat');
  });
});
```

`apps/worker/test/paquet.test.ts` :
```ts
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { empaqueter, importsExternes } from '../../../scripts/empaquetage.mjs';

const APP = join(import.meta.dirname, '..');
const ENV_VIDE = { PATH: process.env.PATH ?? '', NODE_ENV: 'production' };

describe('paquet du worker', () => {
  it('chaque paquet importé à l\'exécution est une dépendance directe du worker', async () => {
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
    expect(r.stdout).toContain('Usage : sonde palier');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run apps/api/test/paquet.test.ts apps/worker/test/paquet.test.ts`
Expected: FAIL (`scripts/empaquetage.mjs` introuvable).

- [ ] **Step 3: Implémenter l'empaquetage**

`scripts/empaquetage.mjs` :
```js
// Empaquetage d'une application Node du dépôt (API, worker) avec esbuild.
// Le code des paquets @organizer/* (sources TypeScript, avec décorateurs) est inclus ;
// toute dépendance de node_modules reste externe et s'installe dans l'image par pnpm --prod.
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** @type {import('esbuild').Plugin} */
const dependancesExternes = {
  name: 'dependances-externes',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (a) => (a.path.startsWith('@organizer/') ? undefined : { path: a.path, external: true }));
  },
};

/**
 * @param {string} dossierApp dossier de l'application (contient package.json, tsconfig.json, src/)
 * @param {string[]} entrees chemins relatifs, ex. ['src/main.ts', 'src/cli.ts']
 * @param {string} [sortie]
 */
export async function empaqueter(dossierApp, entrees, sortie = join(dossierApp, 'dist')) {
  return build({
    absWorkingDir: dossierApp,
    entryPoints: entrees,
    outdir: sortie,
    outbase: 'src',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'linked',
    metafile: true,
    logLevel: 'warning',
    tsconfig: join(dossierApp, 'tsconfig.json'),
    plugins: [dependancesExternes],
  });
}

/**
 * Paquets npm importés à l'exécution par le code empaqueté (modules de Node exclus).
 * @param {import('esbuild').Metafile} metafile
 * @returns {string[]}
 */
export function importsExternes(metafile) {
  const noms = new Set();
  for (const sortie of Object.values(metafile.outputs)) {
    for (const i of sortie.imports) {
      if (!i.external || i.path.startsWith('node:') || builtinModules.includes(i.path)) continue;
      const morceaux = i.path.split('/');
      noms.add(i.path.startsWith('@') ? morceaux.slice(0, 2).join('/') : morceaux[0]);
    }
  }
  return [...noms].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await empaqueter(process.cwd(), process.argv.slice(2));
}
```

`scripts/empaquetage.d.mts` :
```ts
import type { BuildResult, Metafile } from 'esbuild';

export function empaqueter(dossierApp: string, entrees: string[], sortie?: string): Promise<BuildResult & { metafile: Metafile }>;
export function importsExternes(metafile: Metafile): string[];
```

Dans `package.json` (racine), ajouter à `devDependencies` : `"esbuild": "^0.28.0"`.

Dans `apps/api/package.json`, ajouter le script `"build": "node ../../scripts/empaquetage.mjs src/main.ts src/cli.ts"` ; dans `apps/worker/package.json`, `"build": "node ../../scripts/empaquetage.mjs src/main.ts src/sonde.ts"`.

Dans `packages/db/package.json`, déplacer `prisma` de `devDependencies` vers `dependencies` (même version) ; supprimer `devDependencies` si elle devient vide.

Run: `pnpm install`
Expected: `pnpm-lock.yaml` mis à jour.

- [ ] **Step 4: Vérifier que le test des dépendances échoue, puis ajouter les dépendances manquantes**

Run: `pnpm exec vitest run apps/api/test/paquet.test.ts apps/worker/test/paquet.test.ts`
Expected: FAIL sur « chaque paquet importé… est une dépendance directe », avec au moins `@prisma/client`, `https-proxy-agent` et `undici` dans la liste reçue.

Ajouter aux `dependencies` de `apps/api/package.json` **et** de `apps/worker/package.json` exactement les noms de la liste reçue, avec la version déclarée par le paquet qui l'importe (`"@prisma/client": "^6.16.0"`, `"https-proxy-agent": "^7.0.6"`, `"undici": "^7.0.0"`, et toute autre reprise de `packages/*/package.json`). Ne rien ajouter qui ne soit pas dans la liste.

Run: `pnpm install`
Expected: `pnpm-lock.yaml` mis à jour.

- [ ] **Step 5: Vérifier le succès**

Run: `pnpm exec vitest run apps/api/test/paquet.test.ts apps/worker/test/paquet.test.ts`
Expected: PASS (6 tests).

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS ; `dist/` reste ignoré par Git (`git status` ne le montre pas).

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « L'API et le worker s'empaquettent avec esbuild en `dist/*.mjs`, dépendances externes vérifiées par un test ; Prisma devient une dépendance de production pour les migrations (2026-10-05). »
```bash
git add scripts package.json apps/api/package.json apps/worker/package.json packages/db/package.json apps/api/test/paquet.test.ts apps/worker/test/paquet.test.ts pnpm-lock.yaml CHANGELOG.md
git commit -m "Ajoute l'empaquetage esbuild de l'API et du worker"   # + ligne vide + Co-Authored-By
```

---

### Task 11: Images Docker, Caddy, proxy sortant et CI

**Files:**
- Create: `.dockerignore`, `infra/image/Dockerfile`, `infra/sortie/squid.conf`, `infra/test/image.test.ts`, `.github/workflows/ci.yml`
- Move: `infra/Caddyfile` → `infra/caddy/Caddyfile` (`git mv`, puis réécrit)
- Modify: `vitest.config.ts`, `CHANGELOG.md`
- Test: `infra/test/image.test.ts`, la CI de la branche

**Interfaces:**
- Consumes: `pnpm --filter … build` (tâche 10), `apps/web/scripts/entetes.mjs` (tâche 9), `TAILLE_MAX_CAPTURE_PRIVEE`, `DELAI_ENVOI_PRIVE_MAX_MS` (tâche 1).
- Produces :
  - Cibles du Dockerfile `api`, `worker`, `web`, `sortie`, construites depuis la racine du dépôt : `docker buildx build -f infra/image/Dockerfile --target <cible> .`
  - Image `api` : `WORKDIR /app`, `CMD node apps/api/dist/main.mjs`, CLI `node apps/api/dist/cli.mjs`, Prisma `node packages/db/node_modules/prisma/build/index.js`, ffmpeg, `PROMPTS_DIR=/app/prompts`, utilisateur 1000.
  - Image `worker` : `CMD node apps/worker/dist/main.mjs`, sonde `node apps/worker/dist/sonde.mjs`.
  - Image `web` : Caddy sur `:8080`, coquille dans `/srv`, CSP dans `/etc/caddy/csp.caddy` ; variables `NPM_IP`, `DOMAINE_BOT`.
  - Image `sortie` : Squid sur `:3128`, ACL `10.201.2.10` (api) et `10.201.2.11` (worker).
  - CI `.github/workflows/ci.yml` : jobs `tests` et `images` (la tâche 12 y ajoute l'essai de fumée et la publication).

- [ ] **Step 1: Écrire le test statique**

Dans `vitest.config.ts`, `include` devient :
```ts
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'infra/test/**/*.test.ts'],
```

`infra/test/image.test.ts` :
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entetesCoquille } from '../../apps/web/scripts/entetes.mjs';
import { DELAI_ENVOI_PRIVE_MAX_MS, TAILLE_MAX_CAPTURE_PRIVEE } from '../../packages/shared/src/api.js';

const DEPOT = join(import.meta.dirname, '../..');
const lire = (f: string): string => readFileSync(join(DEPOT, f), 'utf8');

const OCTETS: Record<string, number> = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
const octets = (v: string): number => {
  const m = /^(\d+)(KiB|MiB|GiB)$/.exec(v);
  if (!m) throw new Error(`taille illisible : ${v}`);
  return Number(m[1]) * OCTETS[m[2]!]!;
};
const DUREES: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
const duree = (v: string): number => {
  const m = /^(\d+)(s|m|h)$/.exec(v);
  if (!m) throw new Error(`durée illisible : ${v}`);
  return Number(m[1]) * DUREES[m[2]!]!;
};

describe('.dockerignore', () => {
  it('n\'envoie au build ni secret, ni donnée de L, ni dépendance locale', () => {
    const lignes = lire('.dockerignore').split('\n').map((l) => l.trim());
    for (const motif of [
      '.env', '.env.*', '**/.env', '*.pem', '*.key', 'infra/secrets', 'corpus', 'data', 'audio', 'transcriptions',
      '**/*.ogg', '**/*.oga', '**/*.opus', '**/*.m4a', '**/node_modules', '.git', '**/dist', '**/build', '**/.svelte-kit',
    ]) expect(lignes, motif).toContain(motif);
  });
});

describe('Dockerfile', () => {
  const d = lire('infra/image/Dockerfile');
  const cible = (nom: string): string => {
    const bloc = d.split(/^FROM /m).find((b) => new RegExp(`\\sAS ${nom}\\s*$`).test(b.split('\n')[0]!));
    if (!bloc) throw new Error(`cible absente : ${nom}`);
    return bloc;
  };

  it('images de base épinglées au mineur, jamais latest', () => {
    const bases = [...d.matchAll(/^ARG \w+_IMAGE=(\S+)$/gm)].map((m) => m[1]!);
    expect(bases.length).toBe(3);
    for (const b of bases) expect(b).toMatch(/:\d+\.\d+/);
    expect(d).not.toMatch(/:latest\b/);
  });

  it('quatre cibles, aucune en root', () => {
    for (const nom of ['api', 'worker', 'web']) expect(cible(nom), nom).toMatch(/^USER 1000:1000$/m);
    expect(cible('sortie')).toMatch(/^USER squid$/m);
  });

  it('l\'API embarque ffmpeg ; API et worker embarquent les prompts, en chemin absolu', () => {
    expect(cible('api')).toMatch(/apk add --no-cache ffmpeg/);
    expect(d).toMatch(/^COPY prompts \/app\/prompts$/m);
    expect(d).toMatch(/PROMPTS_DIR=\/app\/prompts/);
  });

  it('dépendances de production installées avec le même verrou', () => {
    expect(d).toContain('pnpm install --frozen-lockfile --prod --filter @organizer/api...');
    expect(d).toContain('pnpm install --frozen-lockfile --prod --filter @organizer/worker...');
  });
});

describe('Caddyfile', () => {
  const c = lire('infra/caddy/Caddyfile');
  const valeur = (cle: string): string[] => [...c.matchAll(new RegExp(`^\\s*${cle} (\\S+)$`, 'gm'))].map((m) => m[1]!);

  it('corps de 30 Mio au moins sur /api, délais au moins égaux à celui de la PWA', () => {
    expect(Math.max(...valeur('max_size').map(octets))).toBeGreaterThanOrEqual(TAILLE_MAX_CAPTURE_PRIVEE);
    for (const cle of ['read_body', 'write', 'read_timeout', 'write_timeout']) {
      expect(valeur(cle).length, cle).toBeGreaterThan(0);
      for (const v of valeur(cle)) expect(duree(v), cle).toBeGreaterThanOrEqual(DELAI_ENVOI_PRIVE_MAX_MS);
    }
  });

  it('/api jamais en cache', () => {
    expect(c).toContain('header_down Cache-Control "no-store"');
  });

  it('mêmes en-têtes que ceux sous lesquels la PWA est testée', () => {
    const e = entetesCoquille('<html></html>');
    expect(c).toContain(`Permissions-Policy "${e['Permissions-Policy']}"`);
    expect(c).toContain(`Referrer-Policy ${e['Referrer-Policy']}`);
    expect(c).toContain(`X-Content-Type-Options ${e['X-Content-Type-Options']}`);
    expect(c).toContain('import /etc/caddy/csp.caddy');
  });

  it('coquille : repli index.html, immutable pour _app/immutable, no-cache ailleurs, type du manifeste', () => {
    expect(c).toContain('try_files {path} /index.html');
    expect(c).toContain('header @immuable Cache-Control "public, max-age=31536000, immutable"');
    expect(c).toContain('@frais not path /_app/immutable/*');
    expect(c).toContain('header @frais Cache-Control "no-cache"');
    expect(c).toContain('header @manifeste Content-Type "application/manifest+json"');
  });

  it('le webhook n\'est servi que sur le domaine du bot ; X-Forwarded-For cru du seul NPM', () => {
    expect(c).toContain('@bot host {$DOMAINE_BOT}');
    expect(c).toMatch(/handle \/telegram\/\* \{\s*respond 404\s*\}/);
    expect(c).toContain('trusted_proxies static {$NPM_IP}');
  });
});

describe('squid.conf', () => {
  const s = lire('infra/sortie/squid.conf');
  it('liste fermée : Telegram pour l\'API, Gemini pour le worker, CONNECT 443 seulement, refus du reste', () => {
    expect(s).toContain('acl depuis_api src 10.201.2.10/32');
    expect(s).toContain('acl depuis_worker src 10.201.2.11/32');
    expect(s).toContain('acl vers_api dstdomain api.telegram.org');
    expect(s).toContain('acl vers_worker dstdomain generativelanguage.googleapis.com');
    const regles = s.split('\n').filter((l) => l.startsWith('http_access'));
    expect(regles).toEqual([
      'http_access deny !CONNECT',
      'http_access deny !port_https',
      'http_access allow depuis_api vers_api',
      'http_access allow depuis_worker vers_worker',
      'http_access deny all',
    ]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run infra/test/image.test.ts`
Expected: FAIL (fichiers absents).

- [ ] **Step 3: Choisir l'étiquette de Node**

Run: `curl -s 'https://hub.docker.com/v2/repositories/library/node/tags?page_size=100&name=22.' | python3 -c "import json,sys; print(sorted({t['name'] for t in json.load(sys.stdin)['results'] if t['name'].endswith('-alpine3.22') and t['name'].count('.')==2})[-5:])"`
Expected: une liste d'étiquettes `22.<mineur>-alpine3.22`. Retenir la plus haute (par exemple `22.21-alpine3.22`) pour `NODE_IMAGE` ci-dessous. Vérifier aussi que `caddy:2.11-alpine` et `alpine:3.22` existent : `curl -s -o /dev/null -w '%{http_code}\n' https://hub.docker.com/v2/repositories/library/caddy/tags/2.11-alpine` → `200`, idem `library/alpine/tags/3.22` → `200`.

- [ ] **Step 4: Écrire les fichiers**

`.dockerignore` :
```
# Contexte de build : jamais de secret, jamais de donnée de L (dépôt public, images publiées).
.env
.env.*
**/.env
*.pem
*.key
infra/secrets
corpus
data
audio
transcriptions
**/*.ogg
**/*.oga
**/*.opus
**/*.m4a
# Reconstruit dans l'image
**/node_modules
.git
**/dist
**/build
**/.svelte-kit
**/test-results
**/playwright-report
coverage
.DS_Store
```

`infra/image/Dockerfile` (remplacer `22.21` par le mineur retenu à l'étape 3) :
```dockerfile
# syntax=docker/dockerfile:1.7
# Images d'Organizer : api, worker, web, sortie. Contexte : la racine du dépôt (voir .dockerignore).
# Construites par la CI (.github/workflows/ci.yml) ; publiées sur GHCR à chaque étiquette v*.

ARG NODE_IMAGE=node:22.21-alpine3.22
ARG CADDY_IMAGE=caddy:2.11-alpine
ARG ALPINE_IMAGE=alpine:3.22

# Manifestes seulement : la couche d'installation ne bouge que si les dépendances changent.
FROM ${NODE_IMAGE} AS outils
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /depot
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/db/prisma packages/db/prisma

FROM outils AS construction
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @organizer/api --filter @organizer/worker build \
 && pnpm --filter @organizer/web build \
 && node apps/web/scripts/entetes.mjs caddy apps/web/build/index.html > /csp.caddy

# Dépendances de production, même verrou ; le client Prisma est généré ici (postinstall de @organizer/db).
FROM outils AS dependances-api
RUN pnpm install --frozen-lockfile --prod --filter @organizer/api...

FROM outils AS dependances-worker
RUN pnpm install --frozen-lockfile --prod --filter @organizer/worker...

FROM ${NODE_IMAGE} AS base-node
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV NODE_ENV=production PROMPTS_DIR=/app/prompts CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
COPY prompts /app/prompts
LABEL org.opencontainers.image.source=https://github.com/djkix/organizer
ENTRYPOINT ["/sbin/tini", "--"]

FROM base-node AS api
RUN apk add --no-cache ffmpeg
COPY --from=dependances-api /depot /app
COPY --from=construction /depot/apps/api/dist /app/apps/api/dist
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/api/dist/main.mjs"]

FROM base-node AS worker
COPY --from=dependances-worker /depot /app
COPY --from=construction /depot/apps/worker/dist /app/apps/worker/dist
USER 1000:1000
CMD ["node", "apps/worker/dist/main.mjs"]

FROM ${CADDY_IMAGE} AS web
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=construction /csp.caddy /etc/caddy/csp.caddy
COPY --from=construction /depot/apps/web/build /srv
LABEL org.opencontainers.image.source=https://github.com/djkix/organizer
USER 1000:1000
EXPOSE 8080

FROM ${ALPINE_IMAGE} AS sortie
RUN apk add --no-cache squid
COPY infra/sortie/squid.conf /etc/squid/squid.conf
LABEL org.opencontainers.image.source=https://github.com/djkix/organizer
USER squid
EXPOSE 3128
CMD ["squid", "-N", "-d", "1", "-f", "/etc/squid/squid.conf"]
```

`git mv infra/Caddyfile infra/caddy/Caddyfile`, puis contenu de `infra/caddy/Caddyfile` :
```
# Coquille de la PWA et passage vers l'API, derrière le Nginx Proxy Manager (TLS, HSTS, HTTP/2).
# NPM_IP : adresse du Nginx Proxy Manager, seul proxy dont X-Forwarded-For est cru.
# DOMAINE_BOT : domaine du webhook Telegram, qui ne sert que /telegram/webhook.
# La CSP (empreinte du script en ligne de la coquille) est calculée au build : /etc/caddy/csp.caddy.
{
	admin off
	auto_https off
	persist_config off
	servers {
		trusted_proxies static {$NPM_IP}
		timeouts {
			read_header 30s
			read_body 30m
			write 30m
			idle 5m
		}
	}
}

:8080 {
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		Permissions-Policy "microphone=(self), camera=(), geolocation=()"
		-Server
	}

	@bot host {$DOMAINE_BOT}
	handle @bot {
		handle /telegram/webhook {
			request_body {
				max_size 1MiB
			}
			reverse_proxy api:3000
		}
		respond 404
	}

	handle /telegram/* {
		respond 404
	}

	handle /api/* {
		request_body {
			max_size 32MiB
		}
		reverse_proxy api:3000 {
			header_down Cache-Control "no-store"
			transport http {
				read_timeout 30m
				write_timeout 30m
			}
		}
	}

	handle {
		root * /srv
		import /etc/caddy/csp.caddy
		@immuable path /_app/immutable/*
		header @immuable Cache-Control "public, max-age=31536000, immutable"
		@frais not path /_app/immutable/*
		header @frais Cache-Control "no-cache"
		@manifeste path /manifest.webmanifest
		header @manifeste Content-Type "application/manifest+json"
		encode zstd gzip
		try_files {path} /index.html
		file_server
	}
}
```

`infra/sortie/squid.conf` :
```
# Proxy sortant d'Organizer : seule route vers Internet de l'API et du worker (cahier, section Réseaux).
# Chaque conteneur n'atteint que sa liste fermée de domaines, en HTTPS (CONNECT 443) seulement.
# Adresses fixes sur le réseau « sortie » : voir infra/docker-compose.yml.
http_port 3128
pid_filename /tmp/squid.pid
coredump_dir /tmp
cache deny all
cache_mem 0 MB
pinger_enable off
netdb_filename none
access_log stdio:/dev/stdout
cache_log /dev/stderr
logfile_rotate 0
shutdown_lifetime 1 seconds
via off
forwarded_for delete

acl CONNECT method CONNECT
acl port_https port 443
acl depuis_api src 10.201.2.10/32
acl depuis_worker src 10.201.2.11/32
acl vers_api dstdomain api.telegram.org
acl vers_worker dstdomain generativelanguage.googleapis.com

http_access deny !CONNECT
http_access deny !port_https
http_access allow depuis_api vers_api
http_access allow depuis_worker vers_worker
http_access deny all
```

`.github/workflows/ci.yml` :
```yaml
# Intégration continue d'Organizer. Aucune donnée réelle : énoncés fabriqués seulement.
# Publication sur GHCR à chaque étiquette v* (tâche 12) ; le déploiement reste manuel (Dockge).
name: CI

on:
  push:
    branches: [main, 'lot*']
    tags: ['v*']
  pull_request:

permissions:
  contents: read

jobs:
  tests:
    runs-on: ubuntu-24.04
    services:
      db:
        image: pgvector/pgvector:0.8.0-pg17
        env:
          POSTGRES_USER: organizer
          POSTGRES_PASSWORD: organizer
          POSTGRES_DB: organizer
        ports: ['55432:5432']
        options: >-
          --health-cmd "pg_isready -U organizer -d organizer"
          --health-interval 5s --health-timeout 5s --health-retries 20
      queue:
        image: valkey/valkey:8.1-alpine
        ports: ['56379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: corepack enable
      - run: sudo apt-get update && sudo apt-get install -y --no-install-recommends ffmpeg postgresql-client
      - run: pnpm install --frozen-lockfile
      - run: psql postgresql://organizer:organizer@127.0.0.1:55432/organizer -c 'CREATE DATABASE organizer_test'
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm --filter @organizer/web exec playwright install --with-deps chromium
      - run: pnpm --filter @organizer/web e2e
      - run: pnpm --filter @organizer/web budget

  images:
    needs: tests
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Construire les quatre images
        run: |
          for cible in api worker web sortie; do
            docker buildx build --load --target "$cible" -f infra/image/Dockerfile \
              --cache-from type=gha,scope="$cible" --cache-to type=gha,mode=max,scope="$cible" \
              -t "ghcr.io/djkix/organizer-$cible:essai" .
          done
      - name: Analyser les vulnérabilités (critiques corrigeables bloquantes)
        run: |
          for cible in api worker web sortie; do
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.63.0 image \
              --scanners vuln --ignore-unfixed --severity CRITICAL --exit-code 1 "ghcr.io/djkix/organizer-$cible:essai"
          done
```

- [ ] **Step 5: Vérifier le succès**

Run: `pnpm exec vitest run infra/test/image.test.ts`
Expected: PASS.

Si Docker est disponible sur le poste : `for c in api worker web sortie; do docker buildx build --load --target $c -f infra/image/Dockerfile -t ghcr.io/djkix/organizer-$c:essai . || break; done`
Expected: quatre images construites. Puis `docker run --rm ghcr.io/djkix/organizer-api:essai node apps/api/dist/cli.mjs` → l'usage de la CLI ; `docker run --rm ghcr.io/djkix/organizer-worker:essai node apps/worker/dist/sonde.mjs` → `Usage : sonde palier | sonde sortie <url>` ; `docker run --rm ghcr.io/djkix/organizer-api:essai ffmpeg -hide_banner -encoders | grep libopus` → une ligne `libopus`.

Sans Docker sur le poste, la CI fait foi : `git push -u origin lot1-c-deploiement`, puis `gh run watch`.
Expected: jobs `tests` et `images` verts. Un échec de Trivy sur une vulnérabilité critique corrigeable se règle en montant l'image de base au correctif suivant (étape 3), jamais en retirant l'analyse. Si l'étiquette `aquasec/trivy:0.63.0` n'existe plus, prendre la dernière `0.x.y` de https://hub.docker.com/r/aquasec/trivy/tags.

Run: `pnpm lint`
Expected: aucune erreur.

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les images api, worker, web (Caddy, coquille et CSP du build) et sortie (Squid, liste fermée de domaines), et la CI GitHub Actions : tests avec base et file, e2e, construction et analyse des images (2026-10-05). »
```bash
git add .dockerignore infra/image infra/caddy infra/sortie infra/test vitest.config.ts .github CHANGELOG.md
git commit -m "Ajoute les images Docker, le proxy sortant et la CI"   # + ligne vide + Co-Authored-By
```

---

### Task 12: Stack de production, essai de fumée et publication des images

**Files:**
- Create: `infra/image/essai.sh`, `infra/test/compose.test.ts`
- Modify: `infra/docker-compose.yml` (réécrit), `infra/.env.example` (réécrit), `.github/workflows/ci.yml`, `package.json` (racine), `pnpm-lock.yaml`, `docs/cahier-des-charges.md`, `CHANGELOG.md`
- Test: `infra/test/compose.test.ts`, `infra/image/essai.sh` (en CI)

**Interfaces:**
- Consumes: les quatre images (tâche 11), `squid.conf`, CLI `essai-sortie` (tâche 5), `sonde sortie` (tâche 6), `GET /api/sante` (tâche 2).
- Produces :
  - `infra/docker-compose.yml` : services `migrate`, `api`, `worker`, `web`, `sortie`, `db`, `queue` ; réseaux `publication`, `edge` (10.201.1.0/24, interne), `core` (interne), `sortie` (10.201.2.0/24, interne), `egress` ; volumes `pgdata`, `audio`, `valkeydata` ; secrets `telegram_bot_token`, `telegram_webhook_secret`, `gemini_api_key`.
  - Variables obligatoires du `.env` de la stack : `ORGANIZER_VERSION`, `POSTGRES_PASSWORD`, `NPM_IP`, `IP_PUBLICATION`, `DOMAINE_BOT`.
  - `infra/image/essai.sh [étiquette]` : démarre la vraie topologie avec des secrets factices et vérifie en-têtes, repli, `/api`, webhook et sortie.
  - CI : essai de fumée à chaque construction ; publication `ghcr.io/djkix/organizer-{api,worker,web,sortie}:<version>` sur étiquette `v<version>`.

- [ ] **Step 1: Ajouter `yaml` et écrire le test**

Dans `package.json` (racine), ajouter à `devDependencies` : `"yaml": "^2.8.0"`. Run: `pnpm install`.

`infra/test/compose.test.ts` :
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Service {
  image: string; user?: string; read_only?: boolean; restart?: string; ports?: string[];
  networks: string[] | Record<string, { ipv4_address?: string } | null>;
  environment?: Record<string, string>; logging?: unknown; healthcheck?: unknown;
  deploy?: { resources?: { limits?: { memory?: string } } };
  depends_on?: Record<string, { condition: string }>;
}
interface Compose { services: Record<string, Service>; networks: Record<string, { internal?: boolean } | null> }

const INFRA = join(import.meta.dirname, '..');
const texte = readFileSync(join(INFRA, 'docker-compose.yml'), 'utf8');
const compose = parse(texte, { merge: true }) as Compose;
const S = compose.services;
const service = (n: string): Service => {
  const s = S[n];
  if (!s) throw new Error(`service absent : ${n}`);
  return s;
};
const reseaux = (s: Service): string[] => (Array.isArray(s.networks) ? [...s.networks] : Object.keys(s.networks)).sort();
const ip = (n: string): string | undefined => (service(n).networks as Record<string, { ipv4_address?: string }>).sortie?.ipv4_address;

describe('stack de production', () => {
  it('services du lot 1 : migrations et proxy sortant compris, pas encore de scheduler', () => {
    expect(Object.keys(S).sort()).toEqual(['api', 'db', 'migrate', 'queue', 'sortie', 'web', 'worker']);
  });

  it('images épinglées, jamais latest ; les nôtres à la version du .env', () => {
    for (const [n, s] of Object.entries(S)) {
      if (s.image.startsWith('ghcr.io/djkix/organizer-')) expect(s.image, n).toMatch(/:\$\{ORGANIZER_VERSION:\?\}$/);
      else expect(s.image, n).toMatch(/:\d+\.\d+/);
    }
  });

  it('conteneurs applicatifs non root, racine en lecture seule', () => {
    for (const n of ['api', 'worker', 'migrate', 'web']) {
      expect(service(n).user, n).toBe('1000:1000');
      expect(service(n).read_only, n).toBe(true);
    }
    expect(service('sortie').read_only).toBe(true);
  });

  it('redémarrage, journaux JSON 10 Mo × 3, limites mémoire du cahier', () => {
    const limites: Record<string, string> = { api: '512m', worker: '768m', db: '1g', queue: '128m', web: '64m', sortie: '64m', migrate: '256m' };
    for (const [n, s] of Object.entries(S)) {
      expect(s.restart, n).toBe(n === 'migrate' ? 'no' : 'unless-stopped');
      expect(s.logging, n).toEqual({ driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } });
      expect(s.deploy?.resources?.limits?.memory, n).toBe(limites[n]);
    }
  });

  it('réseaux : seul le proxy sortant atteint Internet ; base et file isolées', () => {
    expect(reseaux(service('db'))).toEqual(['core']);
    expect(reseaux(service('queue'))).toEqual(['core']);
    expect(reseaux(service('migrate'))).toEqual(['core']);
    expect(reseaux(service('api'))).toEqual(['core', 'edge', 'sortie']);
    expect(reseaux(service('worker'))).toEqual(['core', 'sortie']);
    expect(reseaux(service('web'))).toEqual(['edge', 'publication']);
    expect(reseaux(service('sortie'))).toEqual(['egress', 'sortie']);
    for (const n of ['core', 'edge', 'sortie']) expect(compose.networks[n]?.internal, n).toBe(true);
    for (const n of ['egress', 'publication']) expect(compose.networks[n]?.internal ?? false, n).toBe(false);
  });

  it('un seul port publié, sur l\'adresse de la VM', () => {
    for (const [n, s] of Object.entries(S)) if (n !== 'web') expect(s.ports, n).toBeUndefined();
    expect(service('web').ports).toEqual(['${IP_PUBLICATION:?}:7070:8080']);
  });

  it('API : proxy de confiance obligatoire (Caddy et NPM), webhook en production', () => {
    const env = service('api').environment!;
    expect(env.TRUSTED_PROXY).toBe('10.201.1.0/24, ${NPM_IP:?}');
    expect(env.TELEGRAM_MODE).toBe('webhook');
    expect(env.TELEGRAM_WEBHOOK_URL).toBe('https://${DOMAINE_BOT:?}/telegram/webhook');
  });

  it('API et worker : production, chemins absolus, sortie par le proxy', () => {
    for (const n of ['api', 'worker']) {
      const env = service(n).environment!;
      expect(env).toMatchObject({
        NODE_ENV: 'production', PROMPTS_DIR: '/app/prompts', AUDIO_STORAGE_PATH: '/data/audio', HTTPS_PROXY: 'http://sortie:3128',
      });
    }
  });

  it('les adresses du réseau sortie sont celles de squid.conf', () => {
    const conf = readFileSync(join(INFRA, 'sortie/squid.conf'), 'utf8');
    expect(conf).toContain(`acl depuis_api src ${ip('api')}/32`);
    expect(conf).toContain(`acl depuis_worker src ${ip('worker')}/32`);
  });

  it('aucun secret en clair : des fichiers, ou une valeur obligatoire du .env', () => {
    for (const s of Object.values(S)) {
      for (const [k, v] of Object.entries(s.environment ?? {})) {
        if (/TOKEN|SECRET|KEY|PASSWORD/.test(k)) expect(k.endsWith('_FILE') || /^\$\{[A-Z_]+:\?\}$/.test(v), k).toBe(true);
      }
    }
  });

  it('migrations jouées avant l\'API et le worker ; sondes de santé sur api, db, queue, web', () => {
    for (const n of ['api', 'worker']) expect(service(n).depends_on?.migrate?.condition, n).toBe('service_completed_successfully');
    for (const n of ['api', 'db', 'queue', 'web']) expect(service(n).healthcheck, n).toBeDefined();
  });

  it('chaque variable obligatoire du compose est documentée dans infra/.env.example', () => {
    const exemple = readFileSync(join(INFRA, '.env.example'), 'utf8');
    const obligatoires = new Set([...texte.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1]!));
    for (const v of obligatoires) expect(exemple, v).toMatch(new RegExp(`^${v}=`, 'm'));
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run infra/test/compose.test.ts`
Expected: FAIL (scheduler présent, réseaux et variables de l'ancien compose).

- [ ] **Step 3: Réécrire le compose et son `.env.example`**

`infra/docker-compose.yml` :
```yaml
# Stack Organizer — déployée par Dockge, publiée par le Nginx Proxy Manager existant.
# Référence : docs/cahier-des-charges.md (Déploiement Docker) et docs/exploitation.md.
#
# Dans Dockge : ce fichier est le compose.yaml de la stack « organizer » (/opt/stacks/organizer/),
# avec son .env (modèle : infra/.env.example) et le dossier secrets/ (un fichier par secret).
#
# Réseaux : web seul est publié ; api et worker n'ont aucune route vers Internet et sortent
# par le proxy « sortie », qui n'ouvre que leur liste fermée de domaines (infra/sortie/squid.conf).
# 50 Go maximum pour la stack (décision 12). Pas de sauvegarde avant le lot 2 (décision 11).
# Le scheduler (agenda, rotation de l'audio) arrive au lot 2.

name: organizer

x-journal: &journal
  driver: json-file
  options:
    max-size: 10m
    max-file: "3"

x-app: &app
  restart: unless-stopped
  user: "1000:1000"
  read_only: true
  tmpfs:
    - /tmp
  logging: *journal
  # Pas d'env_file : les clés passent uniquement par les secrets.
  environment: &app-env
    NODE_ENV: production
    TZ: Europe/Paris
    HOME: /tmp
    DATABASE_URL: postgresql://organizer:${POSTGRES_PASSWORD:?}@db:5432/organizer
    REDIS_URL: redis://queue:6379
    PROMPTS_DIR: /app/prompts
    PROMPT_VERSION: ${PROMPT_VERSION:-tri/v1}
    AUDIO_STORAGE_PATH: /data/audio
    HTTPS_PROXY: http://sortie:3128
    NO_PROXY: db,queue,localhost,127.0.0.1

services:
  # Migrations Prisma jouées avant le démarrage de l'API et du worker.
  migrate:
    <<: *app
    image: ghcr.io/djkix/organizer-api:${ORGANIZER_VERSION:?}
    restart: "no"
    command: ["node", "packages/db/node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"]
    networks: [core]
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        limits:
          memory: 256m

  api:
    <<: *app
    image: ghcr.io/djkix/organizer-api:${ORGANIZER_VERSION:?}
    environment:
      <<: *app-env
      TELEGRAM_MODE: webhook
      TELEGRAM_BOT_TOKEN_FILE: /run/secrets/telegram_bot_token
      TELEGRAM_WEBHOOK_SECRET_FILE: /run/secrets/telegram_webhook_secret
      TELEGRAM_WEBHOOK_URL: https://${DOMAINE_BOT:?}/telegram/webhook
      # X-Forwarded-For cru de Caddy (réseau edge) et du Nginx Proxy Manager, seulement.
      TRUSTED_PROXY: 10.201.1.0/24, ${NPM_IP:?}
    secrets: [telegram_bot_token, telegram_webhook_secret]
    volumes:
      - audio:/data/audio
    networks:
      edge: {}
      core: {}
      sortie:
        ipv4_address: 10.201.2.10
    depends_on:
      migrate:
        condition: service_completed_successfully
      queue:
        condition: service_healthy
      sortie:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 512m

  worker:
    <<: *app
    image: ghcr.io/djkix/organizer-worker:${ORGANIZER_VERSION:?}
    environment:
      <<: *app-env
      GEMINI_API_KEY_FILE: /run/secrets/gemini_api_key
      GEMINI_MODEL: ${GEMINI_MODEL:-gemini-3.1-flash-lite}
      GEMINI_MODEL_FALLBACK: ${GEMINI_MODEL_FALLBACK:-gemini-3.8-flash}
      GEMINI_TIERS_PAYES: ${GEMINI_TIERS_PAYES:-standard}
      # Vide dans le .env : rien n'est demandé (modèle qui refuserait thinkingLevel).
      GEMINI_THINKING_LEVEL: ${GEMINI_THINKING_LEVEL-minimal}
      # Plafond de concurrence : ne pas saturer le quota Gemini en rattrapage.
      WORKER_CONCURRENCY: "2"
    secrets: [gemini_api_key]
    volumes:
      - audio:/data/audio:ro
    networks:
      core: {}
      sortie:
        ipv4_address: 10.201.2.11
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
          memory: 768m

  # Coquille de la PWA, en-têtes, et passage vers l'API (infra/caddy/Caddyfile).
  web:
    image: ghcr.io/djkix/organizer-web:${ORGANIZER_VERSION:?}
    restart: unless-stopped
    user: "1000:1000"
    read_only: true
    tmpfs:
      - /data
      - /config
    environment:
      NPM_IP: ${NPM_IP:?}
      DOMAINE_BOT: ${DOMAINE_BOT:?}
    # Seul port publié de la stack, sur l'adresse de la VM, pour le Nginx Proxy Manager.
    ports:
      - "${IP_PUBLICATION:?}:7070:8080"
    networks: [publication, edge]
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:8080/"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging: *journal
    deploy:
      resources:
        limits:
          memory: 64m

  # Proxy sortant : seule route vers Internet (infra/sortie/squid.conf).
  sortie:
    image: ghcr.io/djkix/organizer-sortie:${ORGANIZER_VERSION:?}
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    networks:
      sortie:
        ipv4_address: 10.201.2.2
      egress: {}
    logging: *journal
    deploy:
      resources:
        limits:
          memory: 64m

  db:
    image: pgvector/pgvector:0.8.0-pg17
    restart: unless-stopped
    environment:
      POSTGRES_USER: organizer
      POSTGRES_DB: organizer
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
      TZ: Europe/Paris
    # Réglé pour une limite de 1 Go : deux utilisateurs, une cinquantaine de captures par jour.
    command: ["postgres", "-c", "shared_buffers=256MB", "-c", "effective_cache_size=512MB", "-c", "work_mem=8MB", "-c", "max_connections=30"]
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks: [core]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U organizer -d organizer"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging: *journal
    deploy:
      resources:
        limits:
          memory: 1g

  queue:
    image: valkey/valkey:8.1-alpine
    restart: unless-stopped
    command: ["valkey-server", "--appendonly", "yes", "--maxmemory", "96mb", "--maxmemory-policy", "noeviction"]
    volumes:
      - valkeydata:/data
    networks: [core]
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging: *journal
    deploy:
      resources:
        limits:
          memory: 128m

networks:
  # Publication du seul port de web vers le Nginx Proxy Manager.
  publication: {}
  # web ↔ api. Interne : l'API n'y trouve aucune route vers Internet.
  edge:
    internal: true
    ipam:
      config:
        - subnet: 10.201.1.0/24
  # api, worker, migrations, base, file. Aucune sortie Internet.
  core:
    internal: true
  # api et worker vers le proxy sortant ; adresses fixes reprises dans squid.conf.
  sortie:
    internal: true
    ipam:
      config:
        - subnet: 10.201.2.0/24
  # Le proxy sortant seul atteint Internet.
  egress: {}

volumes:
  pgdata:
  audio:
  valkeydata:

secrets:
  telegram_bot_token:
    file: ./secrets/telegram_bot_token
  telegram_webhook_secret:
    file: ./secrets/telegram_webhook_secret
  gemini_api_key:
    file: ./secrets/gemini_api_key
```

`infra/.env.example` :
```
# Configuration de la stack de production. Copier en /opt/stacks/organizer/.env (jamais dans le dépôt).
# Les clés vont dans secrets/, un fichier par secret, jamais ici.

# Version des images ghcr.io/djkix/organizer-* (étiquette v<version> du dépôt), ex. 1.0.0
ORGANIZER_VERSION=
# Mot de passe de PostgreSQL : openssl rand -hex 24
POSTGRES_PASSWORD=
# Adresse IP du Nginx Proxy Manager (conteneur 101), seul proxy dont X-Forwarded-For est cru
NPM_IP=
# Adresse de la VM sur laquelle le port 7070 de web est publié
IP_PUBLICATION=192.168.1.201
# Domaine du webhook Telegram
DOMAINE_BOT=organizer-bot.djkix.ovh

PROMPT_VERSION=tri/v1
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_MODEL_FALLBACK=gemini-3.8-flash
# Valeur de serviceTier relevée par « sonde palier » sur le projet facturé
GEMINI_TIERS_PAYES=standard
# Niveau de réflexion ; vide si le modèle le refuse (voir docs/exploitation.md)
GEMINI_THINKING_LEVEL=minimal

# ------------------------------------------------------------------
# CLÉS : NE PAS LES METTRE DANS CE FICHIER. Un fichier par secret, dans secrets/ :
#   secrets/telegram_bot_token       jeton de @organizer_lud_bot
#   secrets/telegram_webhook_secret  secret du webhook (openssl rand -hex 32)
#   secrets/gemini_api_key           clé de l'API Gemini (projet facturé)
# Un fichier = la valeur seule, sans « NOM= », sans guillemets ni retour à la ligne.
# ------------------------------------------------------------------
```

- [ ] **Step 4: Vérifier le test du compose**

Run: `pnpm exec vitest run infra/test`
Expected: PASS.

Si Docker est disponible : `docker compose -f infra/docker-compose.yml --env-file infra/.env.example config -q` avec `ORGANIZER_VERSION=0 POSTGRES_PASSWORD=x NPM_IP=192.0.2.1` exportés (les autres ont une valeur dans l'exemple) → aucune sortie, code 0.

- [ ] **Step 5: Écrire l'essai de fumée**

`infra/image/essai.sh` (exécutable : `chmod +x`) :
```sh
#!/bin/sh
# Essai de fumée des images dans la topologie réelle (infra/docker-compose.yml), secrets factices.
# Usage : infra/image/essai.sh [étiquette]   (défaut : essai ; images ghcr.io/djkix/organizer-*:<étiquette> déjà construites)
# Ne touche à aucune stack existante : projet « organizer-essai », dossier temporaire, tout est retiré à la fin.
set -eu
ETIQUETTE="${1:-essai}"
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
TRAVAIL="$(mktemp -d)"
PROJET=organizer-essai
URL=http://127.0.0.1:7070

dc() { docker compose -p "$PROJET" --project-directory "$TRAVAIL" -f "$TRAVAIL/compose.yaml" "$@"; }
nettoyer() { dc down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$TRAVAIL"; }
trap nettoyer EXIT
echec() { echo "ÉCHEC : $1" >&2; dc ps -a >&2 || true; dc logs --no-color --tail 40 >&2 || true; exit 1; }
entete() { curl -sS -D - -o /dev/null "$URL$1" | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }
statut() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }

mkdir -p "$TRAVAIL/secrets"
printf '0:faux' > "$TRAVAIL/secrets/telegram_bot_token"
printf 'secret-essai' > "$TRAVAIL/secrets/telegram_webhook_secret"
printf 'cle-essai' > "$TRAVAIL/secrets/gemini_api_key"
chmod 644 "$TRAVAIL"/secrets/*
cp "$RACINE/infra/docker-compose.yml" "$TRAVAIL/compose.yaml"
cat > "$TRAVAIL/.env" <<EOF
ORGANIZER_VERSION=$ETIQUETTE
POSTGRES_PASSWORD=essai
NPM_IP=127.0.0.1
IP_PUBLICATION=127.0.0.1
DOMAINE_BOT=bot.essai
EOF

dc up -d
i=0
until curl -fsS "$URL/api/sante" 2>/dev/null | grep -q '"ok":true'; do
  i=$((i + 1)); [ "$i" -lt 60 ] || echec "la stack ne répond pas sur /api/sante"; sleep 3
done
[ "$(dc ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | grep '^migrate ')" = "migrate exited 0" ] || echec "migrations"

# Coquille, repli, en-têtes
curl -sS "$URL/" -o "$TRAVAIL/index.html"
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
[ "$(entete / referrer-policy)" = "no-referrer" ] || echec "Referrer-Policy"
[ "$(entete / x-content-type-options)" = "nosniff" ] || echec "nosniff"

# API derrière Caddy
[ "$(entete /api/session/moi cache-control)" = "no-store" ] || echec "/api doit être no-store"
[ "$(statut "$URL/api/session/moi")" = 401 ] || echec "/api/session/moi sans session"

# Webhook : seulement sur le domaine du bot, secret vérifié
[ "$(statut -X POST "$URL/telegram/webhook")" = 404 ] || echec "webhook ouvert sur le domaine principal"
CODE="$(statut -X POST -H 'Host: bot.essai' -H 'X-Telegram-Bot-Api-Secret-Token: faux' -H 'content-type: application/json' -d '{"update_id":1}' "$URL/telegram/webhook")"
[ "$CODE" = 401 ] || echec "webhook sans secret valide : $CODE au lieu de 401"

# Sortie : par le proxy seulement, vers la liste fermée seulement
dc exec -T api node apps/api/dist/cli.mjs essai-sortie https://api.telegram.org | grep -q '^joignable' || echec "api : Telegram devrait être joignable"
dc exec -T api node apps/api/dist/cli.mjs essai-sortie https://example.com | grep -q '^refusé' || echec "api : example.com devrait être refusé"
dc exec -T worker node apps/worker/dist/sonde.mjs sortie https://generativelanguage.googleapis.com | grep -q '^joignable' || echec "worker : Gemini devrait être joignable"
dc exec -T worker node apps/worker/dist/sonde.mjs sortie https://api.telegram.org | grep -q '^refusé' || echec "worker : Telegram devrait être refusé"
dc exec -T api node -e "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))" \
  || echec "api : sortie directe possible sans le proxy"
dc exec -T api ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus || echec "ffmpeg sans libopus"

echo "Essai de fumée réussi."
```

- [ ] **Step 6: Brancher l'essai et la publication dans la CI**

Dans `.github/workflows/ci.yml`, job `images` : ajouter `permissions:` au job, puis deux étapes après « Analyser les vulnérabilités » :
```yaml
    permissions:
      contents: read
      packages: write
```
```yaml
      - name: Essai de fumée sur la topologie réelle
        run: infra/image/essai.sh essai
      - name: Publier sur GHCR (étiquette v* seulement)
        if: startsWith(github.ref, 'refs/tags/v')
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin
          for cible in api worker web sortie; do
            docker tag "ghcr.io/djkix/organizer-$cible:essai" "ghcr.io/djkix/organizer-$cible:$VERSION"
            docker push "ghcr.io/djkix/organizer-$cible:$VERSION"
          done
```

- [ ] **Step 7: Répercuter les écarts dans le cahier**

Dans `docs/cahier-des-charges.md` :
- section « Services » : retirer la ligne `scheduler` du tableau et ajouter sous le tableau « Le `scheduler` rejoint la stack au lot 2, avec Google Agenda et la rotation de l'audio. » ; ligne `web` : image `ghcr.io/djkix/organizer-web` (Caddy 2.11, coquille de la PWA incluse), port interne 8080, volume « — », dépendance `api` ; ajouter la ligne `| \`sortie\` | \`ghcr.io/djkix/organizer-sortie\` (Squid) | 3128 | — | Internet, liste fermée |` ; remplacer « Six services » par « Six services au lot 1 (api, worker, web, sortie, db, queue), plus le conteneur de migrations ».
- section « Réseaux » : remplacer les trois puces par :
  « - `publication` : `web` seul, porte le seul port publié (7070, sur l'adresse de la VM), joint par le reverse proxy.
  - `edge` : `web` et `api`, interne.
  - `core` : `api`, `worker`, `db`, `queue`, migrations. Aucune sortie Internet.
  - `sortie` : `api` et `worker` vers le proxy sortant `sortie`, interne.
  - `egress` : le proxy sortant seul. Il n'ouvre à chaque conteneur que sa liste fermée de domaines, en HTTPS. »
- section « Volumes persistants » : retirer les lignes `models-emb` (« lot 2, avec les embeddings »), `web-dist` et `caddy-data`, et ajouter sous le tableau « La coquille de la PWA est dans l'image `web` : une mise à jour d'image la remplace. »
- section « Publication et TLS », tableau : cible de `organizer.djkix.ovh` → « `web:8080` (Caddy), qui relaie `/api` vers `api:3000` » ; cible de `organizer-bot.djkix.ovh` → « `web:8080`, qui ne relaie que `/telegram/webhook` ».
- section « Supervision », ligne « Taille de la stack » : « Audio au-dessus de 30 Go tant que la rotation n'est pas livrée (40 Go ensuite), ou base au-dessus de 8 Go ».
- section « Lot 2 — Rappels et fils » : ajouter la puce « Scheduler et rotation de l'audio ordinaire au-delà de 40 Go. »
- section « Ressources à réserver sur l'hôte Docker » : ajouter « 64 Mo pour le proxy sortant » à l'énumération des limites.

- [ ] **Step 8: Vérifier le succès**

Run: `pnpm exec vitest run infra/test && pnpm lint`
Expected: PASS.

Si Docker est disponible : construire les quatre images (tâche 11, étape 5) puis `infra/image/essai.sh essai`
Expected: `Essai de fumée réussi.`

Sinon, la CI fait foi : `git push`, puis `gh run watch`
Expected: jobs `tests` et `images` verts, étape « Essai de fumée sur la topologie réelle » réussie ; l'étape « Publier » est sautée (pas d'étiquette).

- [ ] **Step 9: Commiter**

Ligne de `CHANGELOG.md`, rubrique Modifié : « La stack de production : proxy sortant à liste fermée, API et worker sans route vers Internet, seul le port de Caddy publié, proxy de confiance et migrations obligatoires ; essai de fumée sur la topologie réelle en CI, publication des images sur GHCR à chaque étiquette de version (2026-10-05). »
```bash
git add infra package.json pnpm-lock.yaml .github docs/cahier-des-charges.md CHANGELOG.md
git commit -m "Ajoute la stack de production, son essai de fumée et la publication des images"   # + ligne vide + Co-Authored-By
```

---
### Task 13: Documentation d'exploitation

**Files:**
- Create: `docs/exploitation.md`, `infra/test/exploitation.test.ts`
- Modify: `README.md`, `CLAUDE.md`, `CHANGELOG.md`
- Test: `infra/test/exploitation.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède (commandes de la CLI, sonde, essai de fumée, compose, Caddyfile).
- Produces : `docs/exploitation.md`, référence durable de l'exploitation (le cahier exige « Documentation d'exploitation dans le dépôt : démarrage, restauration, rotation des secrets »). Les réglages du Nginx Proxy Manager y sont la source que la mise en service recopie.

- [ ] **Step 1: Écrire le test**

`infra/test/exploitation.test.ts` :
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELAI_ENVOI_PRIVE_MAX_MS, TAILLE_MAX_CAPTURE_PRIVEE } from '../../packages/shared/src/api.js';

const doc = readFileSync(join(import.meta.dirname, '../../docs/exploitation.md'), 'utf8');
const nombre = (re: RegExp): number => {
  const m = re.exec(doc);
  if (!m) throw new Error(`absent de docs/exploitation.md : ${re}`);
  return Number(m[1]);
};

describe('réglages du Nginx Proxy Manager documentés', () => {
  it('corps de 30 Mio au moins', () => {
    expect(nombre(/client_max_body_size (\d+)m;/) * 1024 * 1024).toBeGreaterThanOrEqual(TAILLE_MAX_CAPTURE_PRIVEE);
  });

  it('délais au moins égaux à celui d\'une capture privée d\'une heure', () => {
    for (const cle of ['client_body_timeout', 'proxy_read_timeout', 'proxy_send_timeout']) {
      expect(nombre(new RegExp(`${cle} (\\d+)s;`)) * 1000, cle).toBeGreaterThanOrEqual(DELAI_ENVOI_PRIVE_MAX_MS);
    }
  });

  it('webhook restreint aux plages de Telegram', () => {
    expect(doc).toContain('149.154.160.0/20');
    expect(doc).toContain('91.108.4.0/22');
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `pnpm exec vitest run infra/test/exploitation.test.ts`
Expected: FAIL (`docs/exploitation.md` absent).

- [ ] **Step 3: Écrire la documentation**

`docs/exploitation.md` :
````markdown
# Exploitation d'Organizer

Ce document décrit la stack de production et les gestes d'exploitation. Le régime normal ne demande
aucune action : la veille et Uptime Kuma alertent l'administrateur, jamais L.

## La stack

Hôte : VM Debian `debian-docker` (192.168.1.201), utilisateur `kix`, stack Dockge `organizer`
dans `/opt/stacks/organizer/` : `compose.yaml` (copie de `infra/docker-compose.yml`), `.env`
(modèle : `infra/.env.example`) et `secrets/` (un fichier par secret, droits 600, propriétaire uid 1000).

| Service | Rôle |
| --- | --- |
| `web` | Caddy : coquille de la PWA, en-têtes (CSP), relais de `/api` et du webhook. Seul port publié : `192.168.1.201:7070` |
| `api` | NestJS : PWA, webhook Telegram, ingestion, alertes, veille. Sort par `sortie` vers `api.telegram.org` seulement |
| `worker` | Classement par Gemini. Sort par `sortie` vers `generativelanguage.googleapis.com` seulement |
| `sortie` | Squid : seule route vers Internet, liste fermée de domaines (`infra/sortie/squid.conf`) |
| `migrate` | Migrations Prisma, avant `api` et `worker`, puis s'arrête (état « Exited (0) ») |
| `db`, `queue` | PostgreSQL 17 et Valkey 8, sans aucune route vers Internet |

Volumes : `organizer_pgdata` (base), `organizer_audio` (audio, privé compris), `organizer_valkeydata` (file).

Depuis le Mac, une fonction pour lancer une commande dans le dossier de la stack :
```sh
vm() { ssh -t kix@192.168.1.201 "cd /opt/stacks/organizer && $*"; }
```

## Commandes courantes

| Commande | Rôle |
| --- | --- |
| `vm docker compose ps -a` | état des services |
| `vm docker compose logs --since 1h api worker` | journaux (identifiants et noms d'erreur seulement, jamais de contenu) |
| `vm docker compose exec -T api node apps/api/dist/cli.mjs veille` | mesures de la veille |
| `vm docker compose exec -T api node apps/api/dist/cli.mjs alerte-essai` | alerte d'essai vers les administrateurs liés |
| `vm docker compose exec -T api node apps/api/dist/cli.mjs telegram-webhook etat` | webhook : adresse, messages en attente, dernière erreur |
| `vm docker compose exec -T api node apps/api/dist/cli.mjs essai-sortie <url>` | la sortie de l'API vers cette adresse est-elle ouverte ? |
| `vm docker compose exec -T worker node apps/worker/dist/sonde.mjs palier` | palier Gemini, réflexion, jetons (aucun contenu) |
| `vm docker compose exec api node apps/api/dist/cli.mjs creer-utilisateur <nom> [--admin]` | créer un compte |
| `vm docker compose exec api node apps/api/dist/cli.mjs mot-de-passe <nom>` | poser ou changer un mot de passe (saisie masquée) |
| `vm docker compose exec -T api node apps/api/dist/cli.mjs lier-chat <nom> <chat_id>` | lier un compte à un chat Telegram sans code |
| `vm docker compose exec -T api node apps/api/dist/cli.mjs code-liaison <nom>` | code `/start` à usage unique, 10 minutes |
| `vm docker compose exec -T api node apps/api/dist/cli.mjs delier <nom>` | délier un compte de son chat |

## Nginx Proxy Manager

Deux hôtes, tous deux vers `http://192.168.1.201:7070`, certificat Let's Encrypt, « Force SSL »,
« HTTP/2 », « HSTS » activés, « Websockets » désactivé.

`organizer.djkix.ovh`, onglet « Advanced » :
```nginx
client_max_body_size 32m;
client_body_timeout 1800s;
proxy_request_buffering off;
proxy_read_timeout 1800s;
proxy_send_timeout 1800s;
```

`organizer-bot.djkix.ovh` : liste d'accès « Telegram » (« Allow » `149.154.160.0/20` et
`91.108.4.0/22`, puis « Deny » `all`), onglet « Advanced » :
```nginx
client_max_body_size 1m;
```

`NPM_IP` (dans `.env`) est l'adresse depuis laquelle le Nginx Proxy Manager joint la VM : c'est le
seul proxy dont Caddy croit `X-Forwarded-For`. Contrôle : depuis un téléphone en 4G,
`https://organizer.djkix.ovh/api/sante` affiche `"vu"` = l'adresse publique du téléphone.

## Telegram

Le webhook se pose à la main, jamais au démarrage : `telegram-webhook poser` (une connexion à la fois,
secret vérifié, messages en attente gardés). `telegram-webhook retirer` rend les messages en attente au
prochain lecteur ; Telegram les garde 24 heures.

## Mettre à jour

1. Lire le `CHANGELOG.md` de la version.
2. Copie de la base, gardée sur la VM seulement (données de L) :
   `vm 'umask 077; mkdir -p ~/sauvegardes; docker compose exec -T db pg_dump -U organizer -Fc organizer > ~/sauvegardes/organizer-$(date +%F).dump'`
3. Dans `.env`, `ORGANIZER_VERSION=<nouvelle version>`, puis `vm docker compose pull` et
   `vm docker compose up -d --wait` (ou « Mettre à jour » dans Dockge).
4. Vérifier : `vm docker compose ps -a` (`migrate` « Exited (0) », les autres « healthy » ou « running »),
   `curl -s https://organizer.djkix.ovh/api/sante`, `telegram-webhook etat` sans erreur récente,
   `vm docker compose logs --since 5m worker` contient « Worker démarré ».
5. La PWA se met à jour quand toutes ses fenêtres sont fermées sur le téléphone.

## Revenir à la version précédente

- Sans nouvelle migration : remettre l'ancienne `ORGANIZER_VERSION`, puis `vm docker compose up -d --wait`.
- Avec une migration : `vm docker compose stop api worker`, restaurer la copie de l'étape 2 de la mise à jour
  (`vm 'docker compose exec -T db pg_restore -U organizer -d organizer --clean --if-exists < ~/sauvegardes/organizer-<date>.dump'`),
  remettre l'ancienne version, puis `vm docker compose up -d --wait`.

## Changer un secret

| Secret | Gestes |
| --- | --- |
| Jeton du bot | `/revoke` chez BotFather ; écrire le nouveau jeton dans `secrets/telegram_bot_token` (sans retour à la ligne) ; `vm docker compose up -d --force-recreate api` ; `telegram-webhook poser` |
| Secret du webhook | `vm 'openssl rand -hex 32 \| tr -d "\n" > secrets/telegram_webhook_secret'` ; recréer `api` ; `telegram-webhook poser` aussitôt. Entre les deux, Telegram reçoit 401 et relivre : rien ne se perd |
| Clé Gemini | nouvelle clé dans le même projet facturé ; `secrets/gemini_api_key` ; `vm docker compose up -d --force-recreate worker` ; `sonde palier` ; supprimer l'ancienne clé |
| Mot de passe PostgreSQL | `vm "docker compose exec -T db psql -U organizer -c \"ALTER USER organizer PASSWORD '<nouveau>'\""` ; `POSTGRES_PASSWORD` dans `.env` ; `vm docker compose up -d --wait` |
| Jeton GHCR (images privées) | nouveau jeton classique `read:packages` ; `docker login ghcr.io -u djkix` sur la VM et dans le conteneur de Dockge |

Les secrets et le `.env` sont aussi gardés dans le gestionnaire de mots de passe.

## Supervision

- Uptime Kuma : `https://organizer.djkix.ovh/api/sante` (mot-clé `"ok":true`) et `https://organizer.djkix.ovh/`,
  toutes les 60 s, alerte après 2 échecs consécutifs.
- Veille de l'API, toutes les 15 minutes, vers les administrateurs liés à Telegram, une fois par constat :

| Message | Que faire |
| --- | --- |
| « File de classement : N captures en attente. » | `docker compose logs worker` ; Gemini indisponible ou worker arrêté |
| « N classements en échec depuis une heure. » | journaux du worker ; les captures reprennent seules chaque heure |
| « Audio : N Go. La rotation arrive au lot 2. » | rien ne se perd ; planifier le lot 2 avant 40 Go |
| « Base : N Go, au-delà de 8 Go. » | examiner la croissance de la base |
| « Classement lent : N s en moyenne sur une heure. » | latence de Gemini ou file engorgée |
| « Crédit Gemini épuisé : classement suspendu. » | verser du crédit au prépaiement ; les captures attendent dans l'ordre |
| « Gemini refuse pour quota ou budget (429) : classement suspendu. » | plafond de 9 € atteint ou quota : vérifier le budget du mois |
| « Gemini refuse la clé ou le projet (403) : classement suspendu. » | clé révoquée ou facturation coupée : `sonde palier` |
| « Information : aucune capture depuis 10 jours. » | aucune action ; ne jamais en parler à L comme d'un incident |

## Sauvegarde et restauration

Décision 11 : aucune sauvegarde automatique avant le lot 2. Seules protections : le snapshot Proxmox de la
VM, s'il est en place, et la copie de la base avant chaque mise à jour. Copie de l'audio :
`vm 'umask 077; docker run --rm -v organizer_audio:/a:ro -v ~/sauvegardes:/s alpine tar czf /s/audio-$(date +%F).tgz -C /a .'`
Restauration de la base : voir « Revenir à la version précédente ».

## Rotation de l'audio

Pas encore livrée (lot 2, avec le scheduler). D'ici là, aucun audio n'est supprimé. La veille alerte au-delà
de 30 Go ; aux volumes estimés (20 à 45 Go par an), il reste plusieurs mois avant le plafond de 40 Go.

## Palier Gemini

Le worker refuse de démarrer si `serviceTier` n'est pas dans `GEMINI_TIERS_PAYES` (règle n° 8) et attend,
sans démarrer, tant que le contrôle est impossible. `sonde palier` montre la valeur reçue.
`GEMINI_THINKING_LEVEL` vide si le modèle refuse le niveau de réflexion (HTTP 400 à la sonde).
````

Dans `README.md` :
- section « État du projet » : remplacer « Pas encore livré : le déploiement (plan 1-C). L'application n'est pas en service. » par « Le déploiement est prêt (plan 1-C) : images, stack de production, CI. La mise en service attend la sortie du lot 0. » ;
- section « Arborescence » : remplacer la ligne de `infra/` par :
```
infra/            docker-compose.yml (production), .env.example
infra/caddy/      Caddyfile : coquille, en-têtes, relais de /api et du webhook
infra/image/      Dockerfile (api, worker, web, sortie) et essai de fumée
infra/sortie/     squid.conf : liste fermée de domaines en sortie
scripts/          empaquetage esbuild de l'API et du worker
```
- section « Configuration de l'API et du worker », ajouter au tableau :
```
| `TELEGRAM_WEBHOOK_URL` | adresse publique du webhook, pour `cli telegram-webhook poser` |
| `TELEGRAM_API_ROOT` | racine de l'API Bot (tests) ; défaut `https://api.telegram.org` |
| `GEMINI_THINKING_LEVEL` | niveau de réflexion demandé à Gemini ; vide : rien n'est demandé |
| `HTTPS_PROXY`, `NO_PROXY` | proxy sortant ; en production `http://sortie:3128` |
```
et remplacer la ligne de `TRUSTED_PROXY` par « adresses dont l'API croit `X-Forwarded-For`, séparées par des virgules ; **obligatoire en production** (sous-réseau de Caddy et IP du Nginx Proxy Manager) ; défaut ailleurs : `loopback` ». Ajouter à la liste des routes : « `GET /api/sante` : base et file joignables (200 ou 503) et adresse vue par l'API, pour la supervision ». Ajouter : « En production, `PROMPTS_DIR` et `AUDIO_STORAGE_PATH` doivent être absolus. »
- section « Administration », ajouter au tableau :
```
| `pnpm --filter @organizer/api cli lier-chat <nom> <chat_id>` | lie un compte à un chat sans code (bascule depuis le banc d'essai) |
| `pnpm --filter @organizer/api cli telegram-webhook poser\|retirer\|etat` | pose, retire ou décrit le webhook |
| `pnpm --filter @organizer/api cli veille` | mesures de la supervision |
| `pnpm --filter @organizer/api cli alerte-essai` | alerte d'essai vers les administrateurs |
| `pnpm --filter @organizer/api cli essai-sortie <url>` | essai de sortie par le proxy |
| `pnpm --filter @organizer/api cli importer-terrain <dossier>` | importe les captures du banc d'essai |
```
et la phrase « En production, les mêmes commandes : `docker compose exec api node apps/api/dist/cli.mjs <commande>` (voir [`docs/exploitation.md`](docs/exploitation.md)). »
- section « Commandes », ajouter :
```
| `pnpm --filter @organizer/worker sonde palier` | palier Gemini du projet de la clé, réflexion, jetons ; aucun contenu |
| `pnpm --filter @organizer/api build`, `pnpm --filter @organizer/worker build` | empaquetage en `dist/*.mjs` |
| `infra/image/essai.sh [étiquette]` | essai de fumée des images (Docker requis) |
```
- nouvelle section « Déploiement », avant « Confidentialité et dépôt public » : « Images construites et analysées par la CI à chaque poussée ; publiées sur GHCR à chaque étiquette `v<version>`. Déploiement manuel depuis Dockge. Tout le reste : [`docs/exploitation.md`](docs/exploitation.md). »
- section « Documentation » : ajouter `docs/exploitation.md`.
Vérifier chaque commande citée.

Dans `CLAUDE.md` :
- « Arborescence » : remplacer `infra/            docker-compose.yml, Caddyfile` par `infra/            docker-compose.yml, caddy/, image/, sortie/ (production)` et ajouter `scripts/          empaquetage esbuild` ;
- « État du projet » : ajouter à la fin « Lot 1-C : déploiement prêt (images, stack, CI, `docs/exploitation.md`) ; la mise en service suit la procédure du plan `docs/superpowers/plans/2026-10-05-lot1-c-deploiement.md`, après la sortie du lot 0. »

- [ ] **Step 4: Vérifier le succès**

Run: `pnpm exec vitest run infra/test`
Expected: PASS.

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @organizer/web e2e`
Expected: PASS (tunnel ouvert).

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La documentation d'exploitation : stack, commandes, Nginx Proxy Manager, mise à jour, retour arrière, changement des secrets, supervision et sauvegarde manuelle (2026-10-05). »
```bash
git add docs/exploitation.md infra/test/exploitation.test.ts README.md CLAUDE.md CHANGELOG.md
git commit -m "Ajoute la documentation d'exploitation"   # + ligne vide + Co-Authored-By
```

Puis relecture finale de la branche, fusion dans `main` sur accord de Franck, CI verte sur `main`.

---

## Partie 2 — Mise en service

Procédure sur le réel. **Aucune étape ne se fait sans l'accord de Franck donné à ce moment-là** : quand
l'agent est indiqué, il demande « J'exécute l'étape X.Y ? » et attend la réponse avant chaque étape.
Une étape dont le résultat diffère de l'attendu arrête la procédure : on applique son retour arrière et
on en parle avant d'aller plus loin.

Depuis le Mac, dans chaque terminal utilisé :
```sh
vm() { ssh -t kix@192.168.1.201 "cd /opt/stacks/organizer && $*"; }
cli() { vm docker compose exec -T api node apps/api/dist/cli.mjs "$@"; }
```

### Pourquoi aucune capture ne se perd pendant la bascule

1. L'application tourne et est vérifiée **avant** l'arrêt du banc d'essai (phase B). En webhook, l'API ne lit
   pas le bot : le banc d'essai reste le seul lecteur jusqu'à l'étape C3.
2. Les comptes sont liés aux chats de L et de Franck **avant** l'arrêt (C1, `lier-chat`) : aucun vocal ne
   tombe sur « Ce compte n'est pas lié. ».
3. Entre l'arrêt du banc d'essai (C3) et la pose du webhook (C5), Telegram garde les messages (24 heures).
   La fenêtre visée est de moins de 30 minutes.
4. L'import (C4) se fait banc d'essai arrêté, avant le webhook ; les messages relivrés ensuite par Telegram
   portent la même `source_ref` : pas de doublon.
5. Le webhook est posé avec `drop_pending_updates: false` : les messages en attente sont livrés.
6. Retour arrière (`telegram-webhook retirer`, puis redémarrage du banc d'essai) : les messages en attente
   restent chez Telegram et vont au banc d'essai ; ceux déjà reçus par l'application y restent.

### Phase 0 — Conditions

| # | Qui | Geste | Attendu | Retour arrière |
| --- | --- | --- | --- | --- |
| 0.1 | Franck | Confirmer la version de prompt en service : `tri/v1` (décision 22, pas d'attente de la sortie du lot 0) | Version de prompt connue, pour `PROMPT_VERSION` | — |
| 0.2 | Franck | Branche `lot1-c-deploiement` relue et fusionnée dans `main` | CI verte sur `main` (`gh run list --branch main --limit 1`) | — |
| 0.3 | Franck | Répondre aux « Questions pour Franck » (fin du plan) | Décisions notées | — |

### Phase A — Gemini, depuis le Mac (aucun serveur)

| # | Qui | Geste | Attendu | Retour arrière |
| --- | --- | --- | --- | --- |
| A1 | Franck | Console Google Cloud du projet Organizer : Facturation | Prépaiement **sans** recharge automatique ; budget de 9 €/mois sur l'API Gemini avec plafond appliqué ; alertes 50, 80, 100 % ; seul le projet Organizer lié au compte de facturation | Corriger le réglage fautif |
| A2 | Agent | `pnpm --filter @organizer/worker sonde palier` (lit la clé du projet facturé dans le `.env` racine, avec `GEMINI_THINKING_LEVEL=minimal` ; si la clé manque, Franck l'y ajoute) | `HTTP 200 · palier « standard » : payé · réflexion minimal · jetons : …, réflexion 0` (ou un petit nombre). Noter la valeur exacte du palier pour `GEMINI_TIERS_PAYES`. Si `HTTP 400` : relancer avec `GEMINI_THINKING_LEVEL= pnpm --filter @organizer/worker sonde palier` ; si alors `HTTP 200`, le modèle refuse ce niveau : la stack aura `GEMINI_THINKING_LEVEL=` vide | — |
| A3 | Franck puis agent | **Porte `serviceTier`** (si Franck l'autorise, question 5) : Franck crée un projet Google Cloud jetable **sans facturation** et une clé AI Studio ; l'agent lance `GEMINI_API_KEY="<clé jetable>" pnpm --filter @organizer/worker sonde palier` (seul le texte fixe « ok » part) | Code de sortie 1 et `palier « … » : REFUSÉ` ou `HTTP 4xx : palier non vérifiable.` (dans les deux cas, le worker ne traiterait rien). **Si la sonde affiche « payé » : arrêt de la mise en service**, le contrôle est remplacé (voir Hors de ce plan) | Franck supprime la clé et le projet jetables |
| A4 | Franck puis agent | Facultatif, pour connaître le code d'une pause de budget : abaisser le plafond du budget au minimum accepté, attendre la pause (alerte à 100 %), puis `pnpm --filter @organizer/worker sonde palier` | `HTTP 402`, `403` ou `429` : couverts par le worker (pause et alerte, jamais `a_revoir`). Noter le code dans `docs/exploitation.md`. Un autre code : arrêt, le worker serait à adapter | Remettre le plafond à 9 € |

### Phase B — Répétition sur la VM, banc d'essai intact

| # | Qui | Geste | Attendu | Retour arrière |
| --- | --- | --- | --- | --- |
| B1 | Agent | `ssh kix@192.168.1.201 'id; free -m; df -h /var/lib/docker; ls -ld /opt/stacks /opt/stacks/organizer-terrain; docker network ls -q \| xargs docker network inspect -f "{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}"; docker ps --format "{{.Names}}\t{{.Status}}"; ss -ltn | grep -c ":7070 "'` | `uid=1000(kix)` ; `0` pour le dernier (port 7070 libre) ; au moins 3 Go de RAM disponibles et 50 Go libres ; aucun réseau en `10.201.1.0/24` ni `10.201.2.0/24` ; `organizer-terrain-bot-1` « Up ». Noter si `/opt/stacks` est inscriptible par `kix` | — (lecture) |
| B2 | Franck | DNS : `dig +short organizer.djkix.ovh organizer-bot.djkix.ovh` | L'adresse publique du homelab pour les deux ; sinon créer les enregistrements chez OVH | Supprimer les enregistrements créés |
| B3 | Franck puis agent | Accès aux images (question 4). Images privées : Franck crée un jeton GitHub classique `read:packages` ; puis `ssh -t kix@192.168.1.201 'docker login ghcr.io -u djkix'` et `ssh -t kix@192.168.1.201 'docker exec -it $(docker ps -qf name=dockge) docker login ghcr.io -u djkix'` (Franck colle le jeton) | « Login Succeeded » deux fois | `docker logout ghcr.io` (VM et Dockge) ; révoquer le jeton |
| B4 | Agent | Publier la version : sur `main`, dans `CHANGELOG.md`, renommer « [Non publié] » en « [1.0.0] - <date> » et rouvrir une rubrique « [Non publié] » vide ; commit « Publie la version 1.0.0 » (+ ligne vide + Co-Authored-By) ; `git tag -a v1.0.0 -m "Lot 1"` ; `git push origin main v1.0.0` ; `gh run watch` | Job `images` vert, étape « Publier sur GHCR » réussie ; `gh api /users/djkix/packages?package_type=container --jq '.[].name'` liste `organizer-api`, `organizer-worker`, `organizer-web`, `organizer-sortie` ; visibilité conforme à la question 4 (réglage de chaque paquet sur GitHub) | Supprimer l'étiquette (`git push origin :refs/tags/v1.0.0`) et les versions publiées ; rien n'est déployé |
| B5 | Agent, Franck pour les secrets | Préparer la stack. Si `/opt/stacks` n'est pas inscriptible par `kix` (B1), Franck lance une fois `sudo install -d -o kix -g kix /opt/stacks/organizer`. Puis : `scp infra/docker-compose.yml kix@192.168.1.201:/opt/stacks/organizer/compose.yaml` ; `vm 'install -d -m 700 secrets'` ; secrets repris du banc d'essai **sans affichage** (si `../organizer-terrain/.env` n'est pas lisible par `kix`, Franck lance ces deux lignes avec `sudo sh -c`) : `vm "sed -n 's/^TELEGRAM_BOT_TOKEN=//p' ../organizer-terrain/.env \| tr -d '\r\n' > secrets/telegram_bot_token"`, `vm "sed -n 's/^GEMINI_API_KEY=//p' ../organizer-terrain/.env \| tr -d '\r\n' > secrets/gemini_api_key"`, `vm "openssl rand -hex 32 \| tr -d '\n' > secrets/telegram_webhook_secret"`, `vm 'chmod 600 secrets/*'` ; `.env` : `vm 'umask 077; printf "%s\n" ORGANIZER_VERSION=1.0.0 POSTGRES_PASSWORD=$(openssl rand -hex 24) NPM_IP=<IP du NPM> IP_PUBLICATION=192.168.1.201 DOMAINE_BOT=organizer-bot.djkix.ovh PROMPT_VERSION=<0.1> GEMINI_TIERS_PAYES=<A2> GEMINI_THINKING_LEVEL=<A2> > .env'` | `vm 'ls -l secrets .env'` : quatre fichiers en `-rw-------` à `kix` ; chaque secret non vide (`vm 'wc -c secrets/*'`) ; `vm docker compose config -q` sans sortie | `vm 'rm -rf secrets .env compose.yaml'` |
| B6 | Agent | `vm docker compose pull` puis `vm docker compose up -d --wait` | `vm docker compose ps -a` : `migrate` « Exited (0) » ; `db`, `queue`, `api`, `web` « healthy » ; `worker`, `sortie` « running » ; `vm docker compose logs worker` contient « Worker démarré. Prompt <0.1> » (palier vérifié à travers le proxy). Le banc d'essai reste le lecteur du bot (API en webhook sans webhook posé) | `vm docker compose down` (volumes gardés, aucune donnée réelle) |
| B7 | Agent | Sortie et isolement : `cli essai-sortie https://api.telegram.org` ; `cli essai-sortie https://example.com` ; `vm docker compose exec -T worker node apps/worker/dist/sonde.mjs sortie https://example.com` ; `vm docker compose exec -T worker node apps/worker/dist/sonde.mjs palier` ; `vm 'docker run --rm --network organizer_core alpine wget -T 5 -qO /dev/null https://example.com && echo SORTIE \|\| echo isolé'` | `joignable (HTTP …)` ; `refusé (…)` ; `refusé (…)` ; `… : payé …` ; `isolé` | — |
| B8 | Franck | Nginx Proxy Manager : créer les deux hôtes **exactement** comme dans `docs/exploitation.md` (section « Nginx Proxy Manager ») ; relever l'IP du conteneur 101 vue par la VM ; si elle diffère de `NPM_IP`, corriger `.env` puis `vm docker compose up -d web api` | Certificats émis ; les deux hôtes « Online » | Désactiver ou supprimer les deux hôtes |
| B9 | Agent | Depuis le Mac : `curl -sI http://organizer.djkix.ovh/ \| head -1` ; `curl -sI https://organizer.djkix.ovh/ \| grep -iE '^(content-security-policy\|cache-control\|permissions-policy\|referrer-policy\|x-content-type-options\|strict-transport-security):'` ; `curl -s -o /dev/null -w '%{http_code}\n' https://organizer.djkix.ovh/prive/enregistrer` ; `curl -sI https://organizer.djkix.ovh/manifest.webmanifest \| grep -i content-type` ; `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://organizer-bot.djkix.ovh/telegram/webhook` ; `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://organizer.djkix.ovh/telegram/webhook` ; `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: organizer-bot.djkix.ovh' -H 'X-Telegram-Bot-Api-Secret-Token: faux' -H 'content-type: application/json' -d '{"update_id":1}' http://192.168.1.201:7070/telegram/webhook`. Puis Franck, sur son téléphone **en 4G**, ouvre `https://organizer.djkix.ovh/api/sante` | Redirection 301 vers HTTPS ; CSP avec `'sha256-…'` et `frame-ancestors 'none'`, `no-cache`, `microphone=(self)`, `no-referrer`, `nosniff`, HSTS ; `200` ; `application/manifest+json` ; `403` (liste d'accès Telegram) ; `404` ; `401` (secret vérifié). Sur le téléphone : `{"ok":true,"vu":"<adresse publique du téléphone>"}`, ni l'IP du NPM ni une 192.168.x | Corriger NPM ou `NPM_IP` |
| B10 | Agent, Franck pour le mot de passe | Compte de répétition et gros envoi : `cli creer-utilisateur essai --admin` ; `vm docker compose exec api node apps/api/dist/cli.mjs mot-de-passe essai` (Franck tape) ; puis sur le Mac : `read -rs MDP; curl -s -c /tmp/c.txt -H 'content-type: application/json' -d "{\"nom\":\"essai\",\"motDePasse\":\"$MDP\"}" -o /dev/null -w '%{http_code}\n' https://organizer.djkix.ovh/api/session` ; `head -c 31000000 /dev/urandom > /tmp/gros.bin` ; `curl -s -b /tmp/c.txt --limit-rate 100k -H 'content-type: audio/webm' -H "X-Capture-Id: $(uuidgen \| tr A-Z a-z)" --data-binary @/tmp/gros.bin -w '\n%{http_code} %{time_total}\n' https://organizer.djkix.ovh/api/captures/privees` ; `rm /tmp/gros.bin /tmp/c.txt` | `204` ; après plus de 5 minutes : `{"message":"Enregistrement illisible."}` puis `422 <plus de 300 s>` (le corps de 31 Mo a traversé NPM, Caddy et Node sans 413 ni coupure ; ffmpeg refuse des octets aléatoires) | — |
| B11 | Franck | Essai sur un vrai Android 12 ou plus (Chrome 120 ou plus), compte `essai` : (1) installer depuis Chrome ; (2) appui long sur l'icône : « Enregistrement privé » et « Aujourd'hui » ; (3) mode avion, raccourci privé, enregistrer 10 s : l'enregistreur s'ouvre, « Il partira au retour du réseau. », puis réseau rétabli : la capture apparaît dans Privé ; (4) mode avion, enregistrer, **fermer l'application** (balayer), rétablir le réseau, attendre 5 min sans l'ouvrir, puis `vm 'docker compose exec -T db psql -U organizer -c "select count(*) from capture where prive"'` augmente ; (5) verrouiller l'écran pendant un enregistrement : il s'arrête et la capture est gardée ; (6) une heure d'enregistrement : arrêt automatique à 60:00, envoi réussi, `vm 'docker compose exec -T api sh -c "ls -l /data/audio/prive/*/*/ \| tail -3"'` montre un fichier d'environ 14 Mo (Opus 32 kbit/s après réencodage ; environ 22 Mo envoyés) ; (7) réécouter depuis Privé | Les sept points conformes. (La mise à jour sans rechargement se vérifie à la première mise à jour, étape E1) | Désinstaller la PWA |
| B12 | Franck | Uptime Kuma : deux sondes comme dans `docs/exploitation.md` (section « Supervision »), canal de notification de Franck (question 7) | Les deux sondes « Up » | Supprimer les sondes |
| B13 | Agent | Remise à zéro après la répétition : `vm docker compose down` ; `vm docker volume rm organizer_pgdata organizer_audio organizer_valkeydata` ; `vm docker compose up -d --wait` | `vm 'docker compose exec -T db psql -U organizer -c "select count(*) from utilisateur"'` → `0` ; services sains. Franck désinstalle la PWA de répétition | — (données de répétition seulement) |

### Phase C — Bascule, dans la fenêtre convenue (question 2)

| # | Qui | Geste | Attendu | Retour arrière |
| --- | --- | --- | --- | --- |
| C1 | Agent, Franck pour les mots de passe et les identifiants | Comptes réels (noms : question 6) : `cli creer-utilisateur <nom de L>` ; `cli creer-utilisateur <nom de Franck> --admin` ; `vm docker compose exec api node apps/api/dist/cli.mjs mot-de-passe <nom de Franck>` puis `… mot-de-passe <nom de L>` ; Franck lit `vm 'grep ^ALLOWED_CHAT_IDS= ../organizer-terrain/.env'` et dit quel identifiant est celui de L, lequel le sien ; `cli lier-chat <nom de L> <chat de L>` ; `cli lier-chat <nom de Franck> <chat de Franck>` (s'il n'est pas dans la liste : `cli code-liaison <nom de Franck>` après C5, puis `/start <code>`) | « Compte … créé. », « Mot de passe … enregistré. », « Compte … lié au chat … » | `cli delier <nom>` ; supprimer les comptes par `vm 'docker compose exec -T db psql -U organizer -c "delete from utilisateur"'` (aucune capture encore) |
| C2 | Agent | `cli telegram-webhook etat` | `adresse : (aucune)`, `en attente : 0` ou un petit nombre (le banc d'essai lit) | — |
| C3 | Agent | Arrêt du banc d'essai : `ssh kix@192.168.1.201 'docker compose -f /opt/stacks/organizer-terrain/compose.yaml stop'` (ou « Arrêter » dans Dockge) ; noter l'heure | `ssh kix@192.168.1.201 'docker ps -qf name=organizer-terrain'` vide. Dès lors, les messages de L attendent chez Telegram | `ssh kix@192.168.1.201 'docker compose -f /opt/stacks/organizer-terrain/compose.yaml start'` |
| C4 | Agent | Si Franck a décidé l'import (question 1) : `ssh kix@192.168.1.201 'docker run --rm -v organizer-terrain_donnees:/d:ro alpine wc -l /d/data/captures.jsonl'` puis `vm docker compose stop api` ; `vm docker compose run --rm --no-deps -v organizer-terrain_donnees:/terrain:ro api node apps/api/dist/cli.mjs importer-terrain /terrain/data` ; `vm docker compose up -d api` (le conteneur d'import reprendrait l'adresse fixe de `api`) ; quelques minutes après, `vm 'docker compose exec -T db psql -U organizer -c "select etat, count(*) from capture group by etat"'` | `Import : N importées, 0 sans compte, 0 illisibles, …` avec N proche du nombre de lignes (une ligne en double du banc d'essai compte en « déjà là ») ; puis les états passent de `en_file` à `classee` ou `a_revoir` | Avant C5 seulement : `vm docker compose down`, `vm docker volume rm organizer_pgdata organizer_audio organizer_valkeydata`, `vm docker compose up -d --wait`, refaire C1 |
| C5 | Agent | **Pose du webhook** : `cli telegram-webhook poser` ; une minute plus tard, `cli telegram-webhook etat` | `Webhook posé.` ; `adresse : https://organizer-bot.djkix.ovh/telegram/webhook`, `connexions max : 1`, `en attente : 0` à la seconde lecture, `dernière erreur : aucune`. Les vocaux envoyés depuis C3 ont reçu « Reçu. » | `cli telegram-webhook retirer`, puis le retour arrière de C3 (le banc d'essai repart et relit les messages en attente) |
| C6 | Franck | Essai réel depuis son Telegram : un vocal fabriqué de type pensée (« Je me dis que le jardin aurait besoin d'eau. ») ; puis le bouton « Prochaine capture privée » et un vocal ; puis `cli alerte-essai` | « Reçu. » en moins de 2 s ; `vm 'docker compose exec -T db psql -U organizer -c "select prive, etat, modele, version_prompt from capture order by recu_le desc limit 2"'` : la privée en `t \| privee` sans modèle, l'ordinaire en `f \| classee` avec la version de 0.1 ; le message d'essai arrive sur le Telegram de Franck | — |
| C7 | Franck | Téléphone de L : installer la PWA, se connecter, vérifier les deux raccourcis, une capture privée ; dire à L que c'est en place | L voit ses listes (ses actions du banc d'essai si C4) ; la capture privée apparaît dans Privé | Désinstaller ; L continue à dicter dans Telegram (rien ne change pour elle) |
| C8 | Agent | Le lendemain : `cli veille` ; `cli telegram-webhook etat` ; `vm 'docker compose logs --since 24h api worker \| grep -ciE "erreur\|error"'` | Mesures cohérentes, aucune erreur de webhook, quelques lignes d'erreur au plus, toutes expliquées | Selon le constat |

### Phase D — Retrait du banc d'essai (sept jours après C5, sur décision de Franck)

| # | Qui | Geste | Attendu | Retour arrière |
| --- | --- | --- | --- | --- |
| D1 | Agent | `ssh kix@192.168.1.201 'cd /opt/stacks/organizer-terrain && docker compose down && shred -u .env'` (jamais `down -v`) ; puis retirer la stack de Dockge | Plus aucun conteneur `organizer-terrain` ; `docker volume ls` montre encore `organizer-terrain_donnees` ; le `.env` (qui contenait les secrets) n'existe plus | Recréer la stack depuis `infra/terrain/compose.yaml` de l'historique Git et un `.env` refait |
| D2 | Franck | Décider du sort du volume `organizer-terrain_donnees` (question 8) : l'archiver (`ssh kix@192.168.1.201 'umask 077; mkdir -p ~/sauvegardes; docker run --rm -v organizer-terrain_donnees:/d:ro -v ~/sauvegardes:/s alpine tar czf /s/terrain-$(date +%F).tgz -C /d data'`), puis le supprimer (`docker volume rm organizer-terrain_donnees`) une fois le corpus relu | Archive présente si demandée ; volume supprimé seulement sur décision explicite | Irréversible après suppression : ne supprimer qu'avec l'archive vérifiée (`tar tzf … \| head`) |
| D3 | Agent | Dans le dépôt, sur une branche : `git rm -r infra/terrain` ; `eslint.config.js` : retirer `'infra/terrain/**'` des `ignores` ; `CLAUDE.md` : le paragraphe « Banc d'essai terrain » devient « Banc d'essai terrain : retiré le <date>, remplacé par l'application ; son volume reste lu par `tools/relecture` tant qu'il existe. » ; `README.md` : retirer les mentions du banc d'essai comme service actif ; ligne de `CHANGELOG.md`, rubrique Retiré : « Le banc d'essai terrain, remplacé par l'application (<date>). » ; commit « Retire le banc d'essai terrain » (+ ligne vide + Co-Authored-By) ; fusion sur accord | `pnpm test && pnpm lint` verts | `git revert` du commit |

### Phase E — À chaque mise à jour

| # | Qui | Geste | Attendu | Retour arrière |
| --- | --- | --- | --- | --- |
| E1 | Agent sur accord, Franck pour le téléphone | Procédure « Mettre à jour » de `docs/exploitation.md`. **À la première mise à jour**, vérifier aussi sur le téléphone : une capture privée en cours au moment du déploiement n'est jamais interrompue ; la nouvelle version s'applique après fermeture de toutes les fenêtres de l'application | Enregistrement intact ; nouvelle version après réouverture | « Revenir à la version précédente » (`docs/exploitation.md`) |

---

## Couverture des portes de mise en service

| Porte | Où |
| --- | --- |
| `serviceTier` refuse un projet non facturé | Tâche 6 (sonde, `diagnostiquer`) ; étape A3 |
| Pause de budget traitée comme indisponibilité, sans `a_revoir` | Tâche 6 (403, 429 ; test « quota ou budget ») ; étape A4 |
| `thinkingLevel` minimal si le modèle le permet | Tâche 6 ; étape A2 |
| Empaquetage des apps, Prisma en production, `prompts/` et `PROMPTS_DIR` dans les images, `RACINE_DEPOT` | Tâches 1 (chemins absolus), 10 (esbuild, Prisma), 11 (images), 12 (`migrate`) |
| L'API ne meurt plus si Telegram est injoignable | Tâche 3 (« l'API démarre et répond même si Telegram est injoignable ») |
| Filtre d'exceptions global sans contenu | Tâche 2 |
| Purge des sessions expirées | Tâche 4 |
| `TRUSTED_PROXY` obligatoire et posé dans le compose | Tâches 1 et 12 ; étape B9 (`vu`) |
| Webhook `max_connections: 1`, `setWebhook` avec le secret | Tâche 3 ; étapes B9 (401) et C5 |
| ffmpeg avec libopus et `prompts/` dans l'image de l'API | Tâches 11 et 12 (essai de fumée) |
| Plafond de ffmpeg simultanés | Tâche 4 |
| Coquille statique, repli `index.html` hors `/api` | Tâche 11 (Caddyfile) ; essai de fumée ; étape B9 |
| En-têtes de cache, type du manifeste | Tâche 11 ; essai de fumée ; étape B9 |
| `Cache-Control: no-store` sur `/api` | Tâches 2 et 11 ; essai de fumée |
| CSP avec empreinte, `style` d'`app.html` | Tâche 9 (e2e sous CSP) ; essai de fumée ; étape B9 |
| `Permissions-Policy: microphone=(self)`, `Referrer-Policy`, `nosniff` | Tâches 9 et 11 ; étape B9 |
| HTTPS, cookie `Secure`, même origine | Étapes B8, B10, B11 |
| Corps ≥ 30 Mo, délais ≥ délai d'envoi de la PWA | Tâches 1, 11, 13 ; étape B10 |
| Essai sur un vrai Android 12+ | Étapes B11, C7, E1 |
| Réseaux, sortie limitée par domaine | Tâches 5, 11, 12 ; étape B7 |
| Sondes de supervision | Tâches 2 et 7 ; étapes B12, C6, C8 |
| Rotation de l'audio | Reportée au lot 2 (choix tranchés) ; alerte à 30 Go (tâche 7) |
| Comptes L et Franck | Tâche 3 (`lier-chat`) ; étape C1 |
| Données du banc d'essai | Tâche 8 ; étapes C4, D2 |
| Retrait du banc d'essai | Étapes D1 à D3 |
| Retour arrière | Colonne « Retour arrière » de chaque étape ; `docs/exploitation.md` |

## Hors de ce plan

- **Si la porte A3 échoue** (un projet non facturé affiche « payé ») : la mise en service s'arrête. Un plan
  complémentaire remplace le contrôle par l'API Cloud Billing (`projects.getBillingInfo`, compte de service en
  lecture seule, sortie ouverte vers `cloudbilling.googleapis.com` et `oauth2.googleapis.com`).
- Rotation de l'audio et scheduler : lot 2.
- FCM et Google Agenda dans la liste de sortie : avec leurs lots.
- Pare-feu de l'hôte limitant le port 7070 au seul NPM (question 10) : geste d'exploitation séparé, sur accord.
- Dettes différées des lots 1-A, 1-B1 et 1-B2 non citées ici (dossiers de revue, sections 6) : inchangées.
- Captures privées Telegram dont l'audio dépasse 20 Mio : la reprise reste sans plafond (dette 1-B1, T6).
- Sauvegarde automatique : lot 2 (décision 11).

## Questions pour Franck

1. **Importer les captures du banc d'essai** dans l'application (étape C4) ? Recommandé : oui. Elles sont reclassées par le prompt final et L retrouve ses actions du lot 0. Elles ne vont jamais dans le dépôt.
2. **Fenêtre de bascule** : quel moment, quand L capture peu (moins de 30 minutes, phase C) ? Qui prévient L, et faut-il la prévenir avant ?
3. **Nginx Proxy Manager** : tu crées toi-même les deux hôtes (étape B8) ? Quelle est l'IP du conteneur 101 vue par la VM (`NPM_IP`) ? Les deux sous-domaines existent-ils déjà en DNS ?
4. **GHCR privé ou public ?** Le cahier dit privé : il faut alors un jeton `read:packages` sur la VM et dans Dockge (étape B3). Recommandé : public. Le code est déjà public et les images ne contiennent aucun secret. Ce choix modifie la ligne « Chaîne de livraison » du cahier.
5. **Porte `serviceTier`** : autorises-tu un seul appel de contrôle (texte fixe « ok ») sur un projet jetable **sans facturation** (étape A3) ? Le cahier veut la facturation « avant le premier test, y compris avec des énoncés fabriqués ». Sans cet essai, la porte ne se vérifie qu'en remplaçant le contrôle par l'API Cloud Billing.
6. **Comptes** : noms de connexion de L et le tien ; qui choisit et tape le mot de passe de L ?
7. **Uptime Kuma** : existe-t-il déjà ? Par quel canal t'alerte-t-il ? Le jeton du bot Organizer ne doit pas y être copié.
8. **Volume du banc d'essai** : l'archiver ? Le supprimer, et quand ? La relecture du corpus (`tools/relecture`) en dépend.
9. **Rotation de l'audio reportée au lot 2**, avec une alerte à 30 Go : d'accord ?
10. **Pare-feu** : limiter le port 7070 de la VM au seul NPM (règle `DOCKER-USER` sur l'hôte partagé) ? Sans elle, le réseau local joint Caddy directement. X-Forwarded-For n'est cru que du NPM et le webhook exige son secret.
11. **Dockge** : préfères-tu déployer depuis l'interface de Dockge ou par les commandes `docker compose` en SSH de ce plan ? Les deux pilotent la même stack.
