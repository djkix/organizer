# Lot 1-D — Reconnexion par empreinte digitale (WebAuthn) : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quand sa session a expiré ou qu'elle s'est déconnectée, L rentre dans Organizer en posant le doigt sur son téléphone au lieu de taper son mot de passe ; l'enregistreur privé, son raccourci et sa file hors ligne ne voient aucune différence, et le mot de passe reste toujours possible.

**Architecture:** L'API gagne un service `EmpreintesService` (cérémonies WebAuthn avec `@simplewebauthn/server`), un magasin de défis à usage unique dans Valkey (`GETDEL`, 120 s), une table Prisma `cle_acces` et un contrôleur qui ouvre **la même session** que le mot de passe (même cookie, 90 jours). La PWA gagne un module `src/lib/empreinte.ts` (logique testée, cérémonies injectées), un câblage `@simplewebauthn/browser`, un bouton sur l'écran de connexion (seulement si ce téléphone a une clé) et une section Réglages (activer, lister, retirer). La CLI retire toutes les clés d'un compte (téléphone perdu). Les tests passent par un authentificateur logiciel (vraies signatures ES256, vraie bibliothèque) côté API, et par l'authentificateur virtuel de Chromium (CDP `WebAuthn.addVirtualAuthenticator`) côté e2e.

**Tech Stack:** `@simplewebauthn/server` 14.0.3 et `@simplewebauthn/browser` 14.0.0 (versions du registre npm au 5 octobre 2026, épinglées par le verrou pnpm), NestJS 11, Prisma 6, ioredis 5 sur Valkey 8, SvelteKit 2 (Svelte 5), Vitest 3, Playwright 1.63 (Chromium).

