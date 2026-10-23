# Connexion par compte Google — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter « Continuer avec Google » à l'écran de connexion de la PWA, pour les deux comptes existants, sans retirer le mot de passe ni l'empreinte.

**Architecture:** Le navigateur affiche le bouton de Google Identity Services et reçoit un jeton d'identité ; l'API le vérifie avec `jose` contre les certificats publics de Google (téléchargés par le proxy `sortie`), retrouve le compte par l'adresse reliée en ligne de commande, garde le `sub`, et ouvre la session habituelle. La CSP et `Referrer-Policy` sont élargies pour toute l'application.

**Tech Stack:** NestJS 11, Prisma 6, `jose` 6 (nouvelle dépendance de `apps/api`), SvelteKit 2 / Svelte 5, Playwright, Vitest, Caddy, Squid.

**Spec:** `docs/superpowers/specs/2026-10-23-connexion-google-design.md`

## Global Constraints

- Décision 29. Version 1.13.0 (la 1.12.0 est prise par « Sauvegarder maintenant »).
- Aucune inscription : une adresse inconnue est refusée. Les liaisons se font par `cli lier-google <nom> <adresse>` / `cli delier-google <nom>`.
- Refus : un seul message pour tous les cas, `Ce compte Google n'est pas reconnu.`, statut 401.
- Le jeton doit avoir : signature RS256 valide (certificats `https://www.googleapis.com/oauth2/v3/certs`), émetteur `https://accounts.google.com` ou `accounts.google.com`, audience = `GOOGLE_CLIENT_ID`, non expiré, `email_verified` vrai. Adresse comparée en minuscules.
- `sub` mémorisé au premier passage ; ensuite identique exigé.
- Même session et même cookie que le mot de passe (`AuthService.ouvrirSessionPour`, 90 jours). Même limiteur (10 par minute et par IP).
- Mot de passe et empreinte inchangés. L'enregistreur privé et son cadenas restent accessibles sans connexion.
- Jamais de jeton, d'adresse ni de `sub` dans les journaux, le dépôt ou les messages de la CLI autres que `lier-google`.
- `Referrer-Policy: strict-origin-when-cross-origin`, pour toute l'application, aux deux endroits qui la posent.
- Messages en français, tutoiement, moins de 12 mots, pas de rouge.
- Chaque commit met à jour `CHANGELOG.md` sous « Non publié ».

## Review Focus

1. **Script Google lent à charger** : le lien « Me connecter avec un mot de passe » est utilisable tout de suite, sans attendre le bouton. → test e2e `lien du mot de passe sans attendre Google` (tâche 4).
2. **Adresse en majuscules** (`L@Exemple.org` reliée, jeton en minuscules ou l'inverse) : reconnue. → test `adresse comparée en minuscules` (tâche 1).
3. **Jeton valide mais `email_verified` faux** : refusé comme une adresse inconnue. → test `adresse non vérifiée : refusée` (tâche 1).
4. **Même `sub` déjà sur un autre compte** (adresse déplacée) : refus 401, jamais une erreur 500. → test `sub déjà pris : refusé sans erreur` (tâche 1).
5. **Jeton pour un autre client, expiré, ou mal signé** : refusé. → tests `mauvaise audience`, `expiré`, `autre clé` (tâche 1).

---

### Task 1 : Vérification du jeton, comptes reliés et commandes d'administration

**Files:**
- Create: `apps/api/src/auth/google.ts`
- Create: `packages/db/prisma/migrations/20261023130000_connexion_google/migration.sql`
- Modify: `packages/db/prisma/schema.prisma` (modèle `Utilisateur`)
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/cli.ts`
- Modify: `apps/api/package.json` (`jose`)
- Test: `apps/api/test/google.test.ts`, `apps/api/test/auth.test.ts`

**Interfaces:**
- Produces (`google.ts`) :
  - `export interface ProfilGoogle { sub: string; email: string; emailVerifie: boolean }`
  - `export interface VerificateurGoogle { verifier(jeton: string): Promise<ProfilGoogle | null> }` — `null` pour tout jeton invalide, jamais d'exception.
  - `export function creerVerificateurGoogle(clientId: string, cles: JWTVerifyGetKey): VerificateurGoogle` (type `JWTVerifyGetKey` de `jose`).
  - `export function clesGoogle(f: typeof fetch): JWTVerifyGetKey` — `createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { [customFetch]: f })`, `f` étant `creerFetchSortant()` de `@organizer/shared`.
- Produces (`AuthService`) :
  - `ouvrirSessionGoogle(profil: ProfilGoogle): Promise<{ jeton: string; expireLe: Date } | null>`
  - `lierGoogle(nom: string, adresse: string): Promise<void>` — erreurs `Compte introuvable.` et `Adresse déjà reliée à un autre compte.`
  - `delierGoogle(nom: string): Promise<void>`
- Produces (base) : colonnes `utilisateur.google_email` (TEXT, unique, nul) et `utilisateur.google_sub` (TEXT, unique, nul), champs Prisma `googleEmail`, `googleSub`. Migration additive.

- [ ] **Step 1 : Tests du vérificateur** dans `google.test.ts`. Une paire RSA générée par `generateKeyPair('RS256')`, un `createLocalJWKSet` comme `cles`, des jetons signés par `SignJWT` (`kid` posé). `CLIENT = 'client-essai.apps.googleusercontent.com'`.

```ts
it('jeton valide : profil', async () => {
  expect(await v.verifier(await jeton({ email: 'l@exemple.org', email_verified: true, sub: '123' })))
    .toEqual({ sub: '123', email: 'l@exemple.org', emailVerifie: true });
});
it('émetteur court accepté', ...);           // iss: 'accounts.google.com' → profil
it('mauvaise audience : null', ...);         // aud: 'autre' → null
it('expiré : null', ...);                    // exp passé → null
it('autre clé : null', ...);                 // signé par une autre paire → null
it('autre émetteur : null', ...);            // iss: 'https://exemple.org' → null
it('sans email ou sans sub : null', ...);
it('charabia : null', ...);                  // 'pas-un-jeton' → null
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm test apps/api/test/google.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3 : `pnpm --filter @organizer/api add jose@^6`, puis écrire `google.ts`** : `jwtVerify(jeton, cles, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId, algorithms: ['RS256'] })` dans un `try` qui rend `null` ; `email` mis en minuscules ; `emailVerifie = payload.email_verified === true`.