**Spec:** `docs/cahier-des-charges.md` (Authentification, Exposition et surface d'attaque, Le bouton privé, Trajectoire de livraison), `docs/decisions.md` (décisions 2, 13, 14, 16, 22 et la future 23), `CLAUDE.md` (« La contrainte qui prime sur tout », règles produit 3, 4, 7, conventions, dépôt public), `docs/exploitation.md` (Mettre à jour, Publier une version, Revenir à la version précédente), décision de Franck du 4 octobre 2026 citée en tâche 1.

**Suite :** lot 2 (rappels et fils), inchangé.

## Global Constraints

- Contrainte qui prime : « Toute fonctionnalité qui ajoute une étape avant l'enregistrement est un échec, quelle que soit sa valeur par ailleurs. » Aucune invite biométrique ne précède jamais un enregistrement ; aucune invite ne s'ouvre d'elle-même, seulement sur appui d'un bouton.
- Périmètre : l'empreinte **remplace seulement la saisie du mot de passe à la reconnexion** (session expirée ou déconnexion). Le formulaire nom et mot de passe reste affiché et fonctionne **toujours**.
- Cible : « Chrome Android 120 et plus, Android 12 et plus. Aucun développement ni test iOS. » Clés d'accès par Credential Manager Android (gestionnaire de mots de passe Google ou autre fournisseur choisi sur le téléphone).
- Authentification existante, inchangée : « Identifiant et mot de passe, haché en Argon2id » ; « Jeton en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, durée 90 jours » ; « 60 requêtes par minute et par IP sur l'API, 10 sur l'authentification ». La connexion par empreinte pose **exactement** le même cookie (`cookieSession`, `organizer_session`, `Max-Age=7776000`).
- « Aucune inscription libre : les comptes sont créés en ligne de commande par l'administrateur. » L'empreinte ne crée jamais de compte ; elle s'active seulement depuis une session ouverte.
- WebAuthn : identifiant de RP et origine lus dans la configuration (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`) ; production : `organizer.djkix.ovh` et `https://organizer.djkix.ovh` (décision 14) ; hors production : `localhost` et `http://localhost:5173`. Origine comparée à l'identique. Vérification de l'utilisateur **exigée** (`userVerification: 'required'`, `requireUserVerification: true`), attestation `none`, clé découvrable exigée (`residentKey: 'required'`), authentificateur de plateforme, algorithmes ES256 puis RS256.
- Défis : aléatoires (bibliothèque), à usage unique (lus et effacés d'un coup par `GETDEL`), durée de vie 120 s, séparés par cérémonie (`inscription`, `connexion`), liés au compte pour l'inscription. Valkey muet au-delà de 3 s : échec rapide (500), jamais d'attente sans fin.
- Compteur de signature : gardé et mis à jour ; un compteur qui recule ou stagne au-dessus de zéro est refusé (règle de la bibliothèque) ; un compteur toujours nul (clés Android synchronisées) est accepté.
- Bibliothèques : `@simplewebauthn/server@^14.0.3` (API, et devDependency de `apps/web` pour l'e2e) et `@simplewebauthn/browser@^14.0.0` (PWA). Aucune autre dépendance nouvelle.
- Base : migration **additive** générée par `prisma migrate diff` (aucune base touchée), appliquée par `migrate deploy`. **Aucun `migrate reset`, aucun `migrate dev`** sur aucune base. Les tests appliquent les migrations par `pnpm --filter @organizer/db migrate:test` (`migrate deploy`). Tunnel de dev ouvert pour les tests (`infra/dev/tunnel.sh`).
- TypeScript strict, aucun `any` implicite. Dans `apps/web/src/lib/**/*.ts` testés : imports relatifs suffixés `.js`, jamais `$app/*`, `$lib/*` ni `virtual:*` ; types partagés par `@organizer/shared/api`, jamais `@organizer/shared`. Seuls `client.ts`, `prive/demarrage.ts` et le nouveau `empreinte-navigateur.ts` câblent sans test unitaire.
- Messages : « en français, tutoiement, phrases de moins de 12 mots », tous dans `apps/web/src/lib/messages.ts` (et côté API, les seuls 401 et 429 sont affichés tels quels). Ni « ! » ni « % ». Règle 3 : aucun compteur, aucune culpabilisation. Règle 4 : « Aucun rouge dans l'interface. Ni retard, ni urgence, ni suppression. » « Retirer » est un bouton `lien` ordinaire. Règle 7 : aucun emoji, aucune illustration. Couleurs : tokens seulement.
- « Le système ne sollicite jamais de lui-même » : aucune suggestion d'activer l'empreinte après une connexion ; seulement le bouton de Réglages.
- En-têtes : CSP stricte **inchangée** (`default-src 'none'`, `connect-src 'self'`…) ; `Permissions-Policy` étendue explicitement à `publickey-credentials-create=(self), publickey-credentials-get=(self)`, identique dans `apps/web/scripts/entetes.mjs` et `infra/caddy/Caddyfile`.
- « Aucun contenu en clair dans les journaux » : les refus WebAuthn journalisent le message technique de la bibliothèque (origine, type, compteur), jamais un corps de requête.
- Dépôt public : aucun secret, aucun prénom réel (comptes de test `l`, `f`, `test`), aucune capture réelle. Le domaine `organizer.djkix.ovh` est déjà public (décision 14).
- Chaque commit met à jour `CHANGELOG.md` (rubrique sous « Non publié »), dans le même commit. Sujet en français, 3e personne (« Ajoute… », « Avance… »), puis une ligne vide, puis exactement `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (les commandes l'écrivent par un second `-m`). Rien n'est poussé sans l'accord de Franck.
- La CI reste verte : `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e Playwright, budget du bundle (150 Ko compressés), construction des images, Trivy (critiques corrigeables bloquantes), essai de fumée `infra/image/essai.sh`.

## Review Focus

1. **Session expirée, empreinte active, L appuie sur le raccourci privé** : l'enregistreur s'ouvre et enregistre sans aucune invite ; la capture attend dans la file ; l'écran de connexion propose l'empreinte, et la capture part juste après. Test : tâche 11 (e2e « session expirée, empreinte active : le raccourci privé enregistre sans invite »), qui compte les appels à `navigator.credentials.create/get`.
2. **L ferme la feuille d'empreinte, ou le téléphone n'a plus la clé** (`NotAllowedError`, clé retirée côté serveur) : un message calme, le formulaire de mot de passe reste utilisable. Tests : tâche 9 (`messageEmpreinte`, annulation), tâche 11 (e2e « une empreinte refusée se dit calmement ; le mot de passe reste là »).
3. **Valkey lent ou arrêté** : l'empreinte échoue en 3 s au plus avec « Le serveur ne répond pas. », jamais une acceptation silencieuse ; la connexion par mot de passe marche toujours. Tests : tâche 4 (`DelaiDepasse`), tâche 5 (l'erreur remonte), tâche 7 (500 sur l'empreinte, 204 sur le mot de passe).
4. **Réponse rejouée, défi expiré ou d'un autre compte ou de l'autre cérémonie, compteur qui recule, origine voisine** (`https://organizer.djkix.ovh.exemple.net`, `http://`) : refus, aucune clé gardée, aucune session ouverte. Tests : tâches 5 et 6.
5. **Stockage local indisponible ou effacé** (données du site vidées, `localStorage` qui lève) : pas de bouton d'empreinte, rien ne casse ; Réglages repropose « Activer l'empreinte », et une clé déjà présente sur ce téléphone est dite « déjà active » au lieu d'être dupliquée. Tests : tâche 9 (`memoLocal` qui lève), tâche 5 (`excludeCredentials`).

## Arbitrages du plan

Points que la décision 23 et le cahier ne tranchent pas, arrêtés ici (à rouvrir avec Franck si besoin) :

- **Défis dans Valkey, pas en base** : durée de vie courte (`PX 120000`), usage unique atomique par `GETDEL`, aucune table à purger. Un redémarrage de Valkey perd au pire un défi en cours (L réappuie). Clé `organizer:defi:<cérémonie>:<défi>`, distincte des clés `bull:` de BullMQ.
- **Défi retrouvé par le `clientDataJSON`**, pas par un cookie : la bibliothèque passe le défi reçu à une fonction qui le lit et l'efface ; sans entrée valide, refus.
- **Bouton plutôt que médiation conditionnelle** : un seul bouton « Me connecter avec l'empreinte », clés découvrables (aucun nom à saisir). Pas d'autoremplissage `mediation: 'conditional'` dans ce lot (une demande en attente à chaque ouverture de l'écran, à annuler avant le bouton : complexité sans gain pour deux comptes).
- **Le bouton n'apparaît que si ce téléphone a une clé** : la PWA retient en `localStorage` (`organizer.empreinte`) l'identifiant WebAuthn public de la clé de ce téléphone, posé à l'activation et à chaque connexion par empreinte, effacé au retrait de cette clé ou quand Réglages constate qu'elle n'existe plus. Ce n'est ni un secret ni une donnée personnelle ; sans lui, seul le mot de passe s'affiche.
- **Jamais d'invite automatique**, même à l'arrivée sur l'écran de connexion : cet écran porte le bouton privé, une feuille système ouverte d'office se mettrait devant.
- **Activation sans ressaisie du mot de passe** : la session ouverte suffit (cookie `HttpOnly`, `SameSite=Lax`, CSP stricte). La liste des clés est visible dans Réglages, et la CLI les retire. Voir questions ouvertes.
- **Dix clés par compte au plus** (409) : borne de sécurité, largement au-dessus de l'usage.
- **Identifiant WebAuthn du compte** (`user.id`) : l'UUID du compte en UTF-8, rien de nominatif ; `user.name` et `user.displayName` : le nom du compte (celui que le téléphone affiche dans sa feuille).
- **Le compte renvoyé par le téléphone (`userHandle`) est exigé** et doit être celui de la clé.
- **Changer le mot de passe ne retire pas les clés** ; la commande `retirer-empreintes <nom>` retire toutes les clés **et** ferme toutes les sessions du compte (téléphone perdu). Retirer une clé depuis Réglages ne ferme aucune session.
- **Limitation de débit** : 10 essais par minute et par IP, dans un limiteur propre au contrôleur des empreintes, sur les quatre routes `POST` (options et vérification, connexion et activation) ; le mot de passe garde son propre limiteur à 10.
- **`Permissions-Policy` explicite** : les deux directives WebAuthn valent `self` par défaut ; on les écrit pour figer l'intention et la tester. La CSP ne régit pas WebAuthn : aucune directive à ajouter.
- **e2e par `localhost`** : WebAuthn refuse une adresse IP comme identifiant de RP ; les tests d'empreinte ouvrent la PWA par `http://localhost:4173` (contexte sécurisé), le reste des e2e ne change pas.
- **Le libellé d'une clé** est « Ce téléphone » ou « Un autre appareil », suivi de « Ajoutée le mardi 6 octobre » ; aucune lecture du user-agent ni de l'AAGUID.
- **Retour arrière depuis 1.1.0** : la migration n'ajoute qu'une table ; la procédure documentée (restauration de la copie) reste la voie sûre.

## Questions ouvertes pour Franck

1. Faut-il redemander le mot de passe avant « Activer l'empreinte » ? Le plan dit non (session suffit). Oui ajouterait un champ et une route.
2. Les clés d'accès du gestionnaire Google se synchronisent sur les autres Android du même compte Google de L : une connexion par empreinte y devient possible. Le plan l'accepte (Android seulement, empreinte exigée) ; à confirmer avec L.

---

## Structure des fichiers

```
docs/decisions.md, docs/cahier-des-charges.md, CLAUDE.md, README.md   décision 23 (tâche 1)
packages/db/prisma/schema.prisma                   + modèle CleAcces, relation Utilisateur.clesAcces
packages/db/prisma/migrations/20261005120000_cles_acces/migration.sql   table cle_acces (générée)
packages/db/src/test.ts                            + cle_acces dans le TRUNCATE
packages/db/test/cle-acces.test.ts                 contraintes de la table
packages/shared/src/api.ts                         + ResumeEmpreinte
apps/api/src/auth/empreintes/config.ts             lireConfigWebauthn (RP, origine)
apps/api/src/auth/empreintes/defis.ts              MagasinDefis, MagasinDefisValkey, DelaiDepasse
apps/api/src/auth/empreintes/empreintes.service.ts EmpreintesService, TropDeCles, retirerEmpreintes
apps/api/src/auth/empreintes/schemas.ts            formes des réponses du navigateur (Zod)
apps/api/src/auth/empreintes/empreintes.controller.ts   routes /api/session/empreinte*, /api/empreintes*
apps/api/src/auth/auth.service.ts                  + ouvrirSessionPour
apps/api/src/config.ts, app.module.ts, jetons.ts, cli.ts   câblage, commande retirer-empreintes
apps/api/test/aides-webauthn.ts                    authentificateur logiciel, magasin en mémoire, CONFIG_ESSAI
apps/api/test/webauthn-config.test.ts, defis.test.ts, empreintes.test.ts, empreintes-http.test.ts
apps/web/src/lib/api.ts                            + six méthodes d'empreinte
apps/web/src/lib/empreinte.ts                      Ceremonies, memoLocal, messageEmpreinte, connecter/activer/retirer
apps/web/src/lib/empreinte-navigateur.ts           câblage @simplewebauthn/browser (sans test unitaire)
apps/web/src/lib/messages.ts, format.ts            textes, ajouteeLe
apps/web/src/routes/connexion/+page.svelte         bouton « Me connecter avec l'empreinte »
apps/web/src/routes/reglages/+page.svelte          section Empreinte
apps/web/scripts/entetes.mjs, infra/caddy/Caddyfile   Permissions-Policy
apps/web/e2e/webauthn.ts, e2e/empreinte.spec.ts    authentificateur virtuel, serveur simulé, scénarios
infra/docker-compose.yml, infra/.env.example, infra/image/essai.sh, infra/test/*.test.ts   DOMAINE_APP
.env.example, docs/exploitation.md, CHANGELOG.md
```

---

### Task 1: Décision 23 — l'empreinte avancée au lot 1-D

**Files:**
- Modify: `docs/decisions.md`, `docs/cahier-des-charges.md` (tableau des décisions, Authentification, Trajectoire de livraison, Lot 3), `CLAUDE.md`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: rien.
- Produces: la décision 23, citée par toutes les tâches suivantes.

- [ ] **Step 1: Vérifier la cohérence de départ**

Run: `grep -n "WebAuthn\|22 décisions\|| 22 |" CLAUDE.md README.md docs/decisions.md docs/cahier-des-charges.md`
Expected: `CLAUDE.md:28` et `README.md:289` citent « 22 décisions » ; le cahier cite WebAuthn aux lignes 690 (« au lot 3 ») et 909 (liste du lot 3) ; la décision 22 existe dans les deux tableaux. Toute autre mention est à traiter dans cette tâche.

- [ ] **Step 2: Ajouter la décision 23 à `docs/decisions.md`**

Après la ligne de la décision 22, ajouter :
```markdown
| 23 | Empreinte digitale | Avancée du lot 3 à un lot 1-D, livré juste après la mise en service. WebAuthn (clé d'accès Android) pour la reconnexion seulement ; le mot de passe reste toujours possible |
```

- [ ] **Step 3: Répercuter dans `docs/cahier-des-charges.md`**

1. Tableau « Décisions arrêtées », après la ligne 22 :
```markdown
| 23 | Empreinte digitale | **Avancée du lot 3 à un lot 1-D**, livré juste après la mise en service, décidé par Franck le 4 octobre 2026. WebAuthn (clé d'accès, Credential Manager Android) remplace seulement la saisie du mot de passe à la reconnexion ; le mot de passe reste toujours possible, et aucune invite biométrique ne précède jamais un enregistrement |
```
2. Tableau « Authentification », remplacer la ligne Reconnexion par :
```markdown
| Reconnexion | Empreinte digitale via WebAuthn et Credential Manager Android, au lot 1-D (décision 23). Le mot de passe reste toujours possible ; aucune invite ne précède un enregistrement |
```
3. « Trajectoire de livraison », premier paragraphe : après « Quatre lots. », insérer « Le lot 1-D, avancé du lot 3 (décision 23), s'intercale entre les lots 1 et 2. »
4. Après la section « Lot 1 — Capture et tri (MVP) » (après son « Critère de sortie »), insérer :
```markdown
### Lot 1-D — Reconnexion par empreinte

Avancé du lot 3 (décision 23), livré juste après la mise en service, en version 1.1.0.

- Activation de l'empreinte depuis Réglages, liste et retrait de ses clés.
- Bouton « Me connecter avec l'empreinte » sur l'écran de connexion, sans nom à saisir.
- Le mot de passe reste toujours possible ; l'enregistreur privé et sa file ne demandent jamais l'empreinte.
- Retrait de toutes les clés d'un compte en ligne de commande, pour un téléphone perdu.

Critère de sortie : L se reconnecte par l'empreinte sur son téléphone, et le raccourci privé enregistre toujours sans invite.
```
5. « Lot 3 — Confort » : supprimer la ligne `- WebAuthn pour la reconnexion par empreinte.`

- [ ] **Step 4: Répercuter dans `CLAUDE.md` et `README.md`**

- `CLAUDE.md` : « 22 décisions fermées » devient « 23 décisions fermées ». À la fin de « État du projet », ajouter le paragraphe :
```markdown
Lot 1-D (décision 23, 4 octobre 2026) : reconnexion par empreinte digitale (WebAuthn), avancée du lot 3,
livrée juste après la mise en service. Le mot de passe reste toujours possible ; aucune invite biométrique
ne précède un enregistrement. Plan : `docs/superpowers/plans/2026-10-05-lot1-d-empreinte.md`.
```
- `README.md:289` : « les 22 décisions fermées » devient « les 23 décisions fermées ».

- [ ] **Step 5: Vérifier la cohérence d'arrivée**

Run: `grep -n "WebAuthn\|décisions fermées\|| 23 |" CLAUDE.md README.md docs/decisions.md docs/cahier-des-charges.md`
Expected: « 23 décisions fermées » dans CLAUDE.md et README ; la ligne 23 dans les deux tableaux ; WebAuthn seulement dans la décision 23, la ligne Reconnexion (« au lot 1-D ») et la section Lot 1-D ; plus aucune mention au lot 3.

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Modifié : « L'empreinte digitale (WebAuthn) est avancée du lot 3 à un lot 1-D, livré juste après la mise en service (décision 23, 2026-10-05) ; cahier, CLAUDE.md et README alignés. »
```bash
git add docs/decisions.md docs/cahier-des-charges.md CLAUDE.md README.md CHANGELOG.md
git commit -m "Avance l'empreinte digitale au lot 1-D (décision 23)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Table des clés d'accès

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/test.ts`, `CHANGELOG.md`
- Create (généré) : `packages/db/prisma/migrations/20261005120000_cles_acces/migration.sql`
- Test: `packages/db/test/cle-acces.test.ts`

**Interfaces:**
- Consumes: modèle `Utilisateur` existant.
- Produces (Prisma) : `prisma.cleAcces` — `{ id: string (uuid), identifiant: string (unique, identifiant WebAuthn en base64url), utilisateurId: string, clePublique: Uint8Array (COSE), compteur: bigint (défaut 0n), transports: string[], sauvegardee: boolean, creeLe: Date, utiliseeLe: Date | null }` ; `utilisateur.clesAcces`.

- [ ] **Step 1: Écrire le test**

`packages/db/test/cle-acces.test.ts` :
```ts
import { afterAll, beforeEach, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

it('une clé disparaît avec son compte ; son identifiant WebAuthn est unique', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const data = { identifiant: 'AAAA', utilisateurId: u.id, clePublique: new Uint8Array([1, 2, 3]) };
  const c = await prisma.cleAcces.create({ data });
  expect(c).toMatchObject({ compteur: 0n, transports: [], sauvegardee: false, utiliseeLe: null });
  expect(Array.from(c.clePublique)).toEqual([1, 2, 3]);
  await expect(prisma.cleAcces.create({ data })).rejects.toThrow();
  await prisma.utilisateur.delete({ where: { id: u.id } });
  expect(await prisma.cleAcces.count()).toBe(0);
});

it('le compteur tient sur 32 bits non signés', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const c = await prisma.cleAcces.create({
    data: { identifiant: 'BBBB', utilisateurId: u.id, clePublique: new Uint8Array([1]), compteur: 4_294_967_295n },
  });
  expect(c.compteur).toBe(4_294_967_295n);
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run packages/db/test/cle-acces.test.ts`
Expected: FAIL à la compilation, `cleAcces` n'existe pas sur `PrismaClient`.

- [ ] **Step 3: Étendre le schéma**

Dans `packages/db/prisma/schema.prisma`, `model Utilisateur`, après `sessions        Session[]` :
```prisma
  clesAcces       CleAcces[]
```
Après `model Session { … }`, ajouter :
```prisma
/// Clé d'accès WebAuthn (empreinte) d'un compte. La clé privée ne quitte jamais le téléphone.
model CleAcces {
  id            String      @id @default(uuid()) @db.Uuid
  /// Identifiant WebAuthn de la clé (base64url), public.
  identifiant   String      @unique
  utilisateurId String      @map("utilisateur_id") @db.Uuid
  /// Clé publique au format COSE.
  clePublique   Bytes       @map("cle_publique")
  compteur      BigInt      @default(0)
  transports    String[]
  sauvegardee   Boolean     @default(false)
  creeLe        DateTime    @default(now()) @map("cree_le")
  utiliseeLe    DateTime?   @map("utilisee_le")
  utilisateur   Utilisateur @relation(fields: [utilisateurId], references: [id], onDelete: Cascade)

  @@index([utilisateurId])
  @@map("cle_acces")
}
```
Dans `packages/db/src/test.ts`, la liste du `TRUNCATE` devient :
`'TRUNCATE cle_acces, session, correction, action, pensee, item, theme, capture, code_liaison, utilisateur CASCADE'`

- [ ] **Step 4: Générer la migration sans toucher aucune base**

```bash
git show HEAD:packages/db/prisma/schema.prisma > /tmp/schema-avant.prisma
mkdir -p packages/db/prisma/migrations/20261005120000_cles_acces
cd packages/db && DATABASE_URL=postgresql://inutilise@127.0.0.1:1/inutilise node node_modules/prisma/build/index.js migrate diff \
  --from-schema-datamodel /tmp/schema-avant.prisma --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/20261005120000_cles_acces/migration.sql && cd ../..
pnpm prisma generate
```
Expected: `migration.sql` contient exactement :
```sql
-- CreateTable
CREATE TABLE "cle_acces" (
    "id" UUID NOT NULL,
    "identifiant" TEXT NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "cle_publique" BYTEA NOT NULL,
    "compteur" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "sauvegardee" BOOLEAN NOT NULL DEFAULT false,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisee_le" TIMESTAMP(3),

    CONSTRAINT "cle_acces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cle_acces_identifiant_key" ON "cle_acces"("identifiant");

-- CreateIndex
CREATE INDEX "cle_acces_utilisateur_id_idx" ON "cle_acces"("utilisateur_id");

-- AddForeignKey
ALTER TABLE "cle_acces" ADD CONSTRAINT "cle_acces_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
Si Prisma produit autre chose (ordre des colonnes, type), garder sa sortie, mais elle ne doit contenir **que** des `CREATE` et l'`ALTER TABLE … ADD CONSTRAINT` : aucun `DROP`, aucun `ALTER` d'une table existante. Sinon, s'arrêter et signaler.

- [ ] **Step 5: Appliquer par `migrate deploy` et lancer les tests**

Run (tunnel ouvert) : `pnpm --filter @organizer/db migrate:test && pnpm vitest run packages/db`
Expected: « 1 migration found … applied » sur `organizer_test`, puis PASS.

Run: `pnpm db migrate deploy && pnpm db migrate status`
Expected: la base de dev `organizer` reçoit la migration ; « Database schema is up to date ».

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La table des clés d'accès WebAuthn (identifiant, clé publique, compteur, transports), effacée avec le compte (2026-10-05). »
```bash
git add packages/db CHANGELOG.md
git commit -m "Ajoute la table des clés d'accès de l'empreinte" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Configuration WebAuthn (identifiant de RP et origine)

**Files:**
- Create: `apps/api/src/auth/empreintes/config.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/test/telegram.controller.test.ts:11-16`, `.env.example`, `CHANGELOG.md`
- Test: `apps/api/test/webauthn-config.test.ts`

**Interfaces:**
- Consumes: `lireVar(nom, env)` de `@organizer/shared`.
- Produces: `interface ConfigWebauthn { rpId: string; origine: string; nomRp: string }`, `lireConfigWebauthn(env?: NodeJS.ProcessEnv): ConfigWebauthn`, champ `ConfigApi.webauthn: ConfigWebauthn`.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/webauthn-config.test.ts` :
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lireConfigWebauthn } from '../src/auth/empreintes/config.js';
import { lireConfigApi } from '../src/config.js';

afterEach(() => { vi.unstubAllEnvs(); });

const PROD = { NODE_ENV: 'production', WEBAUTHN_RP_ID: 'organizer.djkix.ovh' };

describe('lireConfigWebauthn', () => {
  it('hors production : localhost et le serveur de dev', () => {
    expect(lireConfigWebauthn({ NODE_ENV: 'test' })).toEqual({ rpId: 'localhost', origine: 'http://localhost:5173', nomRp: 'Organizer' });
  });

  it('en production, domaine et origine sont obligatoires', () => {
    expect(() => lireConfigWebauthn({ NODE_ENV: 'production' })).toThrow('WEBAUTHN_RP_ID et WEBAUTHN_ORIGIN obligatoires en production');
  });

  it('en production : le domaine de la PWA, en https', () => {
    expect(lireConfigWebauthn({ ...PROD, WEBAUTHN_ORIGIN: 'https://organizer.djkix.ovh' }))
      .toEqual({ rpId: 'organizer.djkix.ovh', origine: 'https://organizer.djkix.ovh', nomRp: 'Organizer' });
  });

  it.each([
    ['https://organizer.djkix.ovh/', 'origine seule'],
    ['https://autre.djkix.ovh', 'ne correspond pas'],
    ['http://organizer.djkix.ovh', 'https'],
    ['pas une adresse', 'illisible'],
  ])('refuse l\'origine %s', (origine, motif) => {
    expect(() => lireConfigWebauthn({ ...PROD, WEBAUTHN_ORIGIN: origine })).toThrow(motif);
  });

  it('la configuration de l\'API la porte', () => {
    vi.stubEnv('TELEGRAM_MODE', 'polling');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '0:test');
    vi.stubEnv('AUDIO_STORAGE_PATH', './data/audio');
    expect(lireConfigApi().webauthn.rpId).toBe('localhost');
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/webauthn-config.test.ts`
Expected: FAIL, module `config.js` introuvable.

- [ ] **Step 3: Écrire la configuration**

`apps/api/src/auth/empreintes/config.ts` :
```ts
import { lireVar } from '@organizer/shared';

export interface ConfigWebauthn { rpId: string; origine: string; nomRp: string }

/**
 * Identifiant de RP (domaine de la PWA) et origine exacte attendue dans chaque réponse du téléphone.
 * Une clé d'accès est liée à son identifiant de RP : changer de domaine rend toutes les clés inutilisables.
 */
export function lireConfigWebauthn(env: NodeJS.ProcessEnv = process.env): ConfigWebauthn {
  const rpId = lireVar('WEBAUTHN_RP_ID', env);
  const origine = lireVar('WEBAUTHN_ORIGIN', env);
  if (env.NODE_ENV === 'production' && (!rpId || !origine)) {
    throw new Error('WEBAUTHN_RP_ID et WEBAUTHN_ORIGIN obligatoires en production : domaine de la PWA et https://<domaine>');
  }
  const config = { rpId: rpId ?? 'localhost', origine: origine ?? 'http://localhost:5173', nomRp: 'Organizer' };
  let url: URL;
  try {
    url = new URL(config.origine);
  } catch {
    throw new Error(`WEBAUTHN_ORIGIN illisible : ${config.origine}`);
  }
  if (url.origin !== config.origine) {
    throw new Error(`WEBAUTHN_ORIGIN doit être une origine seule, sans chemin ni barre finale : ${config.origine}`);
  }
  if (url.hostname !== config.rpId) {
    throw new Error(`WEBAUTHN_ORIGIN (${config.origine}) ne correspond pas à WEBAUTHN_RP_ID (${config.rpId})`);
  }
  if (url.protocol !== 'https:' && config.rpId !== 'localhost') {
    throw new Error('WEBAUTHN_ORIGIN doit être en https, sauf sur localhost');
  }
  return config;
}
```

Dans `apps/api/src/config.ts` : importer `import { lireConfigWebauthn, type ConfigWebauthn } from './auth/empreintes/config.js';`, ajouter à `ConfigApi` :
```ts
  /** Empreinte (WebAuthn) : identifiant de RP et origine de la PWA. */
  webauthn: ConfigWebauthn;
```
et, **en dernier** dans l'objet rendu par `lireConfigApi` (les erreurs existantes gardent leur ordre) :
```ts
    webauthn: lireConfigWebauthn(),
```

Dans `apps/api/test/telegram.controller.test.ts`, l'objet rendu par `config(mode)` gagne :
```ts
    webauthn: { rpId: 'localhost', origine: 'http://localhost:5173', nomRp: 'Organizer' },
```

Dans `.env.example` (racine), après `TRUSTED_PROXY=` :
```
# Empreinte (WebAuthn) : domaine de la PWA et son origine exacte. Obligatoires en production.
# Défaut ailleurs : localhost et le serveur de dev de la PWA
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:5173
```

- [ ] **Step 4: Lancer les tests et le typage**

Run: `pnpm vitest run apps/api/test/webauthn-config.test.ts apps/api/test/config.test.ts apps/api/test/telegram.controller.test.ts && pnpm --filter @organizer/api typecheck`
Expected: PASS, aucune erreur de typage.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La configuration de l'empreinte : identifiant de RP et origine exacte, obligatoires en production, vérifiés au démarrage (2026-10-05). »
```bash
git add apps/api .env.example CHANGELOG.md
git commit -m "Ajoute la configuration WebAuthn de l'API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Défis à usage unique dans Valkey

**Files:**
- Create: `apps/api/src/auth/empreintes/defis.ts`
- Test: `apps/api/test/defis.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: un client ioredis (`Redis`), structurellement compatible avec `ClientValkey`.
- Produces: `type TypeDefi = 'inscription' | 'connexion'`, `DUREE_DEFI_MS = 120_000`, `DELAI_VALKEY_MS = 3_000`, `interface MagasinDefis { poser(type, defi, valeur): Promise<void>; prendre(type, defi): Promise<string | null> }`, `class DelaiDepasse extends Error` (name `'DelaiDepasse'`), `interface ClientValkey`, `class MagasinDefisValkey(valkey: ClientValkey, delaiMs?: number)`.

- [ ] **Step 1: Écrire les tests (Valkey réel du tunnel, base 1)**

`apps/api/test/defis.test.ts` :
```ts
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { DelaiDepasse, MagasinDefisValkey } from '../src/auth/empreintes/defis.js';

const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
afterAll(() => { redis.disconnect(); });
const magasin = new MagasinDefisValkey(redis);

describe('MagasinDefisValkey', () => {
  it('un défi se lit une seule fois, et expire en 2 minutes', async () => {
    const defi = `essai-${randomUUID()}`;
    await magasin.poser('connexion', defi, 'x');
    const reste = await redis.pttl(`organizer:defi:connexion:${defi}`);
    expect(reste).toBeGreaterThan(110_000);
    expect(reste).toBeLessThanOrEqual(120_000);
    expect(await magasin.prendre('connexion', defi)).toBe('x');
    expect(await magasin.prendre('connexion', defi)).toBeNull();
  });

  it('un défi d\'inscription ne sert pas à la connexion', async () => {
    const defi = `essai-${randomUUID()}`;
    await magasin.poser('inscription', defi, 'compte');
    expect(await magasin.prendre('connexion', defi)).toBeNull();
    expect(await magasin.prendre('inscription', defi)).toBe('compte');
  });

  it('deux lectures simultanées : une seule obtient le défi', async () => {
    const defi = `essai-${randomUUID()}`;
    await magasin.poser('connexion', defi, 'x');
    const lus = await Promise.all([magasin.prendre('connexion', defi), magasin.prendre('connexion', defi)]);
    expect(lus.filter((v) => v === 'x')).toHaveLength(1);
  });

  it('Valkey muet : DelaiDepasse au bout du délai, jamais une attente sans fin', async () => {
    const muet = { set: () => new Promise<never>(() => {}), getdel: () => new Promise<never>(() => {}) };
    const m = new MagasinDefisValkey(muet, 50);
    await expect(m.prendre('connexion', 'x')).rejects.toBeInstanceOf(DelaiDepasse);
    await expect(m.poser('connexion', 'x', 'y')).rejects.toBeInstanceOf(DelaiDepasse);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/defis.test.ts`
Expected: FAIL, module `defis.js` introuvable.

- [ ] **Step 3: Écrire le magasin**

`apps/api/src/auth/empreintes/defis.ts` :
```ts
export type TypeDefi = 'inscription' | 'connexion';

/** Durée de vie d'un défi : l'invite du téléphone (60 s) plus la marge du réseau. */
export const DUREE_DEFI_MS = 120_000;
/** Au-delà, Valkey est tenu pour muet : l'empreinte échoue vite, le mot de passe reste. */
export const DELAI_VALKEY_MS = 3_000;

export interface MagasinDefis {
  poser(type: TypeDefi, defi: string, valeur: string): Promise<void>;
  /** Lit et efface d'un coup : un défi ne sert qu'une fois. Expiré ou inconnu : null. */
  prendre(type: TypeDefi, defi: string): Promise<string | null>;
}

export class DelaiDepasse extends Error {
  override name = 'DelaiDepasse';
  constructor() {
    super('Valkey ne répond pas.');
  }
}

/** Ce que le magasin demande à ioredis. */
export interface ClientValkey {
  set(cle: string, valeur: string, unite: 'PX', duree: number): Promise<unknown>;
  getdel(cle: string): Promise<string | null>;
}

const cle = (type: TypeDefi, defi: string): string => `organizer:defi:${type}:${defi}`;

function borner<T>(attente: Promise<T>, ms: number): Promise<T> {
  let minuteur: NodeJS.Timeout | undefined;
  const delai = new Promise<never>((_ok, non) => { minuteur = setTimeout(() => non(new DelaiDepasse()), ms); });
  return Promise.race([attente, delai]).finally(() => clearTimeout(minuteur));
}

/** Défis dans Valkey : expiration native, lecture et effacement atomiques (GETDEL). */
export class MagasinDefisValkey implements MagasinDefis {
  constructor(private readonly valkey: ClientValkey, private readonly delaiMs = DELAI_VALKEY_MS) {}

  async poser(type: TypeDefi, defi: string, valeur: string): Promise<void> {
    await borner(this.valkey.set(cle(type, defi), valeur, 'PX', DUREE_DEFI_MS), this.delaiMs);
  }

  prendre(type: TypeDefi, defi: string): Promise<string | null> {
    return borner(this.valkey.getdel(cle(type, defi)), this.delaiMs);
  }
}
```

- [ ] **Step 4: Lancer les tests et le typage**

Run: `pnpm vitest run apps/api/test/defis.test.ts && pnpm --filter @organizer/api typecheck`
Expected: PASS. Le typage confirme que `new MagasinDefisValkey(redis)` accepte le client ioredis.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les défis de l'empreinte dans Valkey : usage unique, deux minutes, échec en 3 s si Valkey ne répond pas (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute les défis à usage unique de l'empreinte" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Activer, lister et retirer une empreinte (service)

**Files:**
- Create: `apps/api/src/auth/empreintes/empreintes.service.ts`, `apps/api/test/aides-webauthn.ts`
- Modify: `apps/api/package.json` (dépendance), `pnpm-lock.yaml`, `packages/shared/src/api.ts`, `CHANGELOG.md`
- Test: `apps/api/test/empreintes.test.ts`

**Interfaces:**
- Consumes: `ConfigWebauthn` (tâche 3), `MagasinDefis`, `DelaiDepasse`, `DUREE_DEFI_MS`, `TypeDefi` (tâche 4), `prisma.cleAcces` (tâche 2).
- Produces:
  - `packages/shared/src/api.ts` : `interface ResumeEmpreinte { id: string; identifiant: string; creeLe: string; utiliseeLe: string | null }` (dates ISO).
  - `DELAI_CEREMONIE_MS = 60_000`, `MAX_CLES_PAR_COMPTE = 10`, `class TropDeCles extends Error`.
  - `class EmpreintesService(prisma, defis: MagasinDefis, config: ConfigWebauthn, maintenant?: () => Date, journal?: (m: string) => void)` avec `optionsInscription(u: { id: string; nom: string }): Promise<PublicKeyCredentialCreationOptionsJSON>`, `inscrire(u: { id: string }, reponse: RegistrationResponseJSON): Promise<ResumeEmpreinte | null>`, `lister(utilisateurId: string): Promise<ResumeEmpreinte[]>`, `retirer(utilisateurId: string, id: string): Promise<boolean>`.
  - Aides de test : `CONFIG_ESSAI`, `class MagasinDefisMemoire(maintenant?: () => number)`, `class AuthentificateurLogiciel(rpId, origine, compteurCroissant?)` avec `inscrire(options, falsif?)` et `authentifier(options, falsif?)`, `interface Falsification { origine?; rpId?; sansUv?; compteur?; userHandle?: string | null; type?; id? }`.

- [ ] **Step 1: Installer la bibliothèque et ajouter le type partagé**

Run: `pnpm --filter @organizer/api add @simplewebauthn/server@^14.0.3`
Expected: `apps/api/package.json` gagne `"@simplewebauthn/server": "^14.0.3"`, le verrou résout `14.0.3` (ou un correctif 14.0.x plus récent : le noter dans le commit).

Ajouter à `packages/shared/src/api.ts`, après `ReponseDepotPrive` :
```ts
/** Une clé d'accès (empreinte) d'un compte, telle que Réglages la liste. `identifiant` est public. */
export interface ResumeEmpreinte { id: string; identifiant: string; creeLe: string; utiliseeLe: string | null }
```

- [ ] **Step 2: Écrire les aides de test**

`apps/api/test/aides-webauthn.ts` :
```ts
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { ConfigWebauthn } from '../src/auth/empreintes/config.js';
import { DUREE_DEFI_MS, type MagasinDefis, type TypeDefi } from '../src/auth/empreintes/defis.js';

export const CONFIG_ESSAI: ConfigWebauthn = { rpId: 'organizer.djkix.ovh', origine: 'https://organizer.djkix.ovh', nomRp: 'Organizer' };

/** Magasin de défis en mémoire, à horloge réglable. Même contrat que Valkey : lu et effacé d'un coup. */
export class MagasinDefisMemoire implements MagasinDefis {
  private readonly defis = new Map<string, { valeur: string; expire: number }>();
  constructor(private readonly maintenant: () => number = Date.now) {}

  async poser(type: TypeDefi, defi: string, valeur: string): Promise<void> {
    this.defis.set(`${type}:${defi}`, { valeur, expire: this.maintenant() + DUREE_DEFI_MS });
  }

  async prendre(type: TypeDefi, defi: string): Promise<string | null> {
    const cle = `${type}:${defi}`;
    const d = this.defis.get(cle);
    this.defis.delete(cle);
    return d && d.expire > this.maintenant() ? d.valeur : null;
  }
}

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

function tete(majeur: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(majeur << 5) | n]);
  if (n < 0x100) return Buffer.from([(majeur << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(majeur << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (majeur << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

/** CBOR minimal et canonique (RFC 8949) : entiers, textes, octets, tableaux, tables. Assez pour une attestation « none ». */
export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (typeof v === 'string') {
    const t = Buffer.from(v, 'utf8');
    return Buffer.concat([tete(3, t.length), t]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([tete(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([tete(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const sha256 = (d: string | Uint8Array): Buffer => createHash('sha256').update(d).digest();
const b64u = (d: Uint8Array): string => Buffer.from(d).toString('base64url');
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

/** Ce qu'un test fausse dans la réponse du téléphone. `userHandle: null` retire le compte de la réponse. */
export interface Falsification {
  origine?: string; rpId?: string; sansUv?: boolean; compteur?: number; userHandle?: string | null; type?: string; id?: string;
}

interface Cle { prive: KeyObject; userHandle: string; compteur: number }

/**
 * Authentificateur WebAuthn logiciel : ES256, attestation « none », clés découvrables.
 * De vraies signatures, vérifiées par la vraie bibliothèque du serveur.
 */
export class AuthentificateurLogiciel {
  readonly cles = new Map<string, Cle>();

  constructor(private readonly rpId: string, private readonly origine: string, private readonly compteurCroissant = false) {}

  inscrire(o: PublicKeyCredentialCreationOptionsJSON, f: Falsification = {}): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = randomBytes(16);
    const cose = cbor(new Map<Cbor, Cbor>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
    ]));
    const drapeaux = UP | AT | (f.sansUv ? 0 : UV);
    const authData = Buffer.concat([
      sha256(f.rpId ?? this.rpId), Buffer.from([drapeaux]), u32(0), Buffer.alloc(16), Buffer.from([0, id.length]), id, cose,
    ]);
    const clientData = Buffer.from(JSON.stringify({
      type: f.type ?? 'webauthn.create', challenge: o.challenge, origin: f.origine ?? this.origine, crossOrigin: false,
    }));
    const attestation = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map<Cbor, Cbor>()], ['authData', authData]]));
    this.cles.set(b64u(id), { prive: privateKey, userHandle: o.user.id, compteur: 0 });
    return {
      id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestation), transports: ['internal'] },
    };
  }

  authentifier(o: PublicKeyCredentialRequestOptionsJSON, f: Falsification = {}): AuthenticationResponseJSON {
    const id = f.id ?? [...this.cles.keys()][0];
    const cle = id === undefined ? undefined : this.cles.get(id);
    if (id === undefined || !cle) throw new Error('aucune clé dans l\'authentificateur');
    if (this.compteurCroissant) cle.compteur++;
    const authData = Buffer.concat([
      sha256(f.rpId ?? this.rpId), Buffer.from([UP | (f.sansUv ? 0 : UV)]), u32(f.compteur ?? cle.compteur),
    ]);
    const clientData = Buffer.from(JSON.stringify({
      type: f.type ?? 'webauthn.get', challenge: o.challenge, origin: f.origine ?? this.origine, crossOrigin: false,
    }));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), cle.prive);
    const userHandle = f.userHandle === null ? undefined : (f.userHandle ?? cle.userHandle);
    return {
      id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature),
        ...(userHandle === undefined ? {} : { userHandle }),
      },
    };
  }
}
```

- [ ] **Step 3: Écrire les tests du service (inscription, liste, retrait)**

`apps/api/test/empreintes.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DelaiDepasse, type MagasinDefis } from '../src/auth/empreintes/defis.js';
import { EmpreintesService, MAX_CLES_PAR_COMPTE, TropDeCles } from '../src/auth/empreintes/empreintes.service.js';
import { AuthentificateurLogiciel, CONFIG_ESSAI, MagasinDefisMemoire } from './aides-webauthn.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

let horloge: number;
let journal: string[];
let defis: MagasinDefisMemoire;
let service: EmpreintesService;
let u: { id: string; nom: string };
const telephone = (croissant = false) => new AuthentificateurLogiciel(CONFIG_ESSAI.rpId, CONFIG_ESSAI.origine, croissant);

beforeEach(async () => {
  horloge = Date.parse('2026-10-06T08:00:00Z');
  journal = [];
  await viderBase(prisma);
  u = await prisma.utilisateur.create({ data: { nom: 'l' }, select: { id: true, nom: true } });
  defis = new MagasinDefisMemoire(() => horloge);
  service = new EmpreintesService(prisma, defis, CONFIG_ESSAI, () => new Date(horloge), (m) => { journal.push(m); });
});

describe('activer une empreinte', () => {
  it('options : RP configuré, clé découvrable, empreinte exigée, sans attestation, compte en UUID', async () => {
    const o = await service.optionsInscription(u);
    expect(o.rp).toEqual({ name: 'Organizer', id: 'organizer.djkix.ovh' });
    expect(Buffer.from(o.user.id, 'base64url').toString('utf8')).toBe(u.id);
    expect(o.user.name).toBe('l');
    expect(o.attestation).toBe('none');
    expect(o.timeout).toBe(60_000);
    expect(o.authenticatorSelection).toMatchObject({
      residentKey: 'required', requireResidentKey: true, userVerification: 'required', authenticatorAttachment: 'platform',
    });
    expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
  });

  it('garde la clé publique et le compte, compteur à zéro', async () => {
    const r = telephone().inscrire(await service.optionsInscription(u));
    expect(await service.inscrire(u, r)).toMatchObject({ identifiant: r.id, creeLe: '2026-10-06T08:00:00.000Z', utiliseeLe: null });
    const enBase = await prisma.cleAcces.findUniqueOrThrow({ where: { identifiant: r.id } });
    expect(enBase).toMatchObject({ utilisateurId: u.id, compteur: 0n, transports: ['internal'], sauvegardee: false });
    expect(enBase.clePublique.length).toBeGreaterThan(60);
  });

  it('les options suivantes excluent les clés déjà gardées : pas de doublon sur un téléphone', async () => {
    const r = telephone().inscrire(await service.optionsInscription(u));
    await service.inscrire(u, r);
    const o = await service.optionsInscription(u);
    expect(o.excludeCredentials?.map((c) => c.id)).toEqual([r.id]);
  });

  it('un défi ne sert qu\'une fois', async () => {
    const o = await service.optionsInscription(u);
    expect(await service.inscrire(u, telephone().inscrire(o))).not.toBeNull();
    expect(await service.inscrire(u, telephone().inscrire(o))).toBeNull();
  });

  it('le défi d\'un compte ne sert pas à un autre, et il est consommé', async () => {
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const r = telephone().inscrire(await service.optionsInscription(u));
    expect(await service.inscrire({ id: autre.id }, r)).toBeNull();
    expect(await service.inscrire(u, r)).toBeNull();
    expect(await prisma.cleAcces.count()).toBe(0);
  });

  it('un défi expire au bout de deux minutes', async () => {
    const o = await service.optionsInscription(u);
    horloge += 120_001;
    expect(await service.inscrire(u, telephone().inscrire(o))).toBeNull();
  });

  it.each([
    [{ origine: 'https://organizer.djkix.ovh.exemple.net' }],
    [{ origine: 'http://organizer.djkix.ovh' }],
    [{ rpId: 'exemple.net' }],
    [{ type: 'webauthn.get' }],
    [{ sansUv: true }],
  ])('refuse une réponse faussée (%o), sans rien garder, et le journalise', async (f) => {
    const r = telephone().inscrire(await service.optionsInscription(u), f);
    expect(await service.inscrire(u, r)).toBeNull();
    expect(await prisma.cleAcces.count()).toBe(0);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatch(/^Empreinte refusée \(inscription\) : /);
  });

  it(`${MAX_CLES_PAR_COMPTE} clés au plus par compte`, async () => {
    await prisma.cleAcces.createMany({
      data: Array.from({ length: MAX_CLES_PAR_COMPTE }, (_, i) => ({ identifiant: `cle-${i}`, utilisateurId: u.id, clePublique: new Uint8Array([1]) })),
    });
    await expect(service.optionsInscription(u)).rejects.toBeInstanceOf(TropDeCles);
  });

  it('Valkey muet : l\'erreur remonte, jamais une empreinte acceptée en silence', async () => {
    const o = await service.optionsInscription(u);
    const muet: MagasinDefis = { poser: async () => {}, prendre: () => Promise.reject(new DelaiDepasse()) };
    const s = new EmpreintesService(prisma, muet, CONFIG_ESSAI);
    await expect(s.inscrire(u, telephone().inscrire(o))).rejects.toBeInstanceOf(DelaiDepasse);
    expect(await prisma.cleAcces.count()).toBe(0);
  });
});

describe('lister et retirer', () => {
  it('chacun ne voit et ne retire que ses clés', async () => {
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const sienne = await prisma.cleAcces.create({ data: { identifiant: 'cle-autre', utilisateurId: autre.id, clePublique: new Uint8Array([1]) } });
    const r = telephone().inscrire(await service.optionsInscription(u));
    const cle = await service.inscrire(u, r);
    expect((await service.lister(u.id)).map((c) => c.identifiant)).toEqual([r.id]);
    expect(await service.retirer(u.id, sienne.id)).toBe(false);
    expect(await prisma.cleAcces.count()).toBe(2);
    expect(await service.retirer(u.id, cle!.id)).toBe(true);
    expect(await service.lister(u.id)).toEqual([]);
  });
});
```

- [ ] **Step 4: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/empreintes.test.ts`
Expected: FAIL, module `empreintes.service.js` introuvable.

- [ ] **Step 5: Écrire le service**

`apps/api/src/auth/empreintes/empreintes.service.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import type { ResumeEmpreinte } from '@organizer/shared/api';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { ConfigWebauthn } from './config.js';
import { DelaiDepasse, type MagasinDefis } from './defis.js';

/** Durée laissée au téléphone pour l'invite (options.timeout). Le défi vit deux fois plus. */
export const DELAI_CEREMONIE_MS = 60_000;
export const MAX_CLES_PAR_COMPTE = 10;
/** ES256 (toutes les clés Android), puis RS256. */
const ALGORITHMES = [-7, -257];

export class TropDeCles extends Error {
  override name = 'TropDeCles';
}

interface LigneCle { id: string; identifiant: string; creeLe: Date; utiliseeLe: Date | null }

const resume = (c: LigneCle): ResumeEmpreinte => ({
  id: c.id, identifiant: c.identifiant, creeLe: c.creeLe.toISOString(), utiliseeLe: c.utiliseeLe?.toISOString() ?? null,
});

/** Identifiant WebAuthn du compte (user.id) : l'UUID du compte en UTF-8, rien de nominatif. */
const handleDe = (utilisateurId: string): Uint8Array => new TextEncoder().encode(utilisateurId);

export class EmpreintesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly defis: MagasinDefis,
    private readonly config: ConfigWebauthn,
    private readonly maintenant: () => Date = () => new Date(),
    private readonly journal: (m: string) => void = (m) => { console.warn(m); },
  ) {}

  /** Vérification de la bibliothèque : un refus vaut null et se journalise (message technique, jamais de corps). */
  protected async verifier<T>(etape: string, verification: () => Promise<T>): Promise<T | null> {
    try {
      return await verification();
    } catch (err) {
      if (err instanceof DelaiDepasse) throw err;
      this.journal(`Empreinte refusée (${etape}) : ${(err as Error).message}`);
      return null;
    }
  }

  async optionsInscription(u: { id: string; nom: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const cles = await this.prisma.cleAcces.findMany({ where: { utilisateurId: u.id }, select: { identifiant: true, transports: true } });
    if (cles.length >= MAX_CLES_PAR_COMPTE) throw new TropDeCles();
    const options = await generateRegistrationOptions({
      rpName: this.config.nomRp,
      rpID: this.config.rpId,
      userName: u.nom,
      userDisplayName: u.nom,
      userID: handleDe(u.id),
      attestationType: 'none',
      timeout: DELAI_CEREMONIE_MS,
      supportedAlgorithmIDs: ALGORITHMES,
      excludeCredentials: cles.map((c) => ({ id: c.identifiant, transports: c.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    });
    await this.defis.poser('inscription', options.challenge, u.id);
    return options;
  }

  async inscrire(u: { id: string }, reponse: RegistrationResponseJSON): Promise<ResumeEmpreinte | null> {
    const v = await this.verifier('inscription', () => verifyRegistrationResponse({
      response: reponse,
      // Lu et effacé d'un coup : un défi ne sert qu'une fois, et seulement au compte qui l'a demandé.
      expectedChallenge: async (defi) => (await this.defis.prendre('inscription', defi)) === u.id,
      expectedOrigin: this.config.origine,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
    }));
    if (v === null || !v.verified) return null;
    const { credential, credentialBackedUp } = v.registrationInfo;
    try {
      const c = await this.prisma.cleAcces.create({
        data: {
          identifiant: credential.id, utilisateurId: u.id, clePublique: credential.publicKey,
          compteur: BigInt(credential.counter), transports: credential.transports ?? [], sauvegardee: credentialBackedUp,
        },
      });
      return resume(c);
    } catch (err) {
      // Même clé déjà gardée (identifiant unique) : refus, pas d'erreur interne.
      if ((err as { code?: string }).code === 'P2002') return null;
      throw err;
    }
  }

  async lister(utilisateurId: string): Promise<ResumeEmpreinte[]> {
    const cles = await this.prisma.cleAcces.findMany({ where: { utilisateurId }, orderBy: { creeLe: 'asc' } });
    return cles.map(resume);
  }

  /** Faux si la clé n'existe pas ou appartient à un autre compte. */
  async retirer(utilisateurId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.cleAcces.deleteMany({ where: { id, utilisateurId } });
    return count > 0;
  }
}
```

- [ ] **Step 6: Lancer les tests et le typage**

Run: `pnpm vitest run apps/api/test/empreintes.test.ts && pnpm --filter @organizer/api typecheck`
Expected: PASS (la bibliothèque vérifie réellement les attestations « none » de l'authentificateur logiciel). Si `verifyRegistrationResponse` signale « Leftover bytes », l'encodage CBOR de la clé COSE n'est pas canonique : comparer `cbor(...)` à `isoCBOR.encode` de `@simplewebauthn/server/helpers` sur la même table.

- [ ] **Step 7: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « L'activation d'une empreinte par WebAuthn (`@simplewebauthn/server` 14) : clé découvrable, empreinte exigée, sans attestation, défi lié au compte, dix clés au plus ; liste et retrait de ses clés (2026-10-05). »
```bash
git add apps/api packages/shared pnpm-lock.yaml CHANGELOG.md
git commit -m "Ajoute l'activation d'une empreinte dans l'API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Se reconnecter par l'empreinte (service)

**Files:**
- Modify: `apps/api/src/auth/empreintes/empreintes.service.ts`, `apps/api/src/auth/auth.service.ts`, `CHANGELOG.md`
- Test: `apps/api/test/empreintes.test.ts` (ajouts), `apps/api/test/auth.test.ts` (ajout)

**Interfaces:**
- Consumes: tâches 4 et 5 (`EmpreintesService`, aides de test).
- Produces: `EmpreintesService.optionsConnexion(): Promise<PublicKeyCredentialRequestOptionsJSON>`, `EmpreintesService.verifierConnexion(reponse: AuthenticationResponseJSON): Promise<string | null>` (id du compte), `AuthService.ouvrirSessionPour(utilisateurId: string): Promise<{ jeton: string; expireLe: Date }>`.

- [ ] **Step 1: Écrire les tests**

Ajouter à `apps/api/test/empreintes.test.ts` :
```ts
async function inscrit(t = telephone()) {
  const r = t.inscrire(await service.optionsInscription(u));
  await service.inscrire(u, r);
  return t;
}

describe('se reconnecter par l\'empreinte', () => {
  it('options : RP configuré, empreinte exigée, aucune clé listée (le téléphone propose les siennes)', async () => {
    const o = await service.optionsConnexion();
    expect(o.rpId).toBe('organizer.djkix.ovh');
    expect(o.userVerification).toBe('required');
    expect(o.timeout).toBe(60_000);
    expect(o.allowCredentials ?? []).toEqual([]);
  });

  it('une empreinte valide désigne le compte et date la clé', async () => {
    const t = await inscrit();
    horloge += 3600_000;
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion()))).toBe(u.id);
    const cle = await prisma.cleAcces.findFirstOrThrow();
    expect(cle.utiliseeLe?.toISOString()).toBe('2026-10-06T09:00:00.000Z');
  });

  it('une réponse rejouée est refusée : un défi ne sert qu\'une fois', async () => {
    const t = await inscrit();
    const r = t.authentifier(await service.optionsConnexion());
    expect(await service.verifierConnexion(r)).toBe(u.id);
    expect(await service.verifierConnexion(r)).toBeNull();
  });

  it('un compteur toujours nul (clés Android) passe ; un compteur qui recule est refusé', async () => {
    const nul = await inscrit();
    expect(await service.verifierConnexion(nul.authentifier(await service.optionsConnexion()))).toBe(u.id);
    expect(await service.verifierConnexion(nul.authentifier(await service.optionsConnexion()))).toBe(u.id);

    await viderBase(prisma);
    u = await prisma.utilisateur.create({ data: { nom: 'l' }, select: { id: true, nom: true } });
    const croissant = await inscrit(telephone(true));
    expect(await service.verifierConnexion(croissant.authentifier(await service.optionsConnexion()))).toBe(u.id);
    expect(await service.verifierConnexion(croissant.authentifier(await service.optionsConnexion()))).toBe(u.id);
    expect((await prisma.cleAcces.findFirstOrThrow()).compteur).toBe(2n);
    expect(await service.verifierConnexion(croissant.authentifier(await service.optionsConnexion(), { compteur: 1 }))).toBeNull();
    expect(journal.at(-1)).toMatch(/counter/);
  });

  it.each([
    [{ origine: 'https://organizer.djkix.ovh.exemple.net' }],
    [{ origine: 'http://organizer.djkix.ovh' }],
    [{ rpId: 'exemple.net' }],
    [{ type: 'webauthn.create' }],
    [{ sansUv: true }],
  ])('refuse une réponse faussée (%o)', async (f) => {
    const t = await inscrit();
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion(), f))).toBeNull();
    expect((await prisma.cleAcces.findFirstOrThrow()).utiliseeLe).toBeNull();
  });

  it('le compte renvoyé par le téléphone doit être celui de la clé, et il est exigé', async () => {
    const t = await inscrit();
    const autre = Buffer.from('00000000-0000-4000-8000-000000000000', 'utf8').toString('base64url');
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion(), { userHandle: autre }))).toBeNull();
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion(), { userHandle: null }))).toBeNull();
  });

  it('une clé retirée du serveur ne connecte plus', async () => {
    const t = await inscrit();
    await prisma.cleAcces.deleteMany();
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion()))).toBeNull();
  });

  it('un défi expiré, ou un défi d\'activation, ne sert pas à se connecter', async () => {
    const t = await inscrit();
    const o = await service.optionsConnexion();
    horloge += 120_001;
    expect(await service.verifierConnexion(t.authentifier(o))).toBeNull();
    const activation = await service.optionsInscription(u);
    expect(await service.verifierConnexion(t.authentifier({ challenge: activation.challenge }))).toBeNull();
  });
});
```

Ajouter à `apps/api/test/auth.test.ts`, dans `describe('AuthService', …)` :
```ts
  it('ouvrirSessionPour : même session de 90 jours, sans mot de passe à vérifier', async () => {
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    const s = await auth.ouvrirSessionPour(u.id);
    expect(s.expireLe.toISOString()).toBe('2027-01-04T08:00:00.000Z');
    expect(await auth.utilisateurDeSession(s.jeton)).toMatchObject({ nom: 'l' });
  });
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/empreintes.test.ts apps/api/test/auth.test.ts`
Expected: FAIL, `optionsConnexion`, `verifierConnexion` et `ouvrirSessionPour` n'existent pas.

- [ ] **Step 3: Écrire le code**

Dans `apps/api/src/auth/auth.service.ts`, remplacer la fin de `ouvrirSession` (à partir de `const jeton = …`) par un appel, et ajouter la méthode :
```ts
  async ouvrirSession(nom: string, motDePasse: string): Promise<{ jeton: string; expireLe: Date } | null> {
    const u = await this.prisma.utilisateur.findUnique({ where: { nom } });
    const ok = await verify(u?.motDePasseHash ?? (await factice()), motDePasse);
    if (!u?.motDePasseHash || !ok) return null;
    return this.ouvrirSessionPour(u.id);
  }

  /** Session de 90 jours d'un compte déjà authentifié, par mot de passe ou par empreinte. */
  async ouvrirSessionPour(utilisateurId: string): Promise<{ jeton: string; expireLe: Date }> {
    const jeton = randomBytes(32).toString('base64url');
    const expireLe = new Date(this.maintenant().getTime() + DUREE_SESSION_MS);
    await this.prisma.session.create({ data: { jetonHash: empreinte(jeton), utilisateurId, expireLe } });
    return { jeton, expireLe };
  }
```

Dans `apps/api/src/auth/empreintes/empreintes.service.ts`, compléter l'import de la bibliothèque :
```ts
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
```
et ajouter à la classe, après `inscrire` :
```ts
  async optionsConnexion(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    // Aucune clé listée : le téléphone propose les siennes (clés découvrables), sans nom à saisir.
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId, userVerification: 'required', timeout: DELAI_CEREMONIE_MS,
    });
    await this.defis.poser('connexion', options.challenge, 'connexion');
    return options;
  }

  /** Compte authentifié par l'empreinte, ou null : clé inconnue, compte différent, défi, origine, signature ou compteur. */
  async verifierConnexion(reponse: AuthenticationResponseJSON): Promise<string | null> {
    const cle = await this.prisma.cleAcces.findUnique({ where: { identifiant: reponse.id } });
    if (!cle) return null;
    // Clé découvrable : le téléphone renvoie le compte, qui doit être celui de la clé.
    const handle = reponse.response.userHandle;
    if (!handle || Buffer.from(handle, 'base64url').toString('utf8') !== cle.utilisateurId) return null;
    const v = await this.verifier('connexion', () => verifyAuthenticationResponse({
      response: reponse,
      expectedChallenge: async (defi) => (await this.defis.prendre('connexion', defi)) !== null,
      expectedOrigin: this.config.origine,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
      credential: {
        id: cle.identifiant, publicKey: new Uint8Array(cle.clePublique), counter: Number(cle.compteur), transports: cle.transports,
      },
    }));
    if (v === null || !v.verified) return null;
    await this.prisma.cleAcces.update({
      where: { id: cle.id },
      data: {
        compteur: BigInt(v.authenticationInfo.newCounter), utiliseeLe: this.maintenant(),
        sauvegardee: v.authenticationInfo.credentialBackedUp,
      },
    });
    return cle.utilisateurId;
  }
```

- [ ] **Step 4: Lancer les tests et le typage**

Run: `pnpm vitest run apps/api/test/empreintes.test.ts apps/api/test/auth.test.ts && pnpm --filter @organizer/api typecheck`
Expected: PASS.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La reconnexion par empreinte dans l'API : défi à usage unique, origine et RP exacts, empreinte exigée, compte de la clé vérifié, compteur qui recule refusé ; la même session que le mot de passe (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute la reconnexion par empreinte dans l'API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Routes HTTP de l'empreinte

**Files:**
- Create: `apps/api/src/auth/empreintes/schemas.ts`, `apps/api/src/auth/empreintes/empreintes.controller.ts`
- Modify: `apps/api/src/jetons.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/empreintes-http.test.ts`

**Interfaces:**
- Consumes: `EmpreintesService`, `TropDeCles`, `MAX_CLES_PAR_COMPTE` (tâches 5 et 6), `AuthService.ouvrirSessionPour`, `cookieSession`, `LimiteurDebit`, `SessionGuard`, `MagasinDefisValkey`, `ConfigApi.webauthn`.
- Produces (routes, toutes sous le `Cache-Control: no-store` et le limiteur global de `/api`) :
  - `POST /api/session/empreinte/options` → 200 `PublicKeyCredentialRequestOptionsJSON` ; sans session.
  - `POST /api/session/empreinte` (corps `AuthenticationResponseJSON`) → 204 + `Set-Cookie` de session ; 401 `{ message: MESSAGE_REFUS }`.
  - `GET /api/empreintes` (session) → 200 `ResumeEmpreinte[]`.
  - `POST /api/empreintes/options` (session) → 200 `PublicKeyCredentialCreationOptionsJSON` ; 409 `{ message: MESSAGE_TROP }`.
  - `POST /api/empreintes` (session, corps `RegistrationResponseJSON`) → 201 `ResumeEmpreinte` ; 400.
  - `DELETE /api/empreintes/:id` (session) → 204 ; 404 si inconnue, d'un autre compte, ou identifiant mal formé.
  - Jeton `EMPREINTES` ; constantes `MESSAGE_REFUS = 'Empreinte non reconnue. Essaie ton mot de passe.'`, `MESSAGE_TROP = 'Dix empreintes au plus. Retires-en une.'`.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/empreintes-http.test.ts` :
```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../src/auth/cookies.js';
import { DelaiDepasse, type MagasinDefis, type TypeDefi } from '../src/auth/empreintes/defis.js';
import { EmpreintesController, MESSAGE_REFUS, MESSAGE_TROP } from '../src/auth/empreintes/empreintes.controller.js';
import { EmpreintesService } from '../src/auth/empreintes/empreintes.service.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, EMPREINTES } from '../src/jetons.js';
import { AuthentificateurLogiciel, CONFIG_ESSAI, MagasinDefisMemoire } from './aides-webauthn.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
const auth = new AuthService(prisma);

/** Magasin que le test peut rendre muet, comme un Valkey arrêté. */
const magasin = new (class implements MagasinDefis {
  muet = false;
  interne = new MagasinDefisMemoire();
  poser(type: TypeDefi, defi: string, valeur: string): Promise<void> {
    return this.muet ? Promise.reject(new DelaiDepasse()) : this.interne.poser(type, defi, valeur);
  }
  prendre(type: TypeDefi, defi: string): Promise<string | null> {
    return this.muet ? Promise.reject(new DelaiDepasse()) : this.interne.prendre(type, defi);
  }
})();
const empreintes = new EmpreintesService(prisma, magasin, CONFIG_ESSAI, undefined, () => {});

class ModuleTest {}
Module({
  controllers: [AuthController, EmpreintesController],
  providers: [{ provide: AUTH, useValue: auth }, { provide: EMPREINTES, useValue: empreintes }, SessionGuard],
})(ModuleTest);

// Une application par test : le limiteur (10 par minute) appartient à l'instance du contrôleur.
let app: { url: string; fermer(): Promise<void> };
let telephone: AuthentificateurLogiciel;
afterAll(() => prisma.$disconnect());
afterEach(() => app.fermer());
beforeEach(async () => {
  app = await demarrerAppTest(ModuleTest);
  magasin.muet = false;
  telephone = new AuthentificateurLogiciel(CONFIG_ESSAI.rpId, CONFIG_ESSAI.origine);
  await viderBase(prisma);
  await prisma.utilisateur.create({ data: { nom: 'l' } });
  await auth.definirMotDePasse('l', 'un mot de passe assez long');
});

const appeler = (methode: string, chemin: string, corps?: unknown, cookie?: string) => fetch(`${app.url}${chemin}`, {
  method: methode,
  headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
  body: corps === undefined ? undefined : JSON.stringify(corps),
});
const cookieDe = (r: Response): string => `${NOM_COOKIE}=${lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE)}`;
const parMotDePasse = async (): Promise<string> =>
  cookieDe(await appeler('POST', '/api/session', { nom: 'l', motDePasse: 'un mot de passe assez long' }));

async function activer(cookie: string): Promise<void> {
  const o = await (await appeler('POST', '/api/empreintes/options', undefined, cookie)).json();
  const r = await appeler('POST', '/api/empreintes', telephone.inscrire(o), cookie);
  expect(r.status).toBe(201);
}

describe('/api/session/empreinte', () => {
  it('activer, se déconnecter, se reconnecter : la même session que le mot de passe', async () => {
    const cookie = await parMotDePasse();
    await activer(cookie);
    expect((await appeler('DELETE', '/api/session', undefined, cookie)).status).toBe(204);

    const o = await appeler('POST', '/api/session/empreinte/options');
    expect(o.status).toBe(200);
    const r = await appeler('POST', '/api/session/empreinte', telephone.authentifier(await o.json()));
    expect(r.status).toBe(204);
    const pose = r.headers.get('set-cookie') ?? '';
    expect(pose).toContain(`${NOM_COOKIE}=`);
    for (const attribut of [/HttpOnly/, /Secure/, /SameSite=Lax/, /Max-Age=7776000/]) expect(pose).toMatch(attribut);
    expect(await (await appeler('GET', '/api/session/moi', undefined, cookieDe(r))).json()).toEqual({ nom: 'l' });
  });

  it('une empreinte refusée : 401, message court, aucun cookie', async () => {
    for (const corps of [{}, { id: 'abc', rawId: 'abc', type: 'public-key', clientExtensionResults: {}, response: {} }]) {
      const r = await appeler('POST', '/api/session/empreinte', corps);
      expect(r.status).toBe(401);
      expect((await r.json()).message).toBe(MESSAGE_REFUS);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    const cookie = await parMotDePasse();
    await activer(cookie);
    await prisma.cleAcces.deleteMany();
    const o = await (await appeler('POST', '/api/session/empreinte/options')).json();
    expect((await appeler('POST', '/api/session/empreinte', telephone.authentifier(o))).status).toBe(401);
  });

  it('dix essais par minute et par IP au plus', async () => {
    const statuts: number[] = [];
    for (let i = 0; i < 11; i++) statuts.push((await appeler('POST', '/api/session/empreinte/options')).status);
    expect(statuts.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuts[10]).toBe(429);
  });

  it('Valkey muet : 500 sans contenu sur l\'empreinte, le mot de passe marche toujours', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    magasin.muet = true;
    const r = await appeler('POST', '/api/session/empreinte/options');
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ statusCode: 500, message: 'Erreur interne.' });
    const m = await appeler('POST', '/api/session', { nom: 'l', motDePasse: 'un mot de passe assez long' });
    expect(m.status).toBe(204);
    vi.restoreAllMocks();
  });
});

describe('/api/empreintes', () => {
  it('sans session : ni options, ni activation, ni liste, ni retrait', async () => {
    for (const [methode, chemin] of [
      ['POST', '/api/empreintes/options'], ['POST', '/api/empreintes'], ['GET', '/api/empreintes'],
      ['DELETE', '/api/empreintes/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      expect((await appeler(methode, chemin, methode === 'POST' ? {} : undefined)).status, chemin).toBe(401);
    }
  });

  it('liste et retrait : seulement ses clés ; identifiant d\'autrui ou mal formé : 404', async () => {
    const cookie = await parMotDePasse();
    await activer(cookie);
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const sienne = await prisma.cleAcces.create({ data: { identifiant: 'cle-autre', utilisateurId: autre.id, clePublique: new Uint8Array([1]) } });
    const liste = await (await appeler('GET', '/api/empreintes', undefined, cookie)).json();
    expect(liste).toHaveLength(1);
    expect(Object.keys(liste[0]).sort()).toEqual(['creeLe', 'id', 'identifiant', 'utiliseeLe']);
    expect((await appeler('DELETE', `/api/empreintes/${sienne.id}`, undefined, cookie)).status).toBe(404);
    expect((await appeler('DELETE', '/api/empreintes/pas-un-uuid', undefined, cookie)).status).toBe(404);
    expect((await appeler('DELETE', `/api/empreintes/${liste[0].id}`, undefined, cookie)).status).toBe(204);
    expect(await (await appeler('GET', '/api/empreintes', undefined, cookie)).json()).toEqual([]);
  });

  it('activation refusée : 400 ; dix clés au plus : 409 avec un message court', async () => {
    const cookie = await parMotDePasse();
    const o = await (await appeler('POST', '/api/empreintes/options', undefined, cookie)).json();
    const faussee = telephone.inscrire(o, { origine: 'https://exemple.net' });
    expect((await appeler('POST', '/api/empreintes', faussee, cookie)).status).toBe(400);
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    await prisma.cleAcces.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ identifiant: `cle-${i}`, utilisateurId: u.id, clePublique: new Uint8Array([1]) })),
    });
    const r = await appeler('POST', '/api/empreintes/options', undefined, cookie);
    expect(r.status).toBe(409);
    expect((await r.json()).message).toBe(MESSAGE_TROP);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/empreintes-http.test.ts`
Expected: FAIL, `empreintes.controller.js` introuvable et `EMPREINTES` non exporté.

- [ ] **Step 3: Écrire les schémas et le contrôleur**

`apps/api/src/auth/empreintes/schemas.ts` :
```ts
import { z } from 'zod';

const b64u = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);

const commun = {
  id: b64u(1400),
  rawId: b64u(1400),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
};

/** Forme d'une réponse d'activation. La bibliothèque revérifie chaque champ. */
export const schemaInscription = z.looseObject({
  ...commun,
  response: z.looseObject({
    clientDataJSON: b64u(16_384),
    attestationObject: b64u(65_536),
    transports: z.array(z.string().max(32)).max(10).optional(),
  }),
});

/** Forme d'une réponse de connexion. La bibliothèque revérifie chaque champ. */
export const schemaConnexionEmpreinte = z.looseObject({
  ...commun,
  response: z.looseObject({
    clientDataJSON: b64u(16_384),
    authenticatorData: b64u(16_384),
    signature: b64u(1024),
    userHandle: b64u(128).optional(),
  }),
});
```

`apps/api/src/auth/empreintes/empreintes.controller.ts` :
```ts
import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, HttpException, Inject, NotFoundException,
  Param, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { ResumeEmpreinte } from '@organizer/shared/api';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AUTH, EMPREINTES } from '../../jetons.js';
import type { AuthService } from '../auth.service.js';
import { cookieSession } from '../cookies.js';
import { LimiteurDebit } from '../limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from '../session.guard.js';
import { TropDeCles, type EmpreintesService } from './empreintes.service.js';
import { schemaConnexionEmpreinte, schemaInscription } from './schemas.js';

export const MESSAGE_REFUS = 'Empreinte non reconnue. Essaie ton mot de passe.';
export const MESSAGE_TROP = 'Dix empreintes au plus. Retires-en une.';

@Controller('api')
export class EmpreintesController {
  /** Même plafond que le mot de passe : 10 essais par minute et par IP, sur chaque POST d'empreinte. */
  private readonly limiteur = new LimiteurDebit(10, 60_000);

  constructor(
    @Inject(EMPREINTES) private readonly empreintes: EmpreintesService,
    @Inject(AUTH) private readonly auth: AuthService,
  ) {}

  private limiter(req: Request): void {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
  }

  @Post('session/empreinte/options')
  @HttpCode(200)
  optionsConnexion(@Req() req: Request): Promise<PublicKeyCredentialRequestOptionsJSON> {
    this.limiter(req);
    return this.empreintes.optionsConnexion();
  }

  @Post('session/empreinte')
  @HttpCode(204)
  async connecter(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corps: unknown): Promise<void> {
    this.limiter(req);
    const p = schemaConnexionEmpreinte.safeParse(corps);
    // Forme vérifiée ici ; la bibliothèque revérifie tout, signature comprise.
    const utilisateurId = p.success ? await this.empreintes.verifierConnexion(p.data as unknown as AuthenticationResponseJSON) : null;
    if (!utilisateurId) throw new UnauthorizedException(MESSAGE_REFUS);
    const s = await this.auth.ouvrirSessionPour(utilisateurId);
    res.setHeader('Set-Cookie', cookieSession(s.jeton, s.expireLe, this.auth.maintenant()));
  }

  @Get('empreintes')
  @UseGuards(SessionGuard)
  lister(@Req() req: RequeteAuthentifiee): Promise<ResumeEmpreinte[]> {
    return this.empreintes.lister(req.utilisateur.id);
  }

  @Post('empreintes/options')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async optionsInscription(@Req() req: RequeteAuthentifiee): Promise<PublicKeyCredentialCreationOptionsJSON> {
    this.limiter(req);
    try {
      return await this.empreintes.optionsInscription(req.utilisateur);
    } catch (err) {
      if (err instanceof TropDeCles) throw new ConflictException(MESSAGE_TROP);
      throw err;
    }
  }

  @Post('empreintes')
  @UseGuards(SessionGuard)
  @HttpCode(201)
  async inscrire(@Req() req: RequeteAuthentifiee, @Body() corps: unknown): Promise<ResumeEmpreinte> {
    this.limiter(req);
    const p = schemaInscription.safeParse(corps);
    const cle = p.success ? await this.empreintes.inscrire(req.utilisateur, p.data as unknown as RegistrationResponseJSON) : null;
    if (!cle) throw new BadRequestException('Empreinte non activée. Réessaie.');
    return cle;
  }

  @Delete('empreintes/:id')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async retirer(@Req() req: RequeteAuthentifiee, @Param('id') id: string): Promise<void> {
    const retiree = z.uuid().safeParse(id).success && (await this.empreintes.retirer(req.utilisateur.id, id));
    if (!retiree) throw new NotFoundException('Empreinte introuvable.');
  }
}
```

Dans `apps/api/src/jetons.ts`, ajouter :
```ts
export const EMPREINTES = Symbol('EMPREINTES');
```

Dans `apps/api/src/app.module.ts` : importer `EmpreintesController`, `EmpreintesService`, `MagasinDefisValkey` (depuis `./auth/empreintes/…js`) et `EMPREINTES` ; ajouter `EmpreintesController` à `controllers` après `AuthController` ; ajouter le fournisseur, après celui de `AUTH` :
```ts
    {
      provide: EMPREINTES,
      inject: [CONFIG, PRISMA, REDIS],
      useFactory: (c: ConfigApi, prisma: PrismaClient, redis: Redis) => new EmpreintesService(prisma, new MagasinDefisValkey(redis), c.webauthn),
    },
```

- [ ] **Step 4: Lancer les tests, le typage et le démarrage**

Run: `pnpm vitest run apps/api/test/empreintes-http.test.ts apps/api/test/auth.test.ts apps/api/test/http.test.ts apps/api/test/demarrage-api.test.ts apps/api/test/paquet.test.ts && pnpm --filter @organizer/api typecheck && pnpm lint`
Expected: PASS ; `paquet.test.ts` confirme que `@simplewebauthn/server` est une dépendance directe de l'API et que `dist/main.mjs` se charge.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les routes de l'empreinte : options et reconnexion sous `/api/session/empreinte`, activation, liste et retrait sous `/api/empreintes`, 10 essais par minute et par IP (2026-10-05). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute les routes de l'empreinte à l'API" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Retirer les empreintes d'un compte en ligne de commande

**Files:**
- Modify: `apps/api/src/auth/empreintes/empreintes.service.ts`, `apps/api/src/cli.ts`, `docs/exploitation.md` (tableau « Commandes courantes »), `CHANGELOG.md`
- Test: `apps/api/test/empreintes.test.ts` (ajouts) ; `infra/test/exploitation.test.ts` (existant : chaque commande de la CLI citée)

**Interfaces:**
- Consumes: `prisma.cleAcces`, `prisma.session`.
- Produces: `retirerEmpreintes(prisma: PrismaClient, nom: string): Promise<number>` ; commande `cli retirer-empreintes <nom>`.

- [ ] **Step 1: Écrire les tests**

Ajouter à `apps/api/test/empreintes.test.ts` (compléter l'import : `retirerEmpreintes`) :
```ts
describe('retirerEmpreintes (CLI, téléphone perdu)', () => {
  it('retire toutes les clés du compte et ferme ses sessions, sans toucher à l\'autre compte', async () => {
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const cle = (identifiant: string, utilisateurId: string) => ({ identifiant, utilisateurId, clePublique: new Uint8Array([1]) });
    await prisma.cleAcces.createMany({ data: [cle('a', u.id), cle('b', u.id), cle('c', autre.id)] });
    const expireLe = new Date('2027-01-01T00:00:00Z');
    await prisma.session.createMany({ data: [{ jetonHash: 'x', utilisateurId: u.id, expireLe }, { jetonHash: 'y', utilisateurId: autre.id, expireLe }] });
    expect(await retirerEmpreintes(prisma, 'l')).toBe(2);
    expect(await prisma.cleAcces.findMany({ select: { identifiant: true } })).toEqual([{ identifiant: 'c' }]);
    expect(await prisma.session.findMany({ select: { jetonHash: true } })).toEqual([{ jetonHash: 'y' }]);
  });

  it('compte inconnu : erreur claire', async () => {
    await expect(retirerEmpreintes(prisma, 'inconnu')).rejects.toThrow('Compte introuvable.');
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/api/test/empreintes.test.ts`
Expected: FAIL, `retirerEmpreintes` non exporté.

- [ ] **Step 3: Écrire la fonction, la commande et sa documentation**

À la fin de `apps/api/src/auth/empreintes/empreintes.service.ts` :
```ts
/** Téléphone perdu : toutes les clés du compte et toutes ses sessions. Renvoie le nombre de clés retirées. */
export async function retirerEmpreintes(prisma: PrismaClient, nom: string): Promise<number> {
  const u = await prisma.utilisateur.findUnique({ where: { nom } });
  if (!u) throw new Error('Compte introuvable.');
  const [cles] = await prisma.$transaction([
    prisma.cleAcces.deleteMany({ where: { utilisateurId: u.id } }),
    prisma.session.deleteMany({ where: { utilisateurId: u.id } }),
  ]);
  return cles.count;
}
```

Dans `apps/api/src/cli.ts`, importer `import { retirerEmpreintes } from './auth/empreintes/empreintes.service.js';` et ajouter à `COMMANDES`, après `'mot-de-passe'` :
```ts
  'retirer-empreintes': {
    usage: 'retirer-empreintes <nom>',
    async lancer([nom], prisma) {
      if (!nom) throw new Usage();
      const n = await retirerEmpreintes(prisma, nom);
      console.log(`${n} empreinte(s) retirée(s) pour ${nom}, sessions fermées. Le mot de passe reste valable.`);
    },
  },
```

Dans `docs/exploitation.md`, tableau « Commandes courantes », après la ligne `mot-de-passe` :
```markdown
| `vm docker compose exec -T api node apps/api/dist/cli.mjs retirer-empreintes <nom>` | retirer toutes les empreintes d'un compte et fermer ses sessions (téléphone perdu) ; le mot de passe reste valable |
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run apps/api/test/empreintes.test.ts infra/test/exploitation.test.ts apps/api/test/paquet.test.ts`
Expected: PASS ; `exploitation.test.ts` trouve `cli.mjs retirer-empreintes` dans la documentation.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La commande `retirer-empreintes <nom>` : retire toutes les empreintes d'un compte et ferme ses sessions, pour un téléphone perdu (2026-10-05). »
```bash
git add apps/api docs/exploitation.md CHANGELOG.md
git commit -m "Ajoute le retrait des empreintes d'un compte à la CLI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Client et logique d'empreinte de la PWA

**Files:**
- Create: `apps/web/src/lib/empreinte.ts`
- Modify: `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/messages.ts`, `apps/web/src/lib/format.ts`, `CHANGELOG.md`
- Test: `apps/web/test/empreinte.test.ts`, `apps/web/test/api.test.ts` (ajouts), `apps/web/test/format.test.ts` (ajout), `apps/web/test/regles-produit.test.ts` (existant)

**Interfaces:**
- Consumes: routes de la tâche 7, `ResumeEmpreinte`.
- Produces:
  - `ClientApi` gagne `optionsConnexionEmpreinte(): Promise<PublicKeyCredentialRequestOptionsJSON>`, `connecterParEmpreinte(r: AuthenticationResponseJSON): Promise<void>`, `optionsInscriptionEmpreinte(): Promise<PublicKeyCredentialCreationOptionsJSON>`, `inscrireEmpreinte(r: RegistrationResponseJSON): Promise<ResumeEmpreinte>`, `empreintes(): Promise<ResumeEmpreinte[]>`, `retirerEmpreinte(cleId: string): Promise<void>`.
  - `empreinte.ts` : `CLE_MEMO = 'organizer.empreinte'`, `interface Ceremonies { disponible(): boolean; creer(o): Promise<RegistrationResponseJSON>; obtenir(o): Promise<AuthenticationResponseJSON> }`, `interface Memo { lire(): string | null; poser(identifiant: string): void; effacer(): void }`, `memoLocal(stockage?)`, `messageEmpreinte(err: unknown): string`, `connecterParEmpreinte(api, c, memo): Promise<Issue>`, `activerEmpreinte(api, c, memo): Promise<{ ok: true; cle: ResumeEmpreinte } | { ok: false; message: string }>`, `retirerEmpreinte(api, cle, memo): Promise<Issue>`, `type Issue = { ok: true } | { ok: false; message: string }`.
  - `format.ts` : `ajouteeLe(iso: string, fuseau: string): string`.
  - Messages : `connecterEmpreinte`, `activerEmpreinte`, `empreinteActivee`, `empreinteAnnulee`, `empreinteDejaActive`, `empreinteIndisponible`, `empreinteRefusee`, `empreintesTrop`, `empreinteRetiree`, `retraitRate`, `cetAppareil`, `autreAppareil`, `retirer`.

- [ ] **Step 1: Installer la bibliothèque du navigateur**

Run: `pnpm --filter @organizer/web add @simplewebauthn/browser@^14.0.0`
Expected: `apps/web/package.json` gagne `"@simplewebauthn/browser": "^14.0.0"` dans `dependencies`.

- [ ] **Step 2: Écrire les tests**

`apps/web/test/empreinte.test.ts` :
```ts
import type { ResumeEmpreinte } from '@organizer/shared/api';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { describe, expect, it } from 'vitest';
import { ErreurApi, HorsLigne } from '../src/lib/api.js';
import {
  activerEmpreinte, CLE_MEMO, connecterParEmpreinte, memoLocal, messageEmpreinte, retirerEmpreinte, type Ceremonies, type Memo,
} from '../src/lib/empreinte.js';
import { MESSAGES } from '../src/lib/messages.js';

class StockageFaux {
  readonly m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

const CREATION: PublicKeyCredentialCreationOptionsJSON = {
  challenge: 'defi', rp: { name: 'Organizer', id: 'localhost' }, user: { id: 'dQ', name: 'test', displayName: 'test' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
};
const DEMANDE: PublicKeyCredentialRequestOptionsJSON = { challenge: 'defi' };
const INSCRIPTION: RegistrationResponseJSON = {
  id: 'cle-1', rawId: 'cle-1', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'e30', attestationObject: 'oA' },
};
const CONNEXION: AuthenticationResponseJSON = {
  id: 'cle-1', rawId: 'cle-1', type: 'public-key', clientExtensionResults: {},
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
};
const CLE: ResumeEmpreinte = { id: '00000000-0000-4000-8000-000000000001', identifiant: 'cle-1', creeLe: '2026-10-06T08:00:00.000Z', utiliseeLe: null };

function ceremonies(echec?: unknown): Ceremonies & { appels: string[] } {
  const appels: string[] = [];
  return {
    appels,
    disponible: () => true,
    creer: async (o) => { appels.push(`creer ${o.challenge}`); if (echec) throw echec; return INSCRIPTION; },
    obtenir: async (o) => { appels.push(`obtenir ${o.challenge}`); if (echec) throw echec; return CONNEXION; },
  };
}
const memoFaux = (): Memo & { valeur: string | null } => {
  const m = { valeur: null as string | null, lire: () => m.valeur, poser: (v: string) => { m.valeur = v; }, effacer: () => { m.valeur = null; } };
  return m;
};

describe('memoLocal', () => {
  it('retient l\'identifiant de la clé de ce téléphone, sous une seule clé de stockage', () => {
    const s = new StockageFaux();
    const m = memoLocal(() => s);
    expect(m.lire()).toBeNull();
    m.poser('cle-1');
    expect(m.lire()).toBe('cle-1');
    expect([...s.m.keys()]).toEqual([CLE_MEMO]);
    m.effacer();
    expect(m.lire()).toBeNull();
  });

  it('stockage absent ou qui lève : rien ne casse, pas d\'empreinte retenue', () => {
    const leve = (): never => { throw new Error('SecurityError'); };
    for (const m of [memoLocal(() => undefined), memoLocal(leve), memoLocal(() => ({ getItem: leve, setItem: leve, removeItem: leve }))]) {
      expect(() => m.poser('cle-1')).not.toThrow();
      expect(m.lire()).toBeNull();
      expect(() => m.effacer()).not.toThrow();
    }
  });
});

describe('messageEmpreinte', () => {
  it.each([
    [new DOMException('x', 'NotAllowedError'), MESSAGES.empreinteAnnulee],
    [new DOMException('x', 'AbortError'), MESSAGES.empreinteAnnulee],
    [new DOMException('x', 'InvalidStateError'), MESSAGES.empreinteDejaActive],
    [new DOMException('x', 'SecurityError'), MESSAGES.empreinteIndisponible],
    [new Error('WebAuthn is not supported in this browser'), MESSAGES.empreinteIndisponible],
    [new HorsLigne(), MESSAGES.horsLigne],
    [new ErreurApi(401, 'Empreinte non reconnue. Essaie ton mot de passe.'), 'Empreinte non reconnue. Essaie ton mot de passe.'],
    [new ErreurApi(429, 'Trop d\'essais. Réessaie dans une minute.'), 'Trop d\'essais. Réessaie dans une minute.'],
    [new ErreurApi(409, 'x'), MESSAGES.empreintesTrop],
    [new ErreurApi(400, 'x'), MESSAGES.empreinteRefusee],
    [new ErreurApi(500, 'x'), MESSAGES.serveurIndisponible],
  ])('%s', (err, message) => {
    expect(messageEmpreinte(err)).toBe(message);
  });
});

describe('connecterParEmpreinte', () => {
  it('options, invite, vérification ; retient la clé de ce téléphone', async () => {
    const appels: string[] = [];
    const api = {
      optionsConnexionEmpreinte: async () => { appels.push('options'); return DEMANDE; },
      connecterParEmpreinte: async (r: AuthenticationResponseJSON) => { appels.push(`verifier ${r.id}`); },
    };
    const c = ceremonies();
    const memo = memoFaux();
    expect(await connecterParEmpreinte(api, c, memo)).toEqual({ ok: true });
    expect([...appels, ...c.appels]).toEqual(['options', 'verifier cle-1', 'obtenir defi']);
    expect(memo.valeur).toBe('cle-1');
  });

  it('invite fermée : un message calme, rien n\'est envoyé, rien n\'est oublié', async () => {
    let verifie = false;
    const api = { optionsConnexionEmpreinte: async () => DEMANDE, connecterParEmpreinte: async () => { verifie = true; } };
    const memo = memoFaux();
    memo.poser('cle-1');
    expect(await connecterParEmpreinte(api, ceremonies(new DOMException('x', 'NotAllowedError')), memo))
      .toEqual({ ok: false, message: MESSAGES.empreinteAnnulee });
    expect(verifie).toBe(false);
    expect(memo.valeur).toBe('cle-1');
  });

  it('serveur injoignable avant l\'invite : aucune invite ouverte', async () => {
    const api = { optionsConnexionEmpreinte: async (): Promise<PublicKeyCredentialRequestOptionsJSON> => { throw new HorsLigne(); }, connecterParEmpreinte: async () => {} };
    const c = ceremonies();
    expect(await connecterParEmpreinte(api, c, memoFaux())).toEqual({ ok: false, message: MESSAGES.horsLigne });
    expect(c.appels).toEqual([]);
  });
});

describe('activerEmpreinte et retirerEmpreinte', () => {
  it('activer renvoie la clé et la retient pour ce téléphone', async () => {
    const api = { optionsInscriptionEmpreinte: async () => CREATION, inscrireEmpreinte: async () => CLE };
    const memo = memoFaux();
    expect(await activerEmpreinte(api, ceremonies(), memo)).toEqual({ ok: true, cle: CLE });
    expect(memo.valeur).toBe('cle-1');
  });

  it('clé déjà sur ce téléphone, ou dix clés : un message, rien de retenu', async () => {
    const api = { optionsInscriptionEmpreinte: async () => CREATION, inscrireEmpreinte: async () => CLE };
    const memo = memoFaux();
    expect(await activerEmpreinte(api, ceremonies(new DOMException('x', 'InvalidStateError')), memo))
      .toEqual({ ok: false, message: MESSAGES.empreinteDejaActive });
    const plein = { optionsInscriptionEmpreinte: async (): Promise<PublicKeyCredentialCreationOptionsJSON> => { throw new ErreurApi(409, 'x'); }, inscrireEmpreinte: async () => CLE };
    expect(await activerEmpreinte(plein, ceremonies(), memo)).toEqual({ ok: false, message: MESSAGES.empreintesTrop });
    expect(memo.valeur).toBeNull();
  });

  it('retirer la clé de ce téléphone l\'oublie ; une autre clé ne change rien ; déjà partie (404) vaut succès', async () => {
    const memo = memoFaux();
    memo.poser('cle-1');
    const ok = { retirerEmpreinte: async () => {} };
    expect(await retirerEmpreinte(ok, { ...CLE, identifiant: 'cle-2' }, memo)).toEqual({ ok: true });
    expect(memo.valeur).toBe('cle-1');
    const partie = { retirerEmpreinte: async () => { throw new ErreurApi(404, 'x'); } };
    expect(await retirerEmpreinte(partie, CLE, memo)).toEqual({ ok: true });
    expect(memo.valeur).toBeNull();
  });

  it('retrait raté : un message, la clé reste retenue', async () => {
    const memo = memoFaux();
    memo.poser('cle-1');
    expect(await retirerEmpreinte({ retirerEmpreinte: async () => { throw new HorsLigne(); } }, CLE, memo))
      .toEqual({ ok: false, message: MESSAGES.horsLigne });
    expect(await retirerEmpreinte({ retirerEmpreinte: async () => { throw new ErreurApi(500, 'x'); } }, CLE, memo))
      .toEqual({ ok: false, message: MESSAGES.retraitRate });
    expect(memo.valeur).toBe('cle-1');
  });
});
```

Ajouter à `apps/web/test/api.test.ts`, dans `describe('client API', …)` :
```ts
  it('empreinte : routes, méthodes, et un 401 de connexion ne renvoie pas vers la connexion', async () => {
    let appelee = 0;
    const { f, appels } = fauxFetch([
      Response.json({ challenge: 'defi' }),
      Response.json({ message: 'Empreinte non reconnue. Essaie ton mot de passe.' }, { status: 401 }),
      Response.json([]),
      vide(),
    ]);
    const api = creerClientApi({ fetch: f, surNonConnecte: () => { appelee++; } });
    expect(await api.optionsConnexionEmpreinte()).toEqual({ challenge: 'defi' });
    const e = await api.connecterParEmpreinte({
      id: 'a', rawId: 'a', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
    }).catch((x: unknown) => x);
    expect((e as ErreurApi).message).toBe('Empreinte non reconnue. Essaie ton mot de passe.');
    expect(await api.empreintes()).toEqual([]);
    await api.retirerEmpreinte('a/b');
    expect(appels.map((a) => `${a.init.method} ${a.url}`)).toEqual([
      'POST /api/session/empreinte/options', 'POST /api/session/empreinte', 'GET /api/empreintes', 'DELETE /api/empreintes/a%2Fb',
    ]);
    expect(entetes(appels[1]!.init).get('content-type')).toBe('application/json');
    expect(appelee).toBe(0);
  });
```

Ajouter à `apps/web/test/format.test.ts` (compléter l'import : `ajouteeLe`) :
```ts
  it('ajouteeLe : le jour civil local de l\'activation', () => {
    expect(ajouteeLe('2026-10-05T22:30:00.000Z', 'Europe/Paris')).toBe('Ajoutée le mardi 6 octobre');
  });
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm vitest run apps/web/test/empreinte.test.ts apps/web/test/api.test.ts apps/web/test/format.test.ts`
Expected: FAIL, `empreinte.js` introuvable, méthodes et `ajouteeLe` absentes.

- [ ] **Step 4: Écrire le code**

`apps/web/src/lib/messages.ts`, ajouter avant `// Réglages : …` :
```ts
  // Empreinte (WebAuthn)
  connecterEmpreinte: "Me connecter avec l'empreinte",
  activerEmpreinte: "Activer l'empreinte",
  empreinteActivee: 'Empreinte activée sur ce téléphone.',
  empreinteAnnulee: 'Empreinte annulée. Ton mot de passe marche toujours.',
  empreinteDejaActive: "L'empreinte est déjà active sur ce téléphone.",
  empreinteIndisponible: "L'empreinte n'est pas disponible ici.",
  empreinteRefusee: 'Empreinte non activée. Réessaie.',
  empreintesTrop: 'Dix empreintes au plus. Retires-en une.',
  empreinteRetiree: 'Empreinte retirée.',
  retraitRate: 'Pas pu retirer. Réessaie dans un moment.',
  cetAppareil: 'Ce téléphone',
  autreAppareil: 'Un autre appareil',
  retirer: 'Retirer',
```

`apps/web/src/lib/format.ts`, ajouter après `heureLocale` :
```ts
/** « Ajoutée le mardi 6 octobre » : jour civil local de l'activation d'une empreinte. */
export const ajouteeLe = (iso: string, fuseau: string): string => `Ajoutée le ${jourEnClair(jourLocal(new Date(iso), fuseau))}`;
```

`apps/web/src/lib/api.ts` : ajouter `ResumeEmpreinte` à l'import de `@organizer/shared/api`, et :
```ts
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/browser';
```
Dans `interface ClientApi`, après `moi()` :
```ts
  optionsConnexionEmpreinte(): Promise<PublicKeyCredentialRequestOptionsJSON>;
  connecterParEmpreinte(r: AuthenticationResponseJSON): Promise<void>;
  optionsInscriptionEmpreinte(): Promise<PublicKeyCredentialCreationOptionsJSON>;
  inscrireEmpreinte(r: RegistrationResponseJSON): Promise<ResumeEmpreinte>;
  empreintes(): Promise<ResumeEmpreinte[]>;
  retirerEmpreinte(cleId: string): Promise<void>;
```
Le commentaire de `surNonConnecte` devient : « Appelé sur un 401, sauf pour connecter, deconnecter, moi et la connexion par empreinte. » Dans l'objet rendu, après `moi` :
```ts
    optionsConnexionEmpreinte: () => json(appeler('POST', '/api/session/empreinte/options', undefined, false)),
    connecterParEmpreinte: (r) => sansCorps(appeler('POST', '/api/session/empreinte', r, false)),
    optionsInscriptionEmpreinte: () => json(appeler('POST', '/api/empreintes/options')),
    inscrireEmpreinte: (r) => json(appeler('POST', '/api/empreintes', r)),
    empreintes: () => json(appeler('GET', '/api/empreintes')),
    retirerEmpreinte: (cleId) => sansCorps(appeler('DELETE', `/api/empreintes/${id(cleId)}`)),
```

`apps/web/src/lib/empreinte.ts` :
```ts
import type { ResumeEmpreinte } from '@organizer/shared/api';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { ErreurApi, HorsLigne, type ClientApi } from './api.js';
import { MESSAGES } from './messages.js';

/** Clé de stockage : identifiant WebAuthn (public) de la clé de ce téléphone. Rien de personnel. */
export const CLE_MEMO = 'organizer.empreinte';

/** Les deux invites du téléphone. Injectées : les tests n'ont pas de navigateur. */
export interface Ceremonies {
  disponible(): boolean;
  creer(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON>;
  obtenir(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>;
}

/** Ce téléphone a-t-il une clé ? Sans réponse fiable (stockage absent ou bloqué) : non, le mot de passe suffit. */
export interface Memo {
  lire(): string | null;
  poser(identifiant: string): void;
  effacer(): void;
}

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function memoLocal(stockage: () => Stockage | undefined = () => globalThis.localStorage): Memo {
  const essayer = <T>(f: (s: Stockage) => T, defaut: T): T => {
    try {
      const s = stockage();
      return s ? f(s) : defaut;
    } catch {
      return defaut;
    }
  };
  return {
    lire: () => essayer((s) => s.getItem(CLE_MEMO), null),
    poser: (identifiant) => essayer((s) => s.setItem(CLE_MEMO, identifiant), undefined),
    effacer: () => essayer((s) => s.removeItem(CLE_MEMO), undefined),
  };
}

export type Issue = { ok: true } | { ok: false; message: string };

const nomErreur = (err: unknown): string =>
  typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';

/** Message calme pour tout échec d'empreinte. Seuls 401 et 429 portent un message de l'API. */
export function messageEmpreinte(err: unknown): string {
  if (err instanceof HorsLigne) return MESSAGES.horsLigne;
  if (err instanceof ErreurApi) {
    if (err.statut === 401 || err.statut === 429) return err.message;
    if (err.statut === 409) return MESSAGES.empreintesTrop;
    if (err.statut === 400) return MESSAGES.empreinteRefusee;
    return MESSAGES.serveurIndisponible;
  }
  const nom = nomErreur(err);
  // NotAllowedError : feuille fermée, délai dépassé, ou aucune clé sur ce téléphone.
  if (nom === 'NotAllowedError' || nom === 'AbortError') return MESSAGES.empreinteAnnulee;
  if (nom === 'InvalidStateError') return MESSAGES.empreinteDejaActive;
  return MESSAGES.empreinteIndisponible;
}

export async function connecterParEmpreinte(
  api: Pick<ClientApi, 'optionsConnexionEmpreinte' | 'connecterParEmpreinte'>, c: Ceremonies, memo: Memo,
): Promise<Issue> {
  try {
    const reponse = await c.obtenir(await api.optionsConnexionEmpreinte());
    await api.connecterParEmpreinte(reponse);
    memo.poser(reponse.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: messageEmpreinte(err) };
  }
}

export async function activerEmpreinte(
  api: Pick<ClientApi, 'optionsInscriptionEmpreinte' | 'inscrireEmpreinte'>, c: Ceremonies, memo: Memo,
): Promise<{ ok: true; cle: ResumeEmpreinte } | { ok: false; message: string }> {
  try {
    const cle = await api.inscrireEmpreinte(await c.creer(await api.optionsInscriptionEmpreinte()));
    memo.poser(cle.identifiant);
    return { ok: true, cle };
  } catch (err) {
    return { ok: false, message: messageEmpreinte(err) };
  }
}

export async function retirerEmpreinte(api: Pick<ClientApi, 'retirerEmpreinte'>, cle: ResumeEmpreinte, memo: Memo): Promise<Issue> {
  try {
    await api.retirerEmpreinte(cle.id);
  } catch (err) {
    // Déjà partie : le but est atteint.
    if (!(err instanceof ErreurApi && err.statut === 404)) {
      return { ok: false, message: err instanceof HorsLigne ? MESSAGES.horsLigne : MESSAGES.retraitRate };
    }
  }
  if (memo.lire() === cle.identifiant) memo.effacer();
  return { ok: true };
}
```

- [ ] **Step 5: Lancer les tests et le typage**

Run: `pnpm vitest run apps/web && pnpm --filter @organizer/web typecheck`
Expected: PASS, `regles-produit.test.ts` compris (chaque nouveau message a moins de 12 mots, ni « ! » ni « % »).

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Le client et la logique d'empreinte de la PWA (`@simplewebauthn/browser` 14) : invites injectées, messages calmes, clé de ce téléphone retenue sans rien de personnel (2026-10-05). »
```bash
git add apps/web pnpm-lock.yaml CHANGELOG.md
git commit -m "Ajoute la logique d'empreinte de la PWA" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Permissions-Policy de l'empreinte

**Files:**
- Modify: `apps/web/scripts/entetes.mjs:50`, `infra/caddy/Caddyfile:24`, `infra/image/essai.sh:66`, `CHANGELOG.md`
- Test: `apps/web/test/entetes.test.ts:24-30` ; `infra/test/image.test.ts:101-107` (existant : le Caddyfile porte la même valeur que `entetesCoquille`)

**Interfaces:**
- Consumes: rien.
- Produces: `Permissions-Policy: microphone=(self), camera=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)` en production (Caddy) et sous `vite preview` (e2e).

- [ ] **Step 1: Changer le test**

Dans `apps/web/test/entetes.test.ts`, le test « micro limité à l'origine… » devient :
```ts
  it('micro et empreinte limités à l\'origine, aucun référent, pas de devinette de type', () => {
    expect(entetesCoquille('<html></html>')).toMatchObject({
      'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
  });
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run apps/web/test/entetes.test.ts`
Expected: FAIL sur la valeur de `Permissions-Policy`.

- [ ] **Step 3: Changer les en-têtes**

- `apps/web/scripts/entetes.mjs` : `'Permissions-Policy': 'microphone=(self), camera=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',`
- `infra/caddy/Caddyfile` : `Permissions-Policy "microphone=(self), camera=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)"`
- `infra/image/essai.sh`, après la ligne qui vérifie `microphone=(self)` :
```sh
entete / permissions-policy | grep -qF 'publickey-credentials-get=(self)' || echec "Permissions-Policy : empreinte"
```
La CSP ne change pas : WebAuthn n'en dépend pas, et ses appels passent par `connect-src 'self'`.

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run apps/web/test/entetes.test.ts infra/test/image.test.ts`
Expected: PASS ; `image.test.ts` confirme que le Caddyfile porte la même valeur que `entetesCoquille`.

- [ ] **Step 5: Commiter**

Ligne de `CHANGELOG.md`, rubrique Modifié : « La Permissions-Policy autorise explicitement l'empreinte (WebAuthn) à la seule origine de la PWA ; la CSP est inchangée (2026-10-05). »
```bash
git add apps/web/scripts/entetes.mjs apps/web/test/entetes.test.ts infra/caddy/Caddyfile infra/image/essai.sh CHANGELOG.md
git commit -m "Ajoute l'empreinte à la Permissions-Policy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Écrans de connexion et de réglages, éprouvés par un authentificateur virtuel

**Files:**
- Create: `apps/web/src/lib/empreinte-navigateur.ts`, `apps/web/e2e/webauthn.ts`, `apps/web/e2e/empreinte.spec.ts`
- Modify: `apps/web/src/routes/connexion/+page.svelte`, `apps/web/src/routes/reglages/+page.svelte`, `apps/web/package.json` (devDependency), `pnpm-lock.yaml`, `CHANGELOG.md`

**Interfaces:**
- Consumes: tâche 9 (`connecterParEmpreinte`, `activerEmpreinte`, `retirerEmpreinte`, `memoLocal`, `Ceremonies`, messages, `ajouteeLe`), tâche 10 (en-tête testé ici).
- Produces: `ceremoniesNavigateur: Ceremonies` ; écrans ; e2e `serveurEmpreinte(etat)`, `authentificateurVirtuel(page)`, `compterInvites(page)`, `invites(page)`.

- [ ] **Step 1: Installer la bibliothèque du serveur pour l'e2e**

Run: `pnpm --filter @organizer/web add -D @simplewebauthn/server@^14.0.3`
Expected: `devDependencies` de `apps/web` gagne `@simplewebauthn/server` ; aucune trace dans le bundle client.

- [ ] **Step 2: Écrire les aides e2e**

`apps/web/e2e/webauthn.ts` :
```ts
import type { ResumeEmpreinte } from '@organizer/shared/api';
import type { CDPSession, Page } from '@playwright/test';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON, type WebAuthnCredential,
} from '@simplewebauthn/server';
import { json, type Table } from './simul';

// WebAuthn refuse une adresse IP comme identifiant de RP : les tests d'empreinte passent par localhost.
export const RP_ID = 'localhost';
export const ORIGINE = 'http://localhost:4173';
const COMPTE = '00000000-0000-4000-8000-000000000001';
export const idCle = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Authentificateur de plateforme virtuel de Chromium : clés découvrables, empreinte toujours reconnue. */
export async function authentificateurVirtuel(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

/** Compte les invites WebAuthn de la page (create et get), remis à zéro à chaque chargement. */
export async function compterInvites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { invites: number };
    w.invites = 0;
    const c = navigator.credentials;
    const creer = c.create.bind(c);
    const obtenir = c.get.bind(c);
    c.create = (o?: CredentialCreationOptions) => { w.invites++; return creer(o); };
    c.get = (o?: CredentialRequestOptions) => { w.invites++; return obtenir(o); };
  });
}

export const invites = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { invites: number }).invites);

/**
 * API simulée avec la vraie bibliothèque du serveur : défis, vérifications, clés en mémoire.
 * `etat.connecte` porte la session ; `erreurs` recueille les refus de vérification, qui doivent rester vides.
 */
export function serveurEmpreinte(etat: { connecte: boolean }): { table: Table; cles: ResumeEmpreinte[]; erreurs: string[] } {
  let defi: string | undefined;
  const cles: ResumeEmpreinte[] = [];
  const publiques = new Map<string, WebAuthnCredential>();
  const erreurs: string[] = [];
  let suivante = 1;
  const prendre = (): string => {
    const d = defi;
    defi = undefined;
    if (!d) throw new Error('aucun défi');
    return d;
  };
  const table: Table = {
    'GET /api/session/moi': (r) => (etat.connecte
      ? r.fulfill({ json: { nom: 'test' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
    'DELETE /api/session': (r) => {
      etat.connecte = false;
      return r.fulfill({ status: 204 });
    },
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }),
    'GET /api/empreintes': (r) => r.fulfill({ json: cles }),
    'POST /api/empreintes/options': async (r) => {
      const o = await generateRegistrationOptions({
        rpName: 'Organizer', rpID: RP_ID, userName: 'test', userID: new TextEncoder().encode(COMPTE), attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
      });
      defi = o.challenge;
      await r.fulfill({ json: o });
    },
    'POST /api/empreintes': async (r, req) => {
      try {
        const v = await verifyRegistrationResponse({
          response: req.postDataJSON() as RegistrationResponseJSON, expectedChallenge: prendre(),
          expectedOrigin: ORIGINE, expectedRPID: RP_ID, requireUserVerification: true,
        });
        if (!v.verified) throw new Error('activation non vérifiée');
        const c = v.registrationInfo.credential;
        publiques.set(c.id, c);
        const resume: ResumeEmpreinte = { id: idCle(suivante++), identifiant: c.id, creeLe: '2026-10-05T08:00:00.000Z', utiliseeLe: null };
        cles.push(resume);
        await r.fulfill({ status: 201, json: resume });
      } catch (e) {
        erreurs.push((e as Error).message);
        await r.fulfill({ status: 400, json: { message: 'Empreinte non activée. Réessaie.' } });
      }
    },
    'POST /api/session/empreinte/options': async (r) => {
      const o = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required' });
      defi = o.challenge;
      await r.fulfill({ json: o });
    },
    'POST /api/session/empreinte': async (r, req) => {
      try {
        const reponse = req.postDataJSON() as AuthenticationResponseJSON;
        const credential = publiques.get(reponse.id);
        if (!credential) throw new Error('clé inconnue');
        const v = await verifyAuthenticationResponse({
          response: reponse, expectedChallenge: prendre(), expectedOrigin: ORIGINE, expectedRPID: RP_ID, credential, requireUserVerification: true,
        });
        if (!v.verified) throw new Error('connexion non vérifiée');
        etat.connecte = true;
        await r.fulfill({ status: 204 });
      } catch (e) {
        erreurs.push((e as Error).message);
        await r.fulfill({ status: 401, json: { message: 'Empreinte non reconnue. Essaie ton mot de passe.' } });
      }
    },
  };
  for (let n = 1; n <= 3; n++) {
    table[`DELETE /api/empreintes/${idCle(n)}`] = (r) => {
      const i = cles.findIndex((c) => c.id === idCle(n));
      if (i >= 0) cles.splice(i, 1);
      return r.fulfill({ status: 204 });
    };
  }
  return { table, cles, erreurs };
}
```

- [ ] **Step 3: Écrire les scénarios e2e**

`apps/web/e2e/empreinte.spec.ts` :
```ts
import { expect, test, type Page } from '@playwright/test';
import { simuler, type Appel } from './simul';
import { authentificateurVirtuel, compterInvites, invites, serveurEmpreinte } from './webauthn';

test.use({ baseURL: 'http://localhost:4173' });

const DEPOT = 'POST /api/captures/privees';
const BOUTON_EMPREINTE = "Me connecter avec l'empreinte";

async function activer(page: Page): Promise<void> {
  await page.goto('/reglages');
  await page.getByRole('button', { name: "Activer l'empreinte" }).click();
  await expect(page.getByText('Empreinte activée sur ce téléphone.')).toBeVisible();
  await expect(page.getByText('Ce téléphone', { exact: true })).toBeVisible();
}

async function enregistrer(page: Page): Promise<void> {
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
  await page.getByRole('button', { name: "Commencer l'enregistrement" }).click();
  await expect(page.getByRole('heading', { name: "J'écoute" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Arrêter et garder' }).click();
}

test('activer l\'empreinte dans Réglages, puis se reconnecter sans mot de passe, sous la CSP', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener('securitypolicyviolation', (e) => { w.violations.push(`${e.violatedDirective} ${e.blockedURI}`); });
  });
  await authentificateurVirtuel(page);
  const s = serveurEmpreinte({ connecte: true });
  const appels = await simuler(page, s.table);

  const r = await page.goto('/reglages');
  expect(r?.headers()['permissions-policy']).toContain('publickey-credentials-get=(self)');
  await activer(page);
  await expect(page.getByRole('button', { name: "Activer l'empreinte" })).toHaveCount(0);

  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible();

  expect(appels.some((a) => a.cle === 'POST /api/session')).toBe(false);
  expect(s.erreurs).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
});

test('session expirée, empreinte active : le raccourci privé enregistre sans invite, la capture part après l\'empreinte', async ({ page }) => {
  await compterInvites(page);
  await authentificateurVirtuel(page);
  const etat = { connecte: true };
  const s = serveurEmpreinte(etat);
  const appels: Appel[] = await simuler(page, {
    ...s.table,
    [DEPOT]: (r) => (etat.connecte
      ? r.fulfill({ status: 201, json: { id: 'x' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
  });
  await activer(page);

  etat.connecte = false;
  await page.goto('/prive/enregistrer');
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await enregistrer(page);
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByText('Il partira après ta connexion.')).toBeVisible();
  // Rien ne s'est mis devant l'enregistrement, et l'écran de connexion n'a rien ouvert de lui-même.
  expect(await invites(page)).toBe(0);

  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await invites(page)).toBe(1);
  await expect.poll(() => appels.filter((a) => a.cle === DEPOT).length).toBeGreaterThanOrEqual(2);
  expect(new Set(appels.filter((a) => a.cle === DEPOT).map((a) => a.entetes['x-capture-id'])).size).toBe(1);
  expect(s.erreurs).toEqual([]);
});

test('une empreinte refusée se dit calmement ; le mot de passe reste là', async ({ page }) => {
  await authentificateurVirtuel(page);
  const etat = { connecte: true };
  const s = serveurEmpreinte(etat);
  await simuler(page, s.table);
  await activer(page);
  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);

  s.table['POST /api/session/empreinte'] = (r) => r.fulfill({ status: 401, json: { message: 'Empreinte non reconnue. Essaie ton mot de passe.' } });
  s.table['POST /api/session'] = (r) => {
    etat.connecte = true;
    return r.fulfill({ status: 204 });
  };
  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page.getByText('Empreinte non reconnue. Essaie ton mot de passe.')).toBeVisible();
  await page.getByLabel('Nom').fill('test');
  await page.getByLabel('Mot de passe').fill('un mot de passe assez long');
  await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('retirer l\'empreinte de ce téléphone : Réglages la repropose, la connexion n\'offre plus que le mot de passe', async ({ page }) => {
  await authentificateurVirtuel(page);
  const s = serveurEmpreinte({ connecte: true });
  await simuler(page, s.table);
  await activer(page);
  await page.getByRole('button', { name: /^Retirer/ }).click();
  await expect(page.getByText('Empreinte retirée.')).toBeVisible();
  await expect(page.getByRole('button', { name: "Activer l'empreinte" })).toBeVisible();
  expect(s.cles).toEqual([]);

  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByRole('button', { name: 'Me connecter', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: BOUTON_EMPREINTE })).toHaveCount(0);
});
```

- [ ] **Step 4: Lancer pour voir échouer**

Run: `pnpm --filter @organizer/web e2e -- empreinte.spec.ts`
Expected: FAIL, le bouton « Activer l'empreinte » n'existe pas.

- [ ] **Step 5: Écrire le câblage du navigateur**

`apps/web/src/lib/empreinte-navigateur.ts` :
```ts
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { Ceremonies } from './empreinte.js';

/** Invites réelles du téléphone (Credential Manager Android). Câblage sans test unitaire : éprouvé par l'e2e. */
export const ceremoniesNavigateur: Ceremonies = {
  disponible: () => browserSupportsWebAuthn(),
  creer: (optionsJSON) => startRegistration({ optionsJSON }),
  obtenir: (optionsJSON) => startAuthentication({ optionsJSON }),
};
```

- [ ] **Step 6: Écrire l'écran de connexion**

`apps/web/src/routes/connexion/+page.svelte` (contenu complet) :
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ErreurApi } from '$lib/api';
  import { api, garde } from '$lib/client';
  import { CHEMINS } from '$lib/config';
  import { connecterParEmpreinte, memoLocal } from '$lib/empreinte';
  import { ceremoniesNavigateur } from '$lib/empreinte-navigateur';
  import { MESSAGES } from '$lib/messages';
  import { filePrivee, videur } from '$lib/prive/demarrage';

  const memo = memoLocal();
  let nom = $state('');
  let motDePasse = $state('');
  let message = $state<string | null>(null);
  let envoi = $state(false);
  let enAttente = $state(false);
  // Bouton seulement si ce téléphone a une clé ; jamais d'invite ouverte d'elle-même.
  let empreinte = $state(false);
  onMount(async () => {
    empreinte = memo.lire() !== null && ceremoniesNavigateur.disponible();
    try {
      enAttente = (await filePrivee.lister()).some((c) => !c.refuse);
    } catch {
      enAttente = false;
    }
  });

  async function entrer(): Promise<void> {
    garde.oublier();
    // Des enregistrements ont pu attendre la session : ils partent maintenant.
    void videur.vider().catch(() => undefined);
    await goto(CHEMINS.accueil);
  }

  async function connecter(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    envoi = true;
    message = null;
    try {
      await api.connecter({ nom: nom.trim(), motDePasse });
      await entrer();
    } catch (err) {
      if (err instanceof ErreurApi && (err.statut === 401 || err.statut === 400 || err.statut === 422)) message = MESSAGES.identifiantsInvalides;
      else if (err instanceof ErreurApi && err.statut === 429) message = MESSAGES.tropDeRequetes;
      else if (err instanceof ErreurApi) message = MESSAGES.serveurIndisponible;
      else message = MESSAGES.horsLigne;
    } finally {
      envoi = false;
    }
  }

  async function parEmpreinte(): Promise<void> {
    envoi = true;
    message = null;
    try {
      const r = await connecterParEmpreinte(api, ceremoniesNavigateur, memo);
      if (r.ok) await entrer();
      else message = r.message;
    } finally {
      envoi = false;
    }
  }
</script>

<main class="connexion">
  <h1>Organizer</h1>
  <form onsubmit={connecter}>
    <label>Nom<input bind:value={nom} name="nom" autocomplete="username" autocapitalize="none" required /></label>
    <label>Mot de passe<input bind:value={motDePasse} name="motDePasse" type="password" autocomplete="current-password" required /></label>
    {#if message}<p role="status">{message}</p>{/if}
    {#if enAttente}<p class="discret">{MESSAGES.partiraApresConnexion}</p>{/if}
    {#if empreinte}
      <button class="bouton-principal" type="button" onclick={parEmpreinte} disabled={envoi}>{MESSAGES.connecterEmpreinte}</button>
      <button class="bouton" type="submit" disabled={envoi}>Me connecter</button>
    {:else}
      <button class="bouton-principal" type="submit" disabled={envoi}>Me connecter</button>
    {/if}
  </form>
</main>

<style>
  .connexion {
    min-height: 100dvh; display: flex; flex-direction: column; justify-content: flex-end; gap: 24px;
    padding: 24px 20px calc(120px + env(safe-area-inset-bottom));
  }
  h1 { font-size: var(--font-title); font-weight: 600; }
  form { display: flex; flex-direction: column; gap: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: var(--font-meta); color: var(--muted); }
  input {
    min-height: var(--touch-min); padding: 0 14px; border: 1px solid var(--muted); border-radius: 12px;
    background: var(--surface); color: var(--text); font-size: var(--font-body);
  }
</style>
```

- [ ] **Step 7: Écrire l'écran de réglages**

`apps/web/src/routes/reglages/+page.svelte` (contenu complet) :
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { ResumeEmpreinte } from '@organizer/shared/api';
  import { api, garde } from '$lib/client';
  import Icone from '$lib/composants/Icone.svelte';
  import { CHEMINS, FUSEAU } from '$lib/config';
  import { activerEmpreinte, memoLocal, retirerEmpreinte } from '$lib/empreinte';
  import { ceremoniesNavigateur } from '$lib/empreinte-navigateur';
  import { ajouteeLe } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let message = $state<string | null>(null);
  const nom = $derived(data.session?.etat === 'connecte' ? data.session.nom : '');

  const memo = memoLocal();
  let cles = $state<ResumeEmpreinte[]>([]);
  let chargee = $state(false);
  let ici = $state<string | null>(null);
  let disponible = $state(false);
  let occupe = $state(false);
  let messageEmpreinte = $state<string | null>(null);
  const iciActive = $derived(ici !== null && cles.some((c) => c.identifiant === ici));
  const appareil = (c: ResumeEmpreinte): string => (c.identifiant === ici ? MESSAGES.cetAppareil : MESSAGES.autreAppareil);

  onMount(async () => {
    disponible = ceremoniesNavigateur.disponible();
    ici = memo.lire();
    try {
      cles = await api.empreintes();
      chargee = true;
      // La clé de ce téléphone a été retirée ailleurs : la connexion n'a plus à la proposer.
      if (ici !== null && !cles.some((c) => c.identifiant === ici)) {
        memo.effacer();
        ici = null;
      }
    } catch {
      cles = [];
    }
  });

  async function activer(): Promise<void> {
    occupe = true;
    messageEmpreinte = null;
    const r = await activerEmpreinte(api, ceremoniesNavigateur, memo);
    if (r.ok) {
      cles = [...cles, r.cle];
      ici = r.cle.identifiant;
      messageEmpreinte = MESSAGES.empreinteActivee;
    } else {
      messageEmpreinte = r.message;
    }
    occupe = false;
  }

  async function retirer(c: ResumeEmpreinte): Promise<void> {
    messageEmpreinte = null;
    const r = await retirerEmpreinte(api, c, memo);
    if (r.ok) {
      cles = cles.filter((x) => x.id !== c.id);
      if (ici === c.identifiant) ici = null;
      messageEmpreinte = MESSAGES.empreinteRetiree;
    } else {
      messageEmpreinte = r.message;
    }
  }

  async function deconnecter(): Promise<void> {
    try {
      await api.deconnecter();
      garde.oublier();
      await goto(CHEMINS.connexion);
    } catch {
      message = MESSAGES.horsLigne;
    }
  }
</script>

<main class="ecran">
  <header class="entete"><h1>Réglages</h1></header>
  <h2 class="groupe">Compte</h2>
  <div class="carte reglage"><span>Connecté</span><span class="discret">{nom}</span></div>
  <h2 class="groupe">Empreinte</h2>
  {#each cles as c (c.id)}
    <div class="carte reglage">
      <span class="cle"><span>{appareil(c)}</span><span class="discret">{ajouteeLe(c.creeLe, FUSEAU)}</span></span>
      <button class="lien" onclick={() => retirer(c)} aria-label={`${MESSAGES.retirer}, ${appareil(c)}`}>{MESSAGES.retirer}</button>
    </div>
  {/each}
  {#if chargee && disponible && !iciActive}
    <button class="bouton activer" onclick={activer} disabled={occupe}>{MESSAGES.activerEmpreinte}</button>
  {/if}
  {#if messageEmpreinte}<p class="discret message" role="status">{messageEmpreinte}</p>{/if}
  <section class="carte note">
    <h2>{MESSAGES.sortDeLaMaisonTitre}</h2>
    <p>{MESSAGES.sortDeLaMaison1} {MESSAGES.sortDeLaMaison2}</p>
    <p>{MESSAGES.sortDeLaMaison3} {MESSAGES.sortDeLaMaison4}</p>
  </section>
  <a class="carte reglage" href={CHEMINS.aRevoir}><span>À revoir</span><Icone nom="suivant" /></a>
  <div class="bas">
    {#if message}<p class="discret" role="status">{message}</p>{/if}
    <button class="bouton" onclick={deconnecter}>Me déconnecter</button>
  </div>
</main>

<style>
  .reglage {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    min-height: var(--touch-min); color: var(--text); text-decoration: none;
  }
  .cle { display: grid; gap: 2px; }
  .activer { margin: 0 16px 10px; }
  .message { padding: 0 22px 10px; }
  .note { background: var(--accent-soft); font-size: var(--font-meta); line-height: 1.55; display: grid; gap: 6px; }
  .note h2 { font-size: var(--font-meta); font-weight: 600; }
</style>
```

- [ ] **Step 8: Lancer l'e2e complet, le typage, les règles produit et le budget**

Run: `pnpm --filter @organizer/web typecheck && pnpm vitest run apps/web && pnpm --filter @organizer/web e2e && pnpm --filter @organizer/web budget`
Expected: aucun avertissement de `svelte-check` ; PASS des tests unitaires (règles produit sur les deux écrans) ; les **quatre** scénarios d'empreinte et **tous** les e2e existants passent (connexion, CSP, privé, PWA) ; budget sous 150 Ko compressés (la bibliothèque du navigateur pèse quelques Ko). Si le budget est dépassé, s'arrêter et le signaler plutôt que de retirer quoi que ce soit.

- [ ] **Step 9: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « L'empreinte dans la PWA : « Activer l'empreinte », liste et retrait dans Réglages ; « Me connecter avec l'empreinte » sur l'écran de connexion, seulement si ce téléphone a une clé ; mot de passe toujours là ; e2e par l'authentificateur virtuel de Chromium (2026-10-05). »
```bash
git add apps/web pnpm-lock.yaml CHANGELOG.md
git commit -m "Ajoute l'empreinte aux écrans de connexion et de réglages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Configuration de production de l'empreinte

**Files:**
- Modify: `infra/docker-compose.yml` (service `api`), `infra/.env.example`, `infra/image/essai.sh`, `docs/exploitation.md`, `CHANGELOG.md`
- Test: `infra/test/compose.test.ts` (ajout) ; `infra/test/exploitation.test.ts` (existant : chaque variable obligatoire citée)

**Interfaces:**
- Consumes: `lireConfigWebauthn` (tâche 3), route `POST /api/session/empreinte/options` (tâche 7).
- Produces: variable obligatoire `DOMAINE_APP` du `.env` de la stack ; `WEBAUTHN_RP_ID=${DOMAINE_APP}` et `WEBAUTHN_ORIGIN=https://${DOMAINE_APP}` pour `api`.

- [ ] **Step 1: Écrire le test**

Ajouter à `infra/test/compose.test.ts`, dans `describe('stack de production', …)` :
```ts
  it('API : empreinte liée au domaine de la PWA, origine en https', () => {
    const env = service('api').environment!;
    expect(env.WEBAUTHN_RP_ID).toBe('${DOMAINE_APP:?}');
    expect(env.WEBAUTHN_ORIGIN).toBe('https://${DOMAINE_APP:?}');
  });
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run infra/test/compose.test.ts`
Expected: FAIL, `WEBAUTHN_RP_ID` absent.

- [ ] **Step 3: Écrire la configuration et la documentation**

`infra/docker-compose.yml`, service `api`, `environment`, après `TRUSTED_PROXY` :
```yaml
      # Empreinte (WebAuthn, décision 23) : identifiant de RP et origine exacte de la PWA.
      WEBAUTHN_RP_ID: ${DOMAINE_APP:?}
      WEBAUTHN_ORIGIN: https://${DOMAINE_APP:?}
```

`infra/.env.example`, après `DOMAINE_BOT=…` :
```
# Domaine de la PWA (décision 14) : identifiant de l'empreinte (WebAuthn), origine https://<domaine>.
# Le changer rend toutes les empreintes inutilisables (mot de passe toujours possible)
DOMAINE_APP=organizer.djkix.ovh
```

`infra/image/essai.sh` : dans le bloc `cat > "$TRAVAIL/.env"`, ajouter la ligne `DOMAINE_APP=organizer.essai` ; après la vérification `/api/session/moi sans session`, ajouter :
```sh
curl -sS -X POST "$URL/api/session/empreinte/options" | grep -qF '"rpId":"organizer.essai"' || echec "options d'empreinte : identifiant de RP"
```

`docs/exploitation.md` :
1. Tableau « Obligatoires » des variables du `.env`, après `DOMAINE_BOT` :
```markdown
| `DOMAINE_APP` | domaine de la PWA (`organizer.djkix.ovh`) ; l'empreinte y est liée |
```
2. Paragraphe « Le compose pose lui-même… » : ajouter « , et `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` (`https://` + `DOMAINE_APP`) ; sans eux, l'API refuse de démarrer ».
3. « Mettre à jour », étape 3, ajouter à la fin : « Une nouvelle variable obligatoire (voir le `CHANGELOG.md`) s'ajoute au `.env` **avant** `up` ; sinon le compose refuse de démarrer en la nommant. »
4. Nouvelle section, avant « ## Supervision » :
```markdown
## Empreinte (WebAuthn)

L'empreinte remplace seulement la saisie du mot de passe à la reconnexion (décision 23). Chaque compte
l'active depuis Réglages, sur son téléphone ; la clé privée ne quitte jamais le téléphone, la base ne garde
que la clé publique (table `cle_acces`). Le mot de passe reste toujours possible.

- Domaine : les clés sont liées à `DOMAINE_APP`. Changer de domaine les rend toutes inutilisables : chacun
  se reconnecte par mot de passe et réactive l'empreinte.
- Téléphone perdu : `retirer-empreintes <nom>` retire toutes les clés du compte et ferme ses sessions ;
  changer ensuite le mot de passe (`mot-de-passe <nom>`). Sur le téléphone retrouvé ou remplacé, la clé
  peut rester dans le gestionnaire de mots de passe : la supprimer depuis les réglages Android.
- Défis : dans Valkey, deux minutes, usage unique. Valkey arrêté : l'empreinte échoue (« Le serveur ne
  répond pas. »), le mot de passe marche toujours.
- Refus : `vm docker compose logs --since 1h api | grep 'Empreinte refusée'` donne la raison technique
  (origine, compteur, empreinte non vérifiée), jamais de contenu. Une origine inattendue signale un
  `DOMAINE_APP` faux ou un accès par une autre adresse que `https://organizer.djkix.ovh`.
- Contrôle : `curl -s -X POST https://organizer.djkix.ovh/api/session/empreinte/options` renvoie
  `"rpId":"organizer.djkix.ovh"`.
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run infra/test`
Expected: PASS ; `DOMAINE_APP` est documentée dans `infra/.env.example` et dans `docs/exploitation.md`.

- [ ] **Step 5: Lancer l'essai de fumée (Docker requis)**

Run:
```bash
for cible in api worker web sortie; do docker buildx build --load --target "$cible" -f infra/image/Dockerfile -t "ghcr.io/djkix/organizer-$cible:essai" .; done
infra/image/essai.sh essai
```
Expected: « Essai de fumée réussi. » ; à défaut de Docker local, la CI le joue (job `images`).

- [ ] **Step 6: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La stack lie l'empreinte au domaine de la PWA (`DOMAINE_APP`, obligatoire) ; l'essai de fumée vérifie l'identifiant de RP et la Permissions-Policy ; l'exploitation documente l'empreinte et le téléphone perdu (2026-10-05). »
```bash
git add infra docs/exploitation.md CHANGELOG.md
git commit -m "Ajoute la configuration de production de l'empreinte" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Publication de la version 1.1.0 et mise en service

Cette tâche se fait **avec Franck**. L'étiquette, le push et toute action sur la VM n'ont lieu qu'avec son accord explicite, donné dans la conversation ; à défaut, s'arrêter après l'étape 2 et lui remettre la procédure.

**Files:**
- Modify: `CHANGELOG.md` (publication)

**Interfaces:**
- Consumes: les tâches 1 à 12 fusionnées sur `main` ; la procédure de `docs/exploitation.md` (« Publier une version », « Mettre à jour », « Revenir à la version précédente »).
- Produces: étiquette `v1.1.0`, images `ghcr.io/djkix/organizer-*:1.1.0`, stack `/opt/stacks/organizer` en 1.1.0.

- [ ] **Step 1: Vérifier la branche entière**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @organizer/web e2e && pnpm --filter @organizer/web budget`
Expected: tout passe. Puis CI verte sur la branche `lot1-d-empreinte` (jobs `tests` et `images`, Trivy et essai de fumée compris). Si Trivy signale une vulnérabilité critique corrigeable dans une dépendance de `@simplewebauthn/server` (`@peculiar/*`, `@levischuck/tiny-cbor`, `@hexagon/base64`), monter le correctif par `pnpm update` et relancer.

Fusion sur `main` : par le skill `superpowers:finishing-a-development-branch`, au choix de Franck.

- [ ] **Step 2: Préparer la publication dans `CHANGELOG.md`**

Sur `main` : renommer « ## [Non publié] » en « ## [1.1.0] - <date du jour> », rouvrir au-dessus une rubrique « ## [Non publié] » vide, et retirer la ligne d'en-tête périmée « Le projet n'a pas encore de version publiée. ». Ajouter sous « [Non publié] » → Modifié : « Le journal publie la version 1.1.0 (<date>). »
```bash
git add CHANGELOG.md
git commit -m "Publie la version 1.1.0" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Étiqueter et pousser (Franck, ou avec son accord explicite)**

```bash
git tag -a v1.1.0 -m "Version 1.1.0 : reconnexion par empreinte digitale"
git push origin main v1.1.0
```
Expected: CI de l'étiquette verte, job `publication` compris. Les paquets GHCR sont déjà publics (première publication faite en 1.0.0) : contrôle `vm docker pull ghcr.io/djkix/organizer-api:1.1.0`.

- [ ] **Step 4: Mettre à jour la stack sur la VM**

Avec les fonctions `vm` et `cli` de `docs/exploitation.md` (« Gestes depuis le Mac ») :
```bash
# Copie de la base (étape 2 de « Mettre à jour »)
vm 'umask 077; mkdir -p -m 700 ~/sauvegardes; docker compose exec -T db pg_dump -U organizer -Fc organizer > ~/sauvegardes/organizer-$(date +%F).dump'
# Nouveau compose (variables WEBAUTHN_*)
scp infra/docker-compose.yml kix@192.168.1.201:/opt/stacks/organizer/compose.yaml
# Nouvelle variable obligatoire, puis la version
vm "grep -q '^DOMAINE_APP=' .env || echo 'DOMAINE_APP=organizer.djkix.ovh' >> .env"
vm "sed -i 's/^ORGANIZER_VERSION=.*/ORGANIZER_VERSION=1.1.0/' .env"
vm docker compose pull
vm docker compose up -d --wait   # repli documenté si --wait bute sur migrate « Exited (0) »
```
Vérifier :
- `vm docker compose ps -a` : `migrate` « Exited (0) », `db`, `queue`, `api`, `web` « healthy », `worker` et `sortie` « running » ;
- `vm docker compose logs migrate` cite `20261005120000_cles_acces` ; `vm 'docker compose exec -T db psql -U organizer -d organizer -c "\d cle_acces"'` décrit la table ;
- `curl -s https://organizer.djkix.ovh/api/sante` → `"ok":true` ;
- `curl -s -X POST https://organizer.djkix.ovh/api/session/empreinte/options` contient `"rpId":"organizer.djkix.ovh"` ;
- `curl -sI https://organizer.djkix.ovh/ | grep -i permissions-policy` contient `publickey-credentials-get=(self)` ;
- `cli telegram-webhook etat` sans erreur récente ; `vm docker compose logs --since 5m worker` contient « Worker démarré. Prompt … ».

Retour arrière : la migration n'ajoute qu'une table ; suivre « Revenir à la version précédente », cas « Avec une migration » (restauration de la copie de l'étape ci-dessus), puis `ORGANIZER_VERSION=1.0.0`.

- [ ] **Step 5: Vérification sur Android réel, avec Franck puis avec L**

Sur chaque téléphone (Chrome 120 ou plus, `chrome://version` ; écran verrouillé par empreinte ; un fournisseur de clés d'accès actif dans les réglages Android, gestionnaire Google par défaut). La PWA installée est mise à jour : fermer toutes ses fenêtres, la rouvrir.

1. Réglages : « Activer l'empreinte » ouvre la feuille Android « clé d'accès pour organizer.djkix.ovh » ; le doigt la valide ; la liste montre « Ce téléphone, Ajoutée le … » et le bouton disparaît.
2. « Me déconnecter », puis l'écran de connexion montre « Me connecter avec l'empreinte » au-dessus de « Me connecter » ; un appui, le doigt, Aujourd'hui s'affiche. Aucun nom ni mot de passe tapé.
3. L'écran de connexion n'ouvre jamais la feuille de lui-même, à l'ouverture comme au retour à l'écran.
4. Déconnecté, depuis le **raccourci privé** de l'écran d'accueil : l'enregistreur s'ouvre aussitôt, sans feuille ; enregistrer 5 secondes et garder ; l'écran de connexion dit « Il partira après ta connexion. » ; se connecter par l'empreinte ; la capture apparaît dans Privé.
5. En mode avion, déconnecté : le raccourci privé enregistre toujours ; la capture part au retour du réseau et après la connexion.
6. Fermer la feuille d'empreinte sans poser le doigt : « Empreinte annulée. Ton mot de passe marche toujours. » ; le mot de passe fonctionne.
7. Réglages : « Retirer » ; « Empreinte retirée. » ; à la déconnexion, seul le mot de passe est proposé. Supprimer aussi la clé dans le gestionnaire de mots de passe Android (organizer.djkix.ovh).
8. Franck seulement, sur son compte : réactiver, puis `cli retirer-empreintes <son compte>` ; la session du téléphone est fermée, l'empreinte est refusée calmement, le mot de passe marche.
9. `vm docker compose logs --since 30m api` : aucune ligne de contenu, seulement d'éventuels « Empreinte refusée (…) » techniques.

Noter le résultat (oui ou non par point, modèle de téléphone, version de Chrome, sans prénom) dans le dossier de revue du lot 1-D s'il est rédigé, sinon dans la description de la fusion. Un point en échec bloque l'annonce à L, pas le mot de passe, qui reste en service.

---

## Hors de ce plan

- Médiation conditionnelle (clés proposées dans le champ Nom), `signalUnknownCredential` pour nettoyer une clé retirée du téléphone, origines liées (`related origins`).
- Ressaisie du mot de passe avant l'activation (question ouverte 1).
- Création de compte, récupération de compte ou changement de mot de passe par l'empreinte.
- Lecture de l'AAGUID pour nommer le fournisseur de la clé ; iOS et ordinateur (hors cible).
- Dossier de revue du lot 1-D (`docs/revue/`), à rédiger si Franck le demande, sur le modèle des lots précédents.