- [ ] **Step 4 : Relancer** — Expected: PASS.

- [ ] **Step 5 : Migration et modèle.** En-tête de commentaire comme les migrations voisines (« Connexion par Google (1.13.0, décision 29) : adresse reliée par la CLI et sub mémorisé au premier passage. Migration additive. »). `pnpm db migrate dev`, dossier renommé `20261023130000_connexion_google` si besoin, `pnpm db migrate status` à jour.

- [ ] **Step 6 : Tests de `AuthService`** dans `auth.test.ts` (compte `l` existant, `auth.lierGoogle('l', 'L@Exemple.org')`) :

```ts
it('adresse reliée : session de 90 jours, sub mémorisé', ...);            // profil { sub:'s1', email:'l@exemple.org', emailVerifie:true } → session ; googleSub === 's1'
it('adresse comparée en minuscules', ...);                                // reliée 'L@Exemple.org', profil 'l@exemple.org' → session
it('adresse non vérifiée : refusée', ...);                                // emailVerifie:false → null
it('adresse inconnue : refusée', ...);                                    // 'x@exemple.org' → null
it('sub changé : refusé', ...);                                           // 1er passage 's1', 2e 's2' → null
it('sub déjà pris : refusé sans erreur', ...);                            // compte 'f' a googleSub 's1' ; 'l' reçoit sub 's1' → null, aucune exception
it('lierGoogle : adresse déjà reliée à un autre compte refusée', ...);    // rejects.toThrow('Adresse déjà reliée')
it('lierGoogle : remet le sub à vide ; delierGoogle retire adresse et sub', ...);
it('le mot de passe marche toujours après une liaison Google', ...);
```

- [ ] **Step 7 : Lancer, vérifier l'échec** — `pnpm test apps/api/test/auth.test.ts` — Expected: FAIL (méthodes absentes).

- [ ] **Step 8 : Implémenter** les trois méthodes. `ouvrirSessionGoogle` : refus si `!emailVerifie` ; `findUnique({ where: { googleEmail: email } })` ; `googleSub` nul → `update` (une violation d'unicité `P2002` rend `null`) ; différent → `null` ; puis `ouvrirSessionPour(u.id)`. `lierGoogle` met l'adresse en minuscules et `googleSub: null` ; `P2025` → `Compte introuvable.`, `P2002` → `Adresse déjà reliée à un autre compte.`

- [ ] **Step 9 : CLI.** Dans `cli.ts`, sur le modèle de `lier-chat` / `delier` : `'lier-google': { usage: 'lier-google <nom> <adresse>' }` (message `Compte <nom> relié à <adresse>.`) et `'delier-google': { usage: 'delier-google <nom>' }` (message `Compte <nom> délié de Google.`). Une adresse sans `@` → `Usage`.

- [ ] **Step 10 : Lancer** — `pnpm test apps/api/test/google.test.ts apps/api/test/auth.test.ts && pnpm typecheck` — Expected: PASS.

- [ ] **Step 11 : Commit** avec `CHANGELOG.md`, rubrique Ajouté : « Connexion par Google, côté serveur : vérification du jeton d'identité, adresse reliée par `cli lier-google` et `cli delier-google`, sub mémorisé au premier passage ; aucune inscription (2026-10-23). »

---

### Task 2 : Routes de l'API et client de la PWA

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/jetons.ts` (jeton `VERIFICATEUR_GOOGLE`)
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/api/test/auth.test.ts`, `apps/web/test/api.test.ts`

**Interfaces:**
- Consumes : `VerificateurGoogle`, `AuthService.ouvrirSessionGoogle` (tâche 1).
- Produces (HTTP) :
  - `GET /api/session/google` (public) → `200 { clientId: string | null }` (`null` si `GOOGLE_CLIENT_ID` absent).
  - `POST /api/session/google` (public), corps `{ jeton: string }` (1 à 4096 caractères) → `204` + `Set-Cookie` de session ; `401 { message: 'Ce compte Google n\'est pas reconnu.' }` ; `429` comme la connexion par mot de passe, même limiteur.
- Produces (PWA, `api.ts`) : `configGoogle(): Promise<{ clientId: string | null }>` et `connecterGoogle(jeton: string): Promise<void>`, tous deux sans redirection sur 401 (comme `connecter`).

- [ ] **Step 1 : Tests HTTP** dans `auth.test.ts`, avec un `VerificateurGoogle` factice fourni sous `VERIFICATEUR_GOOGLE` (rend un profil pour `'bon'`, `null` sinon) et `clientId` `'client-essai'` :

```ts
it('GET /api/session/google : identifiant du client, sans session', ...);  // { clientId: 'client-essai' }
it('POST /api/session/google : cookie de session pour une adresse reliée', ...);
it('POST /api/session/google : 401 et message unique sinon', ...);          // jeton 'mauvais', puis adresse non reliée : même corps
it('POST /api/session/google : corps invalide → 401, jamais 500', ...);
it('le limiteur est commun aux deux connexions', ...);                     // 10 essais mêlés, le 11e → 429
it('aucun jeton ni adresse dans les journaux', ...);                       // espion sur console.* et le logger Nest
```

- [ ] **Step 2 : Lancer, vérifier l'échec.**

- [ ] **Step 3 : Implémenter.** Le contrôleur reçoit `@Inject(VERIFICATEUR_GOOGLE) google: VerificateurGoogle | null` et le `clientId` (fournisseur `CONFIG_GOOGLE` ou lecture par `lireVar('GOOGLE_CLIENT_ID')` au démarrage) ; `null` → GET rend `clientId: null`, POST rend 401. Dans `app.module.ts` : `creerVerificateurGoogle(clientId, clesGoogle(creerFetchSortant()))` quand `GOOGLE_CLIENT_ID` est présent.

- [ ] **Step 4 : Client PWA.** Test dans `apps/web/test/api.test.ts` : `connecterGoogle('j')` envoie `POST /api/session/google` avec `{ jeton: 'j' }` et ne déclenche pas le rappel de 401 ; `configGoogle()` lit `GET /api/session/google`. Lancer (FAIL), implémenter, relancer (PASS).

- [ ] **Step 5 : Lancer** — `pnpm test apps/api/test/auth.test.ts apps/web/test/api.test.ts && pnpm typecheck` — Expected: PASS.

- [ ] **Step 6 : Commit**, Ajouté : « `GET /api/session/google` et `POST /api/session/google` : identifiant du client et connexion par jeton Google, même session et même limiteur que le mot de passe (2026-10-23). »

---

### Task 3 : En-têtes et sortie de l'API

**Files:**
- Modify: `apps/web/scripts/entetes.mjs`, `infra/caddy/Caddyfile`
- Modify: `infra/sortie/squid.conf`
- Test: `apps/web/test/entetes.test.ts`, `infra/test/image.test.ts`, `apps/web/e2e/csp.spec.ts` si elle fige les en-têtes

- [ ] **Step 1 : Tests.**
  - `entetes.test.ts` : `politiqueCsp([])` contient `script-src 'self' https://accounts.google.com/gsi/client`, `style-src 'self' https://accounts.google.com/gsi/style`, `frame-src https://accounts.google.com/gsi/`, `connect-src 'self' https://accounts.google.com/gsi/` ; garde `default-src 'none'` et `frame-ancestors 'none'`. `entetesCoquille(html)['Referrer-Policy']` vaut `strict-origin-when-cross-origin` ; `Permissions-Policy` contient `identity-credentials-get=(self "https://accounts.google.com")`.
  - `image.test.ts` : `squid.conf` contient `acl vers_api dstdomain -n api.telegram.org www.googleapis.com` ; le Caddyfile contient `Referrer-Policy strict-origin-when-cross-origin` et plus `no-referrer`, et la même `Permissions-Policy` que `entetes.mjs`.

- [ ] **Step 2 : Lancer, vérifier l'échec** — `pnpm test apps/web/test/entetes.test.ts infra/test/image.test.ts`.

- [ ] **Step 3 : Implémenter**, avec un commentaire qui renvoie à la décision 29 (pourquoi le référent et les domaines Google).

- [ ] **Step 4 : Lancer** — mêmes tests, puis `pnpm --filter @organizer/web e2e csp` — Expected: PASS.

- [ ] **Step 5 : Commit**, Modifié : « CSP ouverte à Google Identity Services, `Referrer-Policy: strict-origin-when-cross-origin` pour toute l'application, et `www.googleapis.com` dans la sortie de l'API, pour la connexion par Google (décision 29) (2026-10-23). »

---

### Task 4 : Écran de connexion (maquette A)

**Files:**
- Create: `apps/web/src/lib/composants/BoutonGoogle.svelte`
- Modify: `apps/web/src/routes/connexion/+page.svelte`
- Modify: `apps/web/src/lib/messages.ts`
- Test: `apps/web/e2e/connexion.spec.ts`, `apps/web/e2e/apparence.spec.ts` (connexion à 360 et 390 px, clair et sombre)

**Interfaces:**
- Consumes : `api.configGoogle()`, `api.connecterGoogle(jeton)` (tâche 2).
- `BoutonGoogle.svelte` : props `clientId: string`, `onjeton: (jeton: string) => void`, `onindisponible: () => void`. Charge `https://accounts.google.com/gsi/client` une seule fois (balise `<script async>` dans `<head>`, réutilisée si déjà là), puis `google.accounts.id.initialize({ client_id, callback })` et `renderButton(conteneur, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'fr', width })`, largeur mesurée sur le conteneur et bornée de 200 à 400 px. Échec de chargement → `onindisponible()`.
- `messages.ts` : `connecterMotDePasse: 'Me connecter avec un mot de passe'`, `googleInconnu: "Ce compte Google n'est pas reconnu."`, `googleIndisponible: 'Google indisponible. Utilise ton mot de passe.'`.

Ordre de l'écran, toujours collé en bas : titre ; bouton Google (si `clientId` et script chargés) ; « Me connecter avec l'empreinte » (règle actuelle) ; lien `connecterMotDePasse` qui déplie le formulaire actuel (nom, mot de passe, « Me connecter »). Le formulaire est déplié d'office si `clientId` est `null` ou si `onindisponible` a été appelé, avec `googleIndisponible` dans ce second cas. Le message `partiraApresConnexion` reste. Après un jeton accepté : la même fonction `entrer()` que le mot de passe.

- [ ] **Step 1 : Tests e2e** dans `connexion.spec.ts`. Les routes de `simuler` gagnent `GET /api/session/google` (par défaut `{ clientId: null }`, pour que les tests existants trouvent le formulaire déplié). Un faux script GIS servi par `page.route('https://accounts.google.com/gsi/client', …)` : il définit `window.google.accounts.id` avec `initialize` qui garde le rappel et `renderButton` qui pose un bouton « Continuer avec Google » appelant le rappel avec `{ credential: 'jeton-essai' }`.

```ts
test('Google : le jeton part à l\'API et ouvre Aujourd\'hui', ...);          // POST /api/session/google reçoit { jeton: 'jeton-essai' } → URL '/'
test('Google : compte non reconnu, le message unique', ...);                 // 401 → "Ce compte Google n'est pas reconnu."
test('Google indisponible : formulaire déplié et message', ...);             // route GIS abort → champ « Nom » visible, "Google indisponible. Utilise ton mot de passe."
test('sans identifiant client : formulaire déplié, pas de bouton Google', ...);
test('lien du mot de passe sans attendre Google', ...);                     // route GIS retardée 5 s → le lien déplie le formulaire tout de suite
test('le cadenas privé reste sur l\'écran de connexion', ...);
```

Les tests existants qui remplissent le formulaire continuent de passer sans changement.

- [ ] **Step 2 : Lancer, vérifier l'échec** — `pnpm --filter @organizer/web e2e connexion`.

- [ ] **Step 3 : Implémenter** `BoutonGoogle.svelte`, les messages et la page.

- [ ] **Step 4 : Lancer** — `pnpm --filter @organizer/web e2e connexion apparence && pnpm --filter @organizer/web budget && pnpm test apps/web` — Expected: PASS (aucun débordement à 360 px, cibles de 44 px, budget de 150 Ko tenu : le script Google n'est pas dans le bundle).

- [ ] **Step 5 : Commit**, Ajouté : « Écran de connexion : « Continuer avec Google » en tête, l'empreinte dessous, le mot de passe derrière « Me connecter avec un mot de passe » ; formulaire déplié d'office si Google est indisponible (2026-10-23). »

---

### Task 5 : Documents de référence et exploitation

**Files:**
- Modify: `docs/decisions.md`, `docs/cahier-des-charges.md`, `CLAUDE.md`, `docs/exploitation.md`, `README.md`, `CHANGELOG.md`

Un seul commit (règle de `CLAUDE.md`).

- [ ] **Step 1 : `docs/decisions.md`** : ligne 29, « Connexion par Google | Les deux comptes se connectent aussi par Google (bouton en tête de l'écran de connexion) ; mot de passe et empreinte conservés. Adresse reliée à un compte existant par la CLI, aucune inscription ; adresse inconnue, non vérifiée ou au `sub` changé refusée. `Referrer-Policy: strict-origin-when-cross-origin` pour toute l'application, exigé par Google. Décidé par djkix le 23 octobre 2026 ».
- [ ] **Step 2 : `docs/cahier-des-charges.md`** : table des décisions (29) ; table Authentification (ligne « Connexion Google ») ; table des domaines de sortie (`api` : `www.googleapis.com`, certificats publics de Google) ; « Exposition et surface d'attaque », ligne En-têtes (`Referrer-Policy: strict-origin-when-cross-origin`) ; Dépendances externes (Google Identity Services : sans lui, le mot de passe et l'empreinte restent) ; « Ce que chaque surface porte » (connexion).
- [ ] **Step 3 : `CLAUDE.md`** : nombre de décisions (29) et une phrase dans l'état du projet.
- [ ] **Step 4 : `docs/exploitation.md`** : section « Connexion Google » : origine JavaScript `https://<DOMAINE_APP>` à déclarer sur le client OAuth existant (exacte, sans chemin ni barre finale ; sinon `origin_mismatch`) ; `cli lier-google` et `cli delier-google` ; commandes de la CLI ; dépannage (bouton absent : `GOOGLE_CLIENT_ID`, CSP, `www.googleapis.com` dans `squid.conf`) ; « Mettre à jour » pour la 1.13.0 (nouveau compose et image `sortie`, rien à ajouter au `.env`, origine à déclarer, liaisons).
- [ ] **Step 5 : `README.md`** : Comptes (Google en plus du mot de passe et de l'empreinte), table de l'API (deux routes), table d'administration (deux commandes).
- [ ] **Step 6 : Vérifier**

Run: `git grep -n "no-referrer" -- docs CLAUDE.md README.md infra apps/web/scripts`
Expected: aucune ligne qui décrive encore la politique en vigueur (une mention historique dans le CHANGELOG est admise).

- [ ] **Step 7 : Commit**, Modifié : « Décision 29 : connexion par Google à côté du mot de passe et de l'empreinte ; cahier des charges, `CLAUDE.md`, exploitation et README à jour (2026-10-23). »

---

### Task 6 : Mise en service (avec djkix)

Chaque étape touche la console Google, le dépôt public ou la production : seulement avec l'accord de djkix.

- [ ] **Step 1 :** djkix, console Google Cloud, client OAuth existant : ajouter l'origine JavaScript autorisée `https://<DOMAINE_APP>`.
- [ ] **Step 2 :** pousser la 1.12.0 en attente si ce n'est pas fait, puis publier la 1.13.0 (« Publier une version »).
- [ ] **Step 3 :** mettre à jour la stack (« Mettre à jour ») ; `vm docker compose exec api node apps/api/dist/cli.mjs essai-sortie https://www.googleapis.com` → `joignable`.
- [ ] **Step 4 :** `cli lier-google` pour les deux comptes, avec les adresses que djkix donne.
- [ ] **Step 5 :** essai par djkix sur ordinateur et par L sur son téléphone, PWA installée ; l'empreinte et le mot de passe marchent toujours.
