# Lot 1-B1 — API de la PWA et mode privé côté serveur : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'API expose tout ce dont la PWA a besoin (connexion, vues Aujourd'hui, Cette semaine, Horizons, À revoir, cochage, correction, réécoute) et reçoit les captures privées, par la PWA comme par le repli Telegram, sans qu'aucune ne puisse atteindre Gemini.

**Architecture:** On étend `apps/api` (NestJS) livré au lot 1-A. Chaque fonction est un service testé sur la vraie base de test, plus un contrôleur mince protégé par un garde de session. Les sessions sont en base (jeton aléatoire, empreinte SHA-256), les mots de passe en Argon2id. L'audio privé passe par ffmpeg (réencodage Opus) puis va dans `prive/`. Il est créé `prive = true, etat = 'privee'` en une seule écriture, ce que verrouillent déjà les garde-fous SQL du lot 1-A.

**Tech Stack:** NestJS 11, Prisma 6, PostgreSQL 17, `@node-rs/argon2`, Zod 4, Express (`raw`, `json`), ffmpeg (binaire système), Vitest 3.

**Spec:** `docs/cahier-des-charges.md` (Vues de l'application, Interactions, Le bouton privé, Authentification, Exposition et surface d'attaque, Capture CAP-06 à CAP-11), `docs/decisions.md`, `CLAUDE.md`.

**Suite :** plan **1-B2**, la PWA SvelteKit, qui consomme cette API. Il sera écrit une fois celle-ci livrée, sur les types de `packages/shared/src/api.ts`.

## Global Constraints

- Node 22 LTS ; NestJS 11 ; Prisma 6 ; TypeScript strict, aucun `any` implicite ; imports relatifs suffixés `.js`.
- NestJS : **toujours injecter par jeton explicite** (`@Inject(JETON)`), y compris dans les gardes et les contrôleurs. Dans les tests, déclarer les modules sans syntaxe de décorateur : `class M {}; Module({...})(M);`.
- Comptes locaux, mot de passe haché en **Argon2id**. Aucune inscription libre : comptes et mots de passe se créent en ligne de commande.
- Session PWA : jeton en cookie `HttpOnly`, `Secure`, `SameSite=Lax`, durée **90 jours**.
- Limitation de débit : **60 requêtes par minute et par IP sur l'API, 10 sur l'authentification**.
- Envois : type MIME et taille vérifiés (**30 Mo maximum**), audio réencodé par ffmpeg avant stockage.
- Capture privée : stockée telle quelle, **jamais envoyée, jamais transcrite, jamais classée**, marquée privée avant d'exister en base. Elle naît `prive = true, etat = 'privee'` et n'entre dans aucune file.
- Visibilité (décision 8, confirmée par Franck le 3 octobre 2026) : **les listes mélangent les deux comptes**. Aucune requête de vue ne filtre par utilisateur ; chacun peut cocher et corriger tout item.
- Une vue de plus de **vingt lignes** est un défaut ; Aujourd'hui en a **sept au plus** (actions du jour, puis **1 à 3 suggestions** tirées des fenêtres qui approchent).
- Zéro culpabilisation : aucune réponse d'API ne porte de compteur de retard, de pourcentage ni de mention « en retard ». Une action dont l'échéance est passée n'apparaît plus dans les vues.
- Types d'échéance, importance, effort, contexte : des données. Les valeurs admises d'une correction viennent du `response-schema.json` de la version de prompt configurée (décision 21). Seule `nature` est figée.
- Messages visibles par l'utilisatrice : français, tutoiement, moins de 12 mots, aucun emoji, aucun prénom réel.
- **Aucun contenu de capture dans les journaux** : identifiants et noms d'erreur seulement.
- Chaque commit met à jour `CHANGELOG.md` (rubrique sous « Non publié »), dans le même commit. Toute la documentation est en français.
- Dépôt public : aucun secret, aucune capture réelle, aucun prénom réel dans le code, les tests ou les fixtures.
- Une requête Prisma est paresseuse : jamais de `void requete` sans `then`, `catch` ou `await`.

## Review Focus

1. **Une capture privée envoyée deux fois** (file hors ligne de la PWA qui rejoue après une coupure) : une seule capture, réponse 200 au second envoi. Test : tâche 5.
2. **« Prochaine capture privée » armé, puis un échec en base ou une relivraison Telegram** : la capture ne devient jamais ordinaire et n'est jamais enfilée. Test : tâche 6, création privée en échec, drapeau rendu.
3. **Jour de changement d'heure** (25 octobre 2026) : Aujourd'hui montre exactement les actions du jour civil à Paris. Test : tâches 1 et 3.
4. **Une pensée corrigée en action, puis datée** : elle apparaît dans Aujourd'hui, et deux lignes de correction sont gardées. Test : tâche 4.
5. **Session expirée ou cookie forgé** : 401 avec un message court, sans indiquer si le compte existe. Test : tâche 2.

---

## Structure des fichiers

```
packages/shared/src/dates.ts         + jourLocal, ajouterJours, debutJour
packages/shared/src/tri.ts           + valeursAdmises
packages/shared/src/api.ts           types des réponses de l'API (consommés par la PWA)
packages/db/prisma/schema.prisma     + Session, motDePasseHash, prochainePrivee, etiquette
packages/db/src/test.ts              viderBase vide aussi « session »
apps/api/src/http.ts                 configurerApp : proxy, parseurs, limiteur global
apps/api/src/auth/limiteur.ts        LimiteurDebit
apps/api/src/auth/cookies.ts         lireCookie, cookieSession, cookieEfface
apps/api/src/auth/auth.service.ts    AuthService (Argon2id, sessions)
apps/api/src/auth/session.guard.ts   SessionGuard, RequeteAuthentifiee
apps/api/src/auth/auth.controller.ts /api/session
apps/api/src/vues/vues.service.ts    VuesService
apps/api/src/vues/vues.controller.ts /api/vues/*
apps/api/src/items/items.service.ts  cocher, decocher, corriger
apps/api/src/items/items.controller.ts /api/items/*, /api/captures/:id/audio
apps/api/src/privees/reencodeur.ts   Reencodeur, ReencodeurFfmpeg
apps/api/src/privees/privees.service.ts CapturesPriveesService
apps/api/src/privees/privees.controller.ts /api/captures/privees
apps/api/src/ingestion/ingestion.service.ts + mode « prochaine capture privée »
apps/api/src/telegram/bot.ts         + bouton « Prochaine capture privée »
apps/api/src/app.module.ts, main.ts, config.ts, jetons.ts, cli.ts   câblage
```

Prérequis machine, à installer par le contrôleur avant la tâche 5 : `brew install ffmpeg`, qui doit inclure `libopus`. Vérifier avec `ffmpeg -hide_banner -encoders | grep libopus`.

---

### Task 1: Jours civils et schéma de base

**Files:**
- Modify: `packages/shared/src/dates.ts`, `packages/shared/src/tri.ts`, `packages/db/prisma/schema.prisma`, `packages/db/src/test.ts`, `CHANGELOG.md`
- Create (généré) : `packages/db/prisma/migrations/<horodatage>_auth_prive/migration.sql`
- Test: `packages/shared/test/dates.test.ts` (ajouts), `packages/shared/test/tri.test.ts` (ajout), `packages/db/test/session.test.ts`

**Interfaces:**
- Produces: `jourLocal(date: Date, fuseau: string): string` (`AAAA-MM-JJ`), `ajouterJours(jour: string, n: number): string`, `debutJour(jour: string, fuseau: string): Date`, `valeursAdmises(prompt: Prompt, champ: keyof ItemTri): string[]`.
- Produces (Prisma) : `utilisateur.motDePasseHash: string | null`, `utilisateur.prochainePrivee: boolean`, `capture.etiquette: string | null`, modèle `session { id, jetonHash (unique), utilisateurId, creeLe, expireLe }`.

- [ ] **Step 1: Écrire les tests de dates**

Ajouter à `packages/shared/test/dates.test.ts` (compléter l'import : `ajouterJours, debutJour, jourLocal`) :
```ts
describe('jours civils', () => {
  it('jourLocal suit le fuseau, pas UTC', () => {
    expect(jourLocal(new Date('2026-10-06T22:30:00Z'), 'Europe/Paris')).toBe('2026-10-07');
  });
  it('ajouterJours traverse les mois et les années', () => {
    expect(ajouterJours('2026-12-30', 3)).toBe('2027-01-02');
    expect(ajouterJours('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('debutJour donne minuit local, y compris les jours de changement d\'heure', () => {
    expect(debutJour('2026-10-06', 'Europe/Paris').toISOString()).toBe('2026-10-05T22:00:00.000Z');
    expect(debutJour('2026-03-29', 'Europe/Paris').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(debutJour('2026-03-30', 'Europe/Paris').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(debutJour('2026-10-25', 'Europe/Paris').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(debutJour('2026-10-26', 'Europe/Paris').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
});
```

Ajouter à `packages/shared/test/tri.test.ts` (compléter l'import : `valeursAdmises`) :
```ts
describe('valeursAdmises', () => {
  it('lit les valeurs d\'un champ dans le schéma de la version', () => {
    expect(valeursAdmises(v1(), 'echeance_type')).toEqual(['datee', 'jour', 'fenetre', 'relative', 'aucune']);
    expect(valeursAdmises(v1(), 'texte')).toEqual([]);
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm vitest run packages/shared`
Expected: FAIL, `jourLocal` et `valeursAdmises` non exportés.

- [ ] **Step 3: Écrire le code**

Ajouter à `packages/shared/src/dates.ts` :
```ts
/** Jour civil (AAAA-MM-JJ) d'un instant, dans le fuseau. */
export function jourLocal(date: Date, fuseau: string): string {
  return isoLocal(date, fuseau).slice(0, 10);
}

export function ajouterJours(jour: string, n: number): string {
  const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Instant de 00:00 locale du jour civil. */
export function debutJour(jour: string, fuseau: string): Date {
  // Le décalage lu à 00:00 UTC est celui de minuit local : les changements d'heure ont lieu plus tard dans la nuit.
  const decalage = isoLocal(new Date(`${jour}T00:00:00Z`), fuseau).slice(19);
  return new Date(`${jour}T00:00:00${decalage}`);
}
```

Ajouter à `packages/shared/src/tri.ts` :
```ts
/** Valeurs admises d'un champ d'item, lues dans le schéma de la version (décision 21). */
export function valeursAdmises(prompt: Prompt, champ: keyof ItemTri): string[] {
  const schema = prompt.responseSchema as Noeud;
  return schema.properties?.items?.items?.properties?.[champ]?.enum ?? [];
}
```

- [ ] **Step 4: Lancer les tests**

Run: `pnpm vitest run packages/shared`
Expected: PASS.

- [ ] **Step 5: Étendre le schéma Prisma**

Dans `packages/db/prisma/schema.prisma` :
- dans `model Utilisateur`, ajouter :
```prisma
  motDePasseHash  String?   @map("mot_de_passe_hash")
  prochainePrivee Boolean   @default(false) @map("prochaine_privee")
  sessions        Session[]
```
- dans `model Capture`, ajouter après `texteBrut` :
```prisma
  etiquette     String?
```
- ajouter le modèle :
```prisma
model Session {
  id            String      @id @default(uuid()) @db.Uuid
  jetonHash     String      @unique @map("jeton_hash")
  utilisateurId String      @map("utilisateur_id") @db.Uuid
  creeLe        DateTime    @default(now()) @map("cree_le")
  expireLe      DateTime    @map("expire_le")
  utilisateur   Utilisateur @relation(fields: [utilisateurId], references: [id], onDelete: Cascade)

  @@map("session")
}
```

Dans `packages/db/src/test.ts`, la liste du `TRUNCATE` devient :
`'TRUNCATE session, correction, action, pensee, item, theme, capture, code_liaison, utilisateur CASCADE'`

Run (tunnel ouvert) : `pnpm db migrate dev --name auth_prive`
Expected: migration créée et appliquée à la base de dev `organizer`, client régénéré.

- [ ] **Step 6: Tester la table de session**

`packages/db/test/session.test.ts` :
```ts
import { afterAll, beforeEach, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

it('une session disparaît avec son compte, et son empreinte est unique', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const data = { jetonHash: 'abc', utilisateurId: u.id, expireLe: new Date('2027-01-01T00:00:00Z') };
  await prisma.session.create({ data });
  await expect(prisma.session.create({ data })).rejects.toThrow();
  await prisma.utilisateur.delete({ where: { id: u.id } });
  expect(await prisma.session.count()).toBe(0);
});

it('les nouveaux champs ont leurs valeurs par défaut', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  expect(u).toMatchObject({ motDePasseHash: null, prochainePrivee: false });
});
```

Run: `pnpm test -- packages`
Expected: PASS.

- [ ] **Step 7: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les jours civils dans le fuseau de l'utilisatrice, et le schéma des sessions, des mots de passe et des étiquettes privées (2026-10-03). »
```bash
git add packages CHANGELOG.md
git commit -m "Ajoute les jours civils et le schéma des sessions et du mode privé"   # + ligne vide + Co-Authored-By
```

---

### Task 2: Connexion, sessions et limitation de débit

**Files:**
- Create: `apps/api/src/http.ts`, `apps/api/src/auth/limiteur.ts`, `apps/api/src/auth/cookies.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/session.guard.ts`, `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/package.json`, `apps/api/src/jetons.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/cli.ts`, `CHANGELOG.md`
- Test: `apps/api/test/limiteur.test.ts`, `apps/api/test/auth.test.ts`, `apps/api/test/aides-http.ts`

**Interfaces:**
- Consumes: modèle `session`, `utilisateur.motDePasseHash` (tâche 1).
- Produces :
  - `class LimiteurDebit { constructor(max: number, fenetreMs: number, maintenant?: () => number); autoriser(cle: string): boolean }`
  - `NOM_COOKIE = 'organizer_session'`, `lireCookie(entete: string | undefined, nom: string): string | undefined`, `cookieSession(jeton: string, expireLe: Date, maintenant: Date): string`, `cookieEfface(): string`
  - `interface UtilisateurSession { id: string; nom: string; fuseau: string }`
  - `class AuthService { constructor(prisma, maintenant?); definirMotDePasse(nom, motDePasse): Promise<void>; ouvrirSession(nom, motDePasse): Promise<{ jeton: string; expireLe: Date } | null>; utilisateurDeSession(jeton): Promise<UtilisateurSession | null>; fermerSession(jeton): Promise<void> }`
  - `class SessionGuard`, `interface RequeteAuthentifiee extends Request { utilisateur: UtilisateurSession }`
  - jeton `AUTH` dans `jetons.ts`
  - `configurerApp(app: NestExpressApplication): void` dans `http.ts` (proxy de confiance, `raw` sur `POST /api/captures/privees` jusqu'à 30 Mo, `json` 1 Mo ailleurs, limiteur global 60/min/IP sur `/api`)
  - `demarrerAppTest(module: Type<unknown>): Promise<{ url: string; fermer(): Promise<void> }>` dans `apps/api/test/aides-http.ts`
  - REST : `POST /api/session` `{ nom, motDePasse }` → 204 + cookie ; `DELETE /api/session` → 204 ; `GET /api/session/moi` → `{ nom }` ; 401 `{ message: 'Identifiants invalides.' }` ou `'Connecte-toi pour continuer.'`
  - CLI : `pnpm --filter @organizer/api cli mot-de-passe <nom>` (saisie au clavier, 12 caractères minimum)

- [ ] **Step 1: Ajouter les dépendances**

Run: `pnpm --filter @organizer/api add @node-rs/argon2@^2 zod@^4.1.0 express@^5`
Expected: installé ; si pnpm signale un script de build ignoré, l'ajouter à `allowBuilds` dans `pnpm-workspace.yaml`.

- [ ] **Step 2: Écrire les tests du limiteur**

`apps/api/test/limiteur.test.ts` :
```ts
import { expect, it } from 'vitest';
import { LimiteurDebit } from '../src/auth/limiteur.js';

it('autorise max appels par fenêtre glissante, par clé', () => {
  let t = 0;
  const l = new LimiteurDebit(2, 1000, () => t);
  expect([l.autoriser('a'), l.autoriser('a'), l.autoriser('a')]).toEqual([true, true, false]);
  expect(l.autoriser('b')).toBe(true);
  t = 1001;
  expect(l.autoriser('a')).toBe(true);
});

it('un refus ne prolonge pas le blocage', () => {
  let t = 0;
  const l = new LimiteurDebit(1, 1000, () => t);
  l.autoriser('a');
  t = 500;
  expect(l.autoriser('a')).toBe(false);
  t = 1001;
  expect(l.autoriser('a')).toBe(true);
});
```

- [ ] **Step 3: Écrire l'aide HTTP et les tests d'authentification**

`apps/api/test/aides-http.ts` :
```ts
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configurerApp } from '../src/http.js';

/** Démarre un module Nest sur un port libre, avec la même configuration HTTP que la production. */
export async function demarrerAppTest(module: Type<unknown>): Promise<{ url: string; fermer(): Promise<void> }> {
  const app = await NestFactory.create<NestExpressApplication>(module, { logger: false, bodyParser: false });
  configurerApp(app);
  await app.listen(0, '127.0.0.1');
  const adresse = app.getHttpServer().address() as { port: number };
  return { url: `http://127.0.0.1:${adresse.port}`, fermer: () => app.close() };
}
```

`apps/api/test/auth.test.ts` :
```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH } from '../src/jetons.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
let horloge = new Date('2026-10-06T08:00:00Z');
const auth = new AuthService(prisma, () => horloge);

class ModuleTest {}
Module({ controllers: [AuthController], providers: [{ provide: AUTH, useValue: auth }, SessionGuard] })(ModuleTest);

let app: { url: string; fermer(): Promise<void> };
beforeAll(async () => { app = await demarrerAppTest(ModuleTest); });
afterAll(async () => { await app.fermer(); await prisma.$disconnect(); });
beforeEach(async () => {
  horloge = new Date('2026-10-06T08:00:00Z');
  await viderBase(prisma);
  await prisma.utilisateur.create({ data: { nom: 'l' } });
  await auth.definirMotDePasse('l', 'un mot de passe assez long');
});

const connecter = (motDePasse: string, nom = 'l') =>
  fetch(`${app.url}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nom, motDePasse }) });

describe('AuthService', () => {
  it('stocke un haché Argon2id, jamais le mot de passe', async () => {
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    expect(u.motDePasseHash).toMatch(/^\$argon2id\$/);
  });

  it('refuse un mot de passe de moins de 12 caractères', async () => {
    await expect(auth.definirMotDePasse('l', 'court')).rejects.toThrow('12');
  });

  it('une session expire au bout de 90 jours', async () => {
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    expect(s?.expireLe.toISOString()).toBe('2027-01-04T08:00:00.000Z');
    horloge = new Date('2027-01-04T08:00:01Z');
    expect(await auth.utilisateurDeSession(s!.jeton)).toBeNull();
  });

  it('ne stocke que l\'empreinte du jeton', async () => {
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const enBase = await prisma.session.findFirstOrThrow();
    expect(enBase.jetonHash).not.toBe(s!.jeton);
    expect(enBase.jetonHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('/api/session', () => {
  it('pose un cookie de session HttpOnly, Secure, SameSite=Lax, 90 jours', async () => {
    const r = await connecter('un mot de passe assez long');
    expect(r.status).toBe(204);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${NOM_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=7776000/);
  });

  it('même réponse pour un mauvais mot de passe et un compte inconnu', async () => {
    const a = await connecter('mauvais mot de passe !');
    const b = await connecter('un mot de passe assez long', 'inconnu');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect((await a.json()).message).toBe('Identifiants invalides.');
    expect((await b.json()).message).toBe('Identifiants invalides.');
  });

  it('moi exige une session valide ; un cookie forgé reçoit 401', async () => {
    const sans = await fetch(`${app.url}/api/session/moi`);
    expect(sans.status).toBe(401);
    expect((await sans.json()).message).toBe('Connecte-toi pour continuer.');
    const forge = await fetch(`${app.url}/api/session/moi`, { headers: { cookie: `${NOM_COOKIE}=faux` } });
    expect(forge.status).toBe(401);

    const r = await connecter('un mot de passe assez long');
    const jeton = lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE);
    const moi = await fetch(`${app.url}/api/session/moi`, { headers: { cookie: `${NOM_COOKIE}=${jeton}` } });
    expect(await moi.json()).toEqual({ nom: 'l' });
  });

  it('la déconnexion supprime la session et efface le cookie', async () => {
    const r = await connecter('un mot de passe assez long');
    const jeton = lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE);
    const d = await fetch(`${app.url}/api/session`, { method: 'DELETE', headers: { cookie: `${NOM_COOKIE}=${jeton}` } });
    expect(d.status).toBe(204);
    expect(d.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await prisma.session.count()).toBe(0);
  });

  it('dix essais par minute et par IP au plus', async () => {
    // Application à part : le limiteur appartient à l'instance du contrôleur, les autres tests l'ont entamé.
    const seule = await demarrerAppTest(ModuleTest);
    try {
      const statuts: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = await fetch(`${seule.url}/api/session`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nom: 'l', motDePasse: 'mauvais mot de passe !' }),
        });
        statuts.push(r.status);
      }
      expect(statuts.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuts[10]).toBe(429);
    } finally {
      await seule.fermer();
    }
  });
});
```

- [ ] **Step 4: Lancer pour voir échouer**

Run: `pnpm test -- apps/api/test/limiteur.test.ts apps/api/test/auth.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 5: Écrire le limiteur et les cookies**

`apps/api/src/auth/limiteur.ts` :
```ts
/** Fenêtre glissante en mémoire : un seul processus API. Un refus ne compte pas comme un appel. */
export class LimiteurDebit {
  private readonly appels = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly fenetreMs: number,
    private readonly maintenant: () => number = Date.now,
  ) {}

  autoriser(cle: string): boolean {
    const t = this.maintenant();
    const debut = t - this.fenetreMs;
    const recents = (this.appels.get(cle) ?? []).filter((x) => x > debut);
    if (recents.length >= this.max) {
      this.appels.set(cle, recents);
      return false;
    }
    recents.push(t);
    this.appels.set(cle, recents);
    if (this.appels.size > 10_000) this.purger(debut);
    return true;
  }

  private purger(debut: number): void {
    for (const [cle, liste] of this.appels) if (!liste.some((x) => x > debut)) this.appels.delete(cle);
  }
}
```

`apps/api/src/auth/cookies.ts` :
```ts
export const NOM_COOKIE = 'organizer_session';
const ATTRIBUTS = 'Path=/; HttpOnly; Secure; SameSite=Lax';

export function lireCookie(entete: string | undefined, nom: string): string | undefined {
  for (const morceau of (entete ?? '').split(';')) {
    const i = morceau.indexOf('=');
    if (i < 0 || morceau.slice(0, i).trim() !== nom) continue;
    try {
      return decodeURIComponent(morceau.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function cookieSession(jeton: string, expireLe: Date, maintenant: Date): string {
  const maxAge = Math.max(0, Math.floor((expireLe.getTime() - maintenant.getTime()) / 1000));
  return `${NOM_COOKIE}=${jeton}; ${ATTRIBUTS}; Max-Age=${maxAge}`;
}

export const cookieEfface = (): string => `${NOM_COOKIE}=; ${ATTRIBUTS}; Max-Age=0`;
```

- [ ] **Step 6: Écrire le service, le garde et le contrôleur**

`apps/api/src/auth/auth.service.ts` :
```ts
import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { PrismaClient } from '@organizer/db';

const DUREE_SESSION_MS = 90 * 24 * 3600_000;

export interface UtilisateurSession { id: string; nom: string; fuseau: string }

const empreinte = (jeton: string): string => createHash('sha256').update(jeton).digest('hex');

// Haché factice : un compte inconnu coûte le même temps qu'un mauvais mot de passe.
let hacheFactice: Promise<string> | undefined;
const factice = (): Promise<string> => (hacheFactice ??= hash('organizer-compte-inexistant'));

export class AuthService {
  constructor(private readonly prisma: PrismaClient, private readonly maintenant: () => Date = () => new Date()) {}

  async definirMotDePasse(nom: string, motDePasse: string): Promise<void> {
    if (motDePasse.length < 12) throw new Error('Mot de passe trop court : 12 caractères minimum.');
    await this.prisma.utilisateur.update({ where: { nom }, data: { motDePasseHash: await hash(motDePasse) } });
  }

  async ouvrirSession(nom: string, motDePasse: string): Promise<{ jeton: string; expireLe: Date } | null> {
    const u = await this.prisma.utilisateur.findUnique({ where: { nom } });
    const ok = await verify(u?.motDePasseHash ?? (await factice()), motDePasse);
    if (!u?.motDePasseHash || !ok) return null;
    const jeton = randomBytes(32).toString('base64url');
    const expireLe = new Date(this.maintenant().getTime() + DUREE_SESSION_MS);
    await this.prisma.session.create({ data: { jetonHash: empreinte(jeton), utilisateurId: u.id, expireLe } });
    return { jeton, expireLe };
  }

  async utilisateurDeSession(jeton: string): Promise<UtilisateurSession | null> {
    const s = await this.prisma.session.findUnique({ where: { jetonHash: empreinte(jeton) }, include: { utilisateur: true } });
    if (!s || s.expireLe <= this.maintenant()) return null;
    return { id: s.utilisateur.id, nom: s.utilisateur.nom, fuseau: s.utilisateur.fuseau };
  }

  async fermerSession(jeton: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { jetonHash: empreinte(jeton) } });
  }
}
```

Dans `apps/api/src/jetons.ts`, ajouter :
```ts
export const AUTH = Symbol('AUTH');
```

`apps/api/src/auth/session.guard.ts` :
```ts
import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH } from '../jetons.js';
import type { AuthService, UtilisateurSession } from './auth.service.js';
import { lireCookie, NOM_COOKIE } from './cookies.js';

export interface RequeteAuthentifiee extends Request { utilisateur: UtilisateurSession }

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: AuthService) {}

  async canActivate(contexte: ExecutionContext): Promise<boolean> {
    const req = contexte.switchToHttp().getRequest<RequeteAuthentifiee>();
    const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
    const u = jeton ? await this.auth.utilisateurDeSession(jeton) : null;
    if (!u) throw new UnauthorizedException('Connecte-toi pour continuer.');
    req.utilisateur = u;
    return true;
  }
}
```

`apps/api/src/auth/auth.controller.ts` :
```ts
import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AUTH } from '../jetons.js';
import type { AuthService } from './auth.service.js';
import { cookieEfface, cookieSession, lireCookie, NOM_COOKIE } from './cookies.js';
import { LimiteurDebit } from './limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from './session.guard.js';

const schemaConnexion = z.object({ nom: z.string().min(1).max(100), motDePasse: z.string().min(1).max(500) });

@Controller('api/session')
export class AuthController {
  private readonly limiteur = new LimiteurDebit(10, 60_000);

  constructor(@Inject(AUTH) private readonly auth: AuthService) {}

  @Post()
  @HttpCode(204)
  async ouvrir(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corps: unknown): Promise<void> {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
    const p = schemaConnexion.safeParse(corps);
    const s = p.success ? await this.auth.ouvrirSession(p.data.nom, p.data.motDePasse) : null;
    if (!s) throw new UnauthorizedException('Identifiants invalides.');
    res.setHeader('Set-Cookie', cookieSession(s.jeton, s.expireLe, new Date()));
  }

  @Delete()
  @HttpCode(204)
  async fermer(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
    if (jeton) await this.auth.fermerSession(jeton);
    res.setHeader('Set-Cookie', cookieEfface());
  }

  @Get('moi')
  @UseGuards(SessionGuard)
  moi(@Req() req: RequeteAuthentifiee): { nom: string } {
    return { nom: req.utilisateur.nom };
  }
}
```

- [ ] **Step 7: Écrire la configuration HTTP commune**

`apps/api/src/http.ts` :
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, raw, type NextFunction, type Request, type Response } from 'express';
import { LimiteurDebit } from './auth/limiteur.js';

export const TAILLE_MAX_AUDIO = '30mb';

/** Configuration HTTP commune à la production et aux tests. */
export function configurerApp(app: NestExpressApplication): void {
  // Derrière le Nginx Proxy Manager : l'IP du client vient de X-Forwarded-For.
  app.set('trust proxy', 1);
  const limiteur = new LimiteurDebit(60, 60_000);
  app.use('/api', (req: Request, res: Response, suite: NextFunction) => {
    if (limiteur.autoriser(req.ip ?? 'inconnue')) return suite();
    res.status(429).json({ message: 'Trop de requêtes. Réessaie dans une minute.' });
  });
  const audio = raw({ type: () => true, limit: TAILLE_MAX_AUDIO });
  app.use('/api/captures/privees', (req: Request, res: Response, suite: NextFunction) =>
    req.method === 'POST' && req.path === '/' ? audio(req, res, suite) : suite());
  app.use(json({ limit: '1mb' }));
}
```

`apps/api/src/main.ts` devient :
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { lireConfigApi } from './config.js';
import { configurerApp } from './http.js';

const { port } = lireConfigApi();
const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });
configurerApp(app);
app.enableShutdownHooks();
await app.listen(port);
console.log(`API démarrée sur le port ${port}.`);
```

Dans `apps/api/src/app.module.ts` : importer `AuthController`, `AuthService`, `SessionGuard`, `AUTH` ; ajouter `AuthController` à `controllers` et ces fournisseurs :
```ts
    { provide: AUTH, inject: [PRISMA], useFactory: (prisma: PrismaClient) => new AuthService(prisma) },
    SessionGuard,
```

Dans `apps/api/src/cli.ts`, ajouter avant le `else` final :
```ts
  } else if (commande === 'mot-de-passe' && nom) {
    const { createInterface } = await import('node:readline/promises');
    const saisie = createInterface({ input: process.stdin, output: process.stdout });
    const motDePasse = await saisie.question('Mot de passe (12 caractères minimum) : ');
    saisie.close();
    await new AuthService(prisma).definirMotDePasse(nom, motDePasse);
    console.log(`Mot de passe de ${nom} enregistré.`);
```
(importer `AuthService` en tête ; ajouter `| cli mot-de-passe <nom>` à la ligne d'usage).

- [ ] **Step 8: Lancer les tests**

Run: `pnpm test -- apps/api && pnpm typecheck && pnpm lint`
Expected: PASS ; les tests existants du webhook (`telegram.controller.test.ts`) passent toujours avec le nouveau parseur JSON.

- [ ] **Step 9: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « La connexion à la PWA : mot de passe Argon2id posé en ligne de commande, session de 90 jours en cookie sécurisé, limitation de débit (2026-10-03). »
```bash
git add apps/api pnpm-lock.yaml pnpm-workspace.yaml CHANGELOG.md
git commit -m "Ajoute la connexion, les sessions et la limitation de débit"   # + ligne vide + Co-Authored-By
```

---

### Task 3: Vues Aujourd'hui, Cette semaine, Horizons, À revoir

**Files:**
- Create: `packages/shared/src/api.ts`, `apps/api/src/vues/vues.service.ts`, `apps/api/src/vues/vues.controller.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/jetons.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/vues.test.ts`, `apps/api/test/aides-items.ts`

**Interfaces:**
- Consumes: `jourLocal`, `ajouterJours`, `debutJour` (tâche 1) ; `SessionGuard`, `RequeteAuthentifiee`, `demarrerAppTest` (tâche 2).
- Produces (dans `@organizer/shared`) :
```ts
export interface LigneAction {
  itemId: string; captureId: string; texte: string; theme: string | null;
  echeanceType: string | null; echeanceExpr: string | null;
  echeanceDate: string | null; fenetreFin: string | null;
  alarme: boolean; aAudio: boolean;
}
export interface VueAujourdhui { jour: string; actions: LigneAction[]; suggestions: LigneAction[] }
export interface VueSemaine { jours: { jour: string; actions: LigneAction[] }[] }
export interface VueHorizons { bornes: { fin: string; libelle: string | null; actions: LigneAction[] }[] }
export interface ItemARevoir { itemId: string; captureId: string; texte: string; emisLe: string; aAudio: boolean }
export interface CaptureARevoir { captureId: string; texte: string | null; emisLe: string; aAudio: boolean }
export interface VueARevoir { items: ItemARevoir[]; captures: CaptureARevoir[] }
```
- Produces : `class VuesService { constructor(prisma); aujourdhui(maintenant: Date, fuseau: string): Promise<VueAujourdhui>; semaine(...): Promise<VueSemaine>; horizons(...): Promise<VueHorizons>; aRevoir(): Promise<VueARevoir> }` ; jeton `VUES` ; REST `GET /api/vues/aujourdhui|semaine|horizons|a-revoir` (session exigée).
- Produces (tests) : `creerAction(prisma, o: { texte?: string; type: string | null; date?: string; fin?: string; faitLe?: string; expr?: string; nature?: 'action' | 'pensee' | 'ambigu' }): Promise<{ itemId: string; captureId: string }>` dans `apps/api/test/aides-items.ts`.

Règles (cahier, Vues de l'application) :
- Actions ouvertes : `nature = 'action'`, `archiveLe` nul, `faitLe` nul. Les deux comptes sont mélangés.
- **Aujourd'hui** : actions `datee`, `jour` ou `relative` dont `echeanceDate` tombe dans le jour civil local, triées par heure, 7 au plus ; puis jusqu'à 3 suggestions `fenetre` dont `fenetreFin` est dans les 14 prochains jours, sans dépasser 7 lignes au total. Une échéance passée n'apparaît pas.
- **Cette semaine** : mêmes types, `echeanceDate` du début d'aujourd'hui à 7 jours, groupées par jour civil, 20 lignes au plus.
- **Horizons** : `fenetre` dont la fin n'est pas passée, triées par fin croissante, groupées par fin (libellé : la première `echeanceExpr`), 20 lignes au plus.
- **À revoir** : items `ambigu` non archivés et captures ordinaires `a_revoir`, les plus récents d'abord, 20 de chaque au plus. Jamais de capture privée.

- [ ] **Step 1: Écrire l'aide de test**

`apps/api/test/aides-items.ts` :
```ts
import type { PrismaClient } from '@organizer/db';

/** Crée une capture ordinaire classée et un item, sans passer par Gemini. Données fabriquées. */
export async function creerAction(
  prisma: PrismaClient,
  o: { texte?: string; type: string | null; date?: string; fin?: string; faitLe?: string; expr?: string; nature?: 'action' | 'pensee' | 'ambigu' },
): Promise<{ itemId: string; captureId: string }> {
  const u = await prisma.utilisateur.upsert({ where: { nom: 'test' }, create: { nom: 'test' }, update: {} });
  const c = await prisma.capture.create({
    data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', emisLe: new Date('2026-10-01T08:00:00Z'), texteEcrit: 'x' },
  });
  const nature = o.nature ?? 'action';
  const item = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: o.texte ?? 'appeler le garage', nature,
      confiance: { nature: 0.9, echeance: 0.9, theme: 0.9 }, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
      action: nature === 'action' ? {
        create: {
          echeanceType: o.type, echeanceExpr: o.expr ?? null,
          echeanceDate: o.date ? new Date(o.date) : null,
          fenetreFin: o.fin ? new Date(o.fin) : null,
          faitLe: o.faitLe ? new Date(o.faitLe) : null,
        },
      } : undefined,
      pensee: nature === 'pensee' ? { create: {} } : undefined,
    },
  });
  return { itemId: item.id, captureId: c.id };
}
```

- [ ] **Step 2: Écrire les tests des vues**

`apps/api/test/vues.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { VuesService } from '../src/vues/vues.service.js';
import { creerAction } from './aides-items.js';

const prisma = creerPrisma();
const vues = new VuesService(prisma);
const PARIS = 'Europe/Paris';
const MAINTENANT = new Date('2026-10-06T06:00:00Z'); // mardi 6 octobre, 8 h à Paris
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

describe('aujourdhui', () => {
  it('montre les actions du jour civil local, triées, sans les faites ni les passées', async () => {
    await creerAction(prisma, { texte: 'b', type: 'datee', date: '2026-10-06T14:00:00+02:00' });
    await creerAction(prisma, { texte: 'a', type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'faite', type: 'jour', date: '2026-10-06T00:00:00+02:00', faitLe: '2026-10-06T05:00:00Z' });
    await creerAction(prisma, { texte: 'hier', type: 'jour', date: '2026-10-05T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'demain', type: 'jour', date: '2026-10-07T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'pensée', type: null, nature: 'pensee' });
    const v = await vues.aujourdhui(MAINTENANT, PARIS);
    expect(v.jour).toBe('2026-10-06');
    expect(v.actions.map((a) => a.texte)).toEqual(['a', 'b']);
  });

  it('ajoute au plus 3 suggestions de fenêtres proches, sans dépasser 7 lignes', async () => {
    for (let i = 0; i < 5; i++) await creerAction(prisma, { texte: `jour${i}`, type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    for (let i = 0; i < 4; i++) await creerAction(prisma, { texte: `fen${i}`, type: 'fenetre', fin: `2026-10-1${i}T23:59:00+02:00` });
    await creerAction(prisma, { texte: 'loin', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00' });
    const v = await vues.aujourdhui(MAINTENANT, PARIS);
    expect(v.actions).toHaveLength(5);
    expect(v.suggestions.map((a) => a.texte)).toEqual(['fen0', 'fen1']);
  });

  it('le jour du passage à l\'heure d\'hiver couvre exactement le jour civil', async () => {
    await creerAction(prisma, { texte: 'minuit', type: 'jour', date: '2026-10-25T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'soir', type: 'datee', date: '2026-10-25T23:30:00+01:00' });
    await creerAction(prisma, { texte: 'lendemain', type: 'jour', date: '2026-10-26T00:00:00+01:00' });
    const v = await vues.aujourdhui(new Date('2026-10-25T10:00:00Z'), PARIS);
    expect(v.actions.map((a) => a.texte)).toEqual(['minuit', 'soir']);
  });

  it('une ligne porte le thème, l\'audio et aucune mention de retard', async () => {
    await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const [l] = (await vues.aujourdhui(MAINTENANT, PARIS)).actions;
    expect(Object.keys(l!).sort()).toEqual(['aAudio', 'alarme', 'captureId', 'echeanceDate', 'echeanceExpr', 'echeanceType', 'fenetreFin', 'itemId', 'texte', 'theme']);
  });
});

describe('semaine et horizons', () => {
  it('semaine groupe par jour civil sur 7 jours', async () => {
    await creerAction(prisma, { texte: 'mar', type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'jeu', type: 'datee', date: '2026-10-08T09:00:00+02:00' });
    await creerAction(prisma, { texte: 'lun+', type: 'jour', date: '2026-10-13T00:00:00+02:00' });
    const v = await vues.semaine(MAINTENANT, PARIS);
    expect(v.jours.map((j) => [j.jour, j.actions.map((a) => a.texte)])).toEqual([['2026-10-06', ['mar']], ['2026-10-08', ['jeu']]]);
  });

  it('horizons groupe les fenêtres par borne, la plus proche d\'abord', async () => {
    await creerAction(prisma, { texte: 'cadeaux', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00', expr: 'avant Noël' });
    await creerAction(prisma, { texte: 'sapin', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00', expr: 'avant Noël' });
    await creerAction(prisma, { texte: 'costume', type: 'fenetre', fin: '2026-10-31T23:59:00+01:00', expr: 'avant Halloween' });
    await creerAction(prisma, { texte: 'passée', type: 'fenetre', fin: '2026-10-01T23:59:00+02:00' });
    const v = await vues.horizons(MAINTENANT, PARIS);
    expect(v.bornes.map((b) => [b.libelle, b.actions.map((a) => a.texte).sort()])).toEqual([
      ['avant Halloween', ['costume']], ['avant Noël', ['cadeaux', 'sapin']],
    ]);
  });

  it('une vue ne dépasse jamais 20 lignes', async () => {
    for (let i = 0; i < 25; i++) await creerAction(prisma, { type: 'fenetre', fin: '2026-11-01T00:00:00+01:00' });
    const v = await vues.horizons(MAINTENANT, PARIS);
    expect(v.bornes.flatMap((b) => b.actions)).toHaveLength(20);
  });
});

describe('a revoir', () => {
  it('liste les items ambigus et les captures ordinaires à revoir, jamais les privées', async () => {
    await creerAction(prisma, { texte: 'vendredi ou samedi', type: null, nature: 'ambigu' });
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'test' } });
    await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'a_revoir', emisLe: new Date(), texteBrut: 'inaudible' } });
    await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    const v = await vues.aRevoir();
    expect(v.items.map((i) => i.texte)).toEqual(['vendredi ou samedi']);
    expect(v.captures.map((c) => c.texte)).toEqual(['inaudible']);
  });
});
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm test -- apps/api/test/vues.test.ts`
Expected: FAIL, `vues.service.js` introuvable.

- [ ] **Step 4: Écrire les types partagés**

`packages/shared/src/api.ts` : les interfaces de la section Interfaces ci-dessus, telles quelles, chacune précédée de `export`.
Dans `packages/shared/src/index.ts`, ajouter `export * from './api.js';`.

- [ ] **Step 5: Écrire le service**

`apps/api/src/vues/vues.service.ts` :
```ts
import type { Prisma, PrismaClient } from '@organizer/db';
import {
  ajouterJours, debutJour, jourLocal,
  type CaptureARevoir, type ItemARevoir, type LigneAction,
  type VueARevoir, type VueAujourdhui, type VueHorizons, type VueSemaine,
} from '@organizer/shared';

const MAX_AUJOURDHUI = 7;
const MAX_SUGGESTIONS = 3;
const HORIZON_SUGGESTIONS_JOURS = 14;
const MAX_LISTE = 20;
const TYPES_DATES = ['datee', 'jour', 'relative'];

const ouvertes = { nature: 'action', archiveLe: null, action: { is: { faitLe: null } } } satisfies Prisma.ItemWhereInput;
const inclure = { action: true, theme: true, capture: { select: { audioPath: true } } } satisfies Prisma.ItemInclude;
type ItemComplet = Prisma.ItemGetPayload<{ include: typeof inclure }>;

function ligne(it: ItemComplet): LigneAction {
  return {
    itemId: it.id,
    captureId: it.captureId,
    texte: it.texte,
    theme: it.theme?.libelle ?? null,
    echeanceType: it.action?.echeanceType ?? null,
    echeanceExpr: it.action?.echeanceExpr ?? null,
    echeanceDate: it.action?.echeanceDate?.toISOString() ?? null,
    fenetreFin: it.action?.fenetreFin?.toISOString() ?? null,
    alarme: it.action?.alarme ?? false,
    aAudio: it.capture.audioPath !== null,
  };
}

export class VuesService {
  constructor(private readonly prisma: PrismaClient) {}

  private datees(debut: Date, fin: Date, max: number): Promise<ItemComplet[]> {
    return this.prisma.item.findMany({
      where: { ...ouvertes, action: { is: { faitLe: null, echeanceType: { in: TYPES_DATES }, echeanceDate: { gte: debut, lt: fin } } } },
      include: inclure, orderBy: { action: { echeanceDate: 'asc' } }, take: max,
    });
  }

  private fenetres(debut: Date, fin: Date | undefined, max: number): Promise<ItemComplet[]> {
    return this.prisma.item.findMany({
      where: { ...ouvertes, action: { is: { faitLe: null, echeanceType: 'fenetre', fenetreFin: { gte: debut, ...(fin ? { lt: fin } : {}) } } } },
      include: inclure, orderBy: { action: { fenetreFin: 'asc' } }, take: max,
    });
  }

  async aujourdhui(maintenant: Date, fuseau: string): Promise<VueAujourdhui> {
    const jour = jourLocal(maintenant, fuseau);
    const debut = debutJour(jour, fuseau);
    const actions = await this.datees(debut, debutJour(ajouterJours(jour, 1), fuseau), MAX_AUJOURDHUI);
    const place = Math.min(MAX_SUGGESTIONS, MAX_AUJOURDHUI - actions.length);
    const suggestions = place > 0
      ? await this.fenetres(debut, debutJour(ajouterJours(jour, HORIZON_SUGGESTIONS_JOURS), fuseau), place)
      : [];
    return { jour, actions: actions.map(ligne), suggestions: suggestions.map(ligne) };
  }

  async semaine(maintenant: Date, fuseau: string): Promise<VueSemaine> {
    const jour = jourLocal(maintenant, fuseau);
    const items = await this.datees(debutJour(jour, fuseau), debutJour(ajouterJours(jour, 7), fuseau), MAX_LISTE);
    const jours = new Map<string, LigneAction[]>();
    for (const it of items) {
      const j = jourLocal(it.action!.echeanceDate!, fuseau);
      jours.set(j, [...(jours.get(j) ?? []), ligne(it)]);
    }
    return { jours: [...jours].map(([j, actions]) => ({ jour: j, actions })) };
  }

  async horizons(maintenant: Date, fuseau: string): Promise<VueHorizons> {
    const items = await this.fenetres(debutJour(jourLocal(maintenant, fuseau), fuseau), undefined, MAX_LISTE);
    const bornes = new Map<string, { libelle: string | null; actions: LigneAction[] }>();
    for (const it of items) {
      const fin = it.action!.fenetreFin!.toISOString();
      const b = bornes.get(fin) ?? { libelle: it.action!.echeanceExpr, actions: [] };
      b.actions.push(ligne(it));
      bornes.set(fin, b);
    }
    return { bornes: [...bornes].map(([fin, b]) => ({ fin, ...b })) };
  }

  async aRevoir(): Promise<VueARevoir> {
    const items = await this.prisma.item.findMany({
      where: { nature: 'ambigu', archiveLe: null },
      include: { capture: { select: { emisLe: true, audioPath: true } } },
      orderBy: { capture: { emisLe: 'desc' } }, take: MAX_LISTE,
    });
    const captures = await this.prisma.capture.findMany({
      where: { etat: 'a_revoir', prive: false }, orderBy: { emisLe: 'desc' }, take: MAX_LISTE,
    });
    return {
      items: items.map((i): ItemARevoir => ({
        itemId: i.id, captureId: i.captureId, texte: i.texte,
        emisLe: i.capture.emisLe.toISOString(), aAudio: i.capture.audioPath !== null,
      })),
      captures: captures.map((c): CaptureARevoir => ({
        captureId: c.id, texte: c.texteBrut ?? c.texteEcrit, emisLe: c.emisLe.toISOString(), aAudio: c.audioPath !== null,
      })),
    };
  }
}
```

- [ ] **Step 6: Écrire le contrôleur et le câbler**

Dans `apps/api/src/jetons.ts`, ajouter `export const VUES = Symbol('VUES');`.

`apps/api/src/vues/vues.controller.ts` :
```ts
import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { VueARevoir, VueAujourdhui, VueHorizons, VueSemaine } from '@organizer/shared';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { VUES } from '../jetons.js';
import type { VuesService } from './vues.service.js';

@Controller('api/vues')
@UseGuards(SessionGuard)
export class VuesController {
  constructor(@Inject(VUES) private readonly vues: VuesService) {}

  @Get('aujourdhui')
  aujourdhui(@Req() req: RequeteAuthentifiee): Promise<VueAujourdhui> {
    return this.vues.aujourdhui(new Date(), req.utilisateur.fuseau);
  }

  @Get('semaine')
  semaine(@Req() req: RequeteAuthentifiee): Promise<VueSemaine> {
    return this.vues.semaine(new Date(), req.utilisateur.fuseau);
  }

  @Get('horizons')
  horizons(@Req() req: RequeteAuthentifiee): Promise<VueHorizons> {
    return this.vues.horizons(new Date(), req.utilisateur.fuseau);
  }

  @Get('a-revoir')
  aRevoir(): Promise<VueARevoir> {
    return this.vues.aRevoir();
  }
}
```

Dans `apps/api/src/app.module.ts` : ajouter `VuesController` aux contrôleurs et le fournisseur
`{ provide: VUES, inject: [PRISMA], useFactory: (prisma: PrismaClient) => new VuesService(prisma) },`.

Ajouter à `apps/api/test/vues.test.ts` un test HTTP du garde :
```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, VUES } from '../src/jetons.js';
import { VuesController } from '../src/vues/vues.controller.js';
import { demarrerAppTest } from './aides-http.js';

describe('/api/vues', () => {
  it('exige une session', async () => {
    class M {}
    Module({ controllers: [VuesController], providers: [
      { provide: VUES, useValue: vues }, { provide: AUTH, useValue: new AuthService(prisma) }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      expect((await fetch(`${app.url}/api/vues/aujourdhui`)).status).toBe(401);
    } finally {
      await app.fermer();
    }
  });
});
```
(regrouper les imports en tête de fichier.)

- [ ] **Step 7: Lancer les tests**

Run: `pnpm test -- apps/api/test/vues.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les vues Aujourd'hui, Cette semaine, Horizons et À revoir de l'API, communes aux deux comptes (2026-10-03). »
```bash
git add packages/shared apps/api CHANGELOG.md
git commit -m "Ajoute les vues Aujourd'hui, Cette semaine, Horizons et À revoir"   # + ligne vide + Co-Authored-By
```

---

### Task 4: Cocher, corriger, réécouter

**Files:**
- Create: `apps/api/src/items/items.service.ts`, `apps/api/src/items/items.controller.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/jetons.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/items.test.ts`

**Interfaces:**
- Consumes: `creerAction` (tâche 3), `valeursAdmises`, `chargerPrompt`, `NATURES`, `cheminDepuisRacine` (`@organizer/shared`), `SessionGuard`, `demarrerAppTest` (tâche 2).
- Produces :
  - `interface CorrectionItem { nature?: Nature; echeance?: { type: string; date?: string | null; debut?: string | null; fin?: string | null } }`
  - `class ItemIntrouvable extends Error`, `class CorrectionInvalide extends Error`
  - `class ItemsService { constructor(prisma, typesEcheance: string[], maintenant?); cocher(itemId): Promise<void>; decocher(itemId): Promise<void>; corriger(itemId, c: CorrectionItem): Promise<void>; cheminAudio(captureId, racine): Promise<{ chemin: string; mime: string } | null> }`
  - `ConfigApi.typesEcheance: string[]` (lu dans le schéma de la version de prompt), jeton `ITEMS`
  - REST : `POST /api/items/:id/fait` → 204 ; `DELETE /api/items/:id/fait` → 204 ; `PATCH /api/items/:id` (corps `CorrectionItem`) → 204 ; `GET /api/captures/:id/audio` → le fichier, ou 404 `{ message: 'Audio indisponible.' }`. Item inconnu : 404 `{ message: 'Élément introuvable.' }`. Correction invalide : 400 avec le message français de l'erreur.

Règles :
- Cocher pose `faitLe` (un seul geste ; l'annulation sous 10 s se fait par `DELETE`, que la PWA appelle). Cocher deux fois ne change pas la première date.
- Corriger écrit une ligne `correction` par champ modifié (`nature`, `echeance`), avec l'ancienne et la nouvelle valeur.
- Passer en `action` crée la ligne `action` si elle manque, sans échéance ; passer en `pensee` crée la ligne `pensee` si elle manque.
- Une échéance ne se pose que sur une action. Son type doit figurer dans `typesEcheance`. `datee`, `jour` et `relative` exigent `date` ; `fenetre` exige `fin` ; `aucune` vide tout. Un type inconnu du code mais admis par le schéma garde les champs fournis.
- Les dates sont des chaînes ISO 8601 avec fuseau.
- L'audio se sert pour toute capture qui en a un, privée comprise (les deux comptes se voient, décision 8). Un audio purgé renvoie 404.

- [ ] **Step 1: Écrire les tests**

`apps/api/test/items.test.ts` :
```ts
import 'reflect-metadata';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CorrectionInvalide, ItemIntrouvable, ItemsService } from '../src/items/items.service.js';
import { VuesService } from '../src/vues/vues.service.js';
import { creerAction } from './aides-items.js';

const prisma = creerPrisma();
const TYPES = ['datee', 'jour', 'fenetre', 'relative', 'aucune'];
const service = new ItemsService(prisma, TYPES, () => new Date('2026-10-06T07:00:00Z'));
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

describe('cocher', () => {
  it('pose faitLe une fois ; décocher l\'efface', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await service.cocher(itemId);
    await new ItemsService(prisma, TYPES, () => new Date('2026-10-06T09:00:00Z')).cocher(itemId);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).faitLe?.toISOString()).toBe('2026-10-06T07:00:00.000Z');
    await service.decocher(itemId);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).faitLe).toBeNull();
  });

  it('refuse un item inconnu ou qui n\'est pas une action', async () => {
    const { itemId } = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(service.cocher('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(ItemIntrouvable);
    await expect(service.cocher(itemId)).rejects.toBeInstanceOf(ItemIntrouvable);
  });
});

describe('corriger', () => {
  it('une pensée corrigée en action puis datée apparaît dans Aujourd\'hui, avec deux corrections', async () => {
    const { itemId } = await creerAction(prisma, { texte: 'rappeler', type: null, nature: 'pensee' });
    await service.corriger(itemId, { nature: 'action' });
    await service.corriger(itemId, { echeance: { type: 'jour', date: '2026-10-06T00:00:00+02:00' } });
    const v = await new VuesService(prisma).aujourdhui(new Date('2026-10-06T06:00:00Z'), 'Europe/Paris');
    expect(v.actions.map((a) => a.texte)).toEqual(['rappeler']);
    const corrections = await prisma.correction.findMany({ where: { itemId } });
    expect(corrections.map((c) => c.champ).sort()).toEqual(['echeance', 'nature']);
    expect(corrections.find((c) => c.champ === 'nature')).toMatchObject({ ancienneValeur: 'pensee', nouvelleValeur: 'action' });
  });

  it('une fenêtre exige une fin ; aucune vide les dates', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await expect(service.corriger(itemId, { echeance: { type: 'fenetre' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await service.corriger(itemId, { echeance: { type: 'aucune' } });
    expect(await prisma.action.findUniqueOrThrow({ where: { itemId } })).toMatchObject({
      echeanceType: 'aucune', echeanceDate: null, fenetreDebut: null, fenetreFin: null,
    });
  });

  it('refuse un type absent du schéma, une échéance sur une pensée, une date sans fuseau', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const pensee = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(service.corriger(itemId, { echeance: { type: 'bientot' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(service.corriger(pensee.itemId, { echeance: { type: 'jour', date: '2026-10-07T00:00:00+02:00' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(service.corriger(itemId, { echeance: { type: 'jour', date: '2026-10-07T00:00:00' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    expect(await prisma.correction.count()).toBe(0);
  });
});

describe('cheminAudio', () => {
  it('renvoie le fichier et son type, ou null si l\'audio est purgé', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'audio-'));
    const { captureId } = await creerAction(prisma, { type: null, nature: 'pensee' });
    expect(await service.cheminAudio(captureId, racine)).toBeNull();
    mkdirSync(join(racine, 'ordinaire'), { recursive: true });
    writeFileSync(join(racine, 'ordinaire', 'a.oga'), 'OggS');
    await prisma.capture.update({ where: { id: captureId }, data: { audioPath: 'ordinaire/a.oga', audioMime: 'audio/ogg' } });
    expect(await service.cheminAudio(captureId, racine)).toEqual({ chemin: join(racine, 'ordinaire', 'a.oga'), mime: 'audio/ogg' });
  });
});
```

- [ ] **Step 2: Lancer pour voir échouer**

Run: `pnpm test -- apps/api/test/items.test.ts`
Expected: FAIL, `items.service.js` introuvable.

- [ ] **Step 3: Écrire le service**

`apps/api/src/items/items.service.ts` :
```ts
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@organizer/db';
import type { Nature } from '@organizer/shared';

export interface CorrectionItem {
  nature?: Nature;
  echeance?: { type: string; date?: string | null; debut?: string | null; fin?: string | null };
}

export class ItemIntrouvable extends Error {
  override name = 'ItemIntrouvable';
}

export class CorrectionInvalide extends Error {
  override name = 'CorrectionInvalide';
}

const TYPES_DATES = ['datee', 'jour', 'relative'];

function date(valeur: string | null | undefined): Date | null {
  if (valeur === null || valeur === undefined) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(valeur) || Number.isNaN(Date.parse(valeur))) {
    throw new CorrectionInvalide('Date attendue au format ISO, avec fuseau.');
  }
  return new Date(valeur);
}

function colonnes(e: NonNullable<CorrectionItem['echeance']>) {
  if (e.type === 'aucune') return { echeanceType: 'aucune', echeanceDate: null, fenetreDebut: null, fenetreFin: null };
  const c = { echeanceType: e.type, echeanceDate: date(e.date), fenetreDebut: date(e.debut), fenetreFin: date(e.fin) };
  if (TYPES_DATES.includes(e.type) && !c.echeanceDate) throw new CorrectionInvalide('Cette échéance demande une date.');
  if (e.type === 'fenetre' && !c.fenetreFin) throw new CorrectionInvalide('Une fenêtre demande une date de fin.');
  return c;
}

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

export class ItemsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly typesEcheance: string[],
    private readonly maintenant: () => Date = () => new Date(),
  ) {}

  async cocher(itemId: string): Promise<void> {
    await this.exigerAction(itemId);
    await this.prisma.action.updateMany({ where: { itemId, faitLe: null }, data: { faitLe: this.maintenant() } });
  }

  async decocher(itemId: string): Promise<void> {
    await this.exigerAction(itemId);
    await this.prisma.action.update({ where: { itemId }, data: { faitLe: null } });
  }

  async corriger(itemId: string, c: CorrectionItem): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const it = await tx.item.findUnique({ where: { id: itemId }, include: { action: true, pensee: true } });
      if (!it) throw new ItemIntrouvable(itemId);
      const nature = c.nature ?? it.nature;
      if (c.nature && c.nature !== it.nature) {
        await tx.item.update({ where: { id: itemId }, data: { nature: c.nature } });
        await tx.correction.create({ data: { itemId, champ: 'nature', ancienneValeur: it.nature, nouvelleValeur: c.nature } });
        if (c.nature === 'action' && !it.action) await tx.action.create({ data: { itemId } });
        if (c.nature === 'pensee' && !it.pensee) await tx.pensee.create({ data: { itemId } });
      }
      if (c.echeance) {
        if (nature !== 'action') throw new CorrectionInvalide('Seule une action a une échéance.');
        if (!this.typesEcheance.includes(c.echeance.type)) throw new CorrectionInvalide("Type d'échéance inconnu.");
        const nouvelle = colonnes(c.echeance);
        const a = await tx.action.findUnique({ where: { itemId } });
        await tx.action.upsert({ where: { itemId }, create: { itemId, ...nouvelle }, update: nouvelle });
        await tx.correction.create({
          data: {
            itemId, champ: 'echeance',
            ancienneValeur: a
              ? { type: a.echeanceType, date: iso(a.echeanceDate), debut: iso(a.fenetreDebut), fin: iso(a.fenetreFin) }
              : Prisma.JsonNull,
            nouvelleValeur: {
              type: nouvelle.echeanceType, date: iso(nouvelle.echeanceDate),
              debut: iso(nouvelle.fenetreDebut), fin: iso(nouvelle.fenetreFin),
            },
          },
        });
      }
    });
  }

  async cheminAudio(captureId: string, racine: string): Promise<{ chemin: string; mime: string } | null> {
    const c = await this.prisma.capture.findUnique({ where: { id: captureId }, select: { audioPath: true, audioMime: true } });
    if (!c?.audioPath) return null;
    return { chemin: join(racine, c.audioPath), mime: c.audioMime ?? 'application/octet-stream' };
  }

  private async exigerAction(itemId: string): Promise<void> {
    const it = await this.prisma.item.findUnique({ where: { id: itemId }, include: { action: true } });
    if (!it || it.nature !== 'action' || !it.action) throw new ItemIntrouvable(itemId);
  }
}
```

- [ ] **Step 4: Lancer les tests du service**

Run: `pnpm test -- apps/api/test/items.test.ts`
Expected: PASS.

- [ ] **Step 5: Écrire le contrôleur et la configuration**

Dans `apps/api/src/config.ts` : ajouter `typesEcheance: string[];` à `ConfigApi`, et dans `lireConfigApi` :
```ts
    typesEcheance: valeursAdmises(
      chargerPrompt(cheminDepuisRacine(lireVar('PROMPTS_DIR') ?? 'prompts'), lireVar('PROMPT_VERSION') ?? 'tri/v1'),
      'echeance_type',
    ),
```
(importer `chargerPrompt` et `valeursAdmises` depuis `@organizer/shared`).

Dans `apps/api/src/jetons.ts`, ajouter `export const ITEMS = Symbol('ITEMS');`.

`apps/api/src/items/items.controller.ts` :
```ts
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Res, UseGuards,
} from '@nestjs/common';
import { NATURES } from '@organizer/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { ConfigApi } from '../config.js';
import { CONFIG, ITEMS } from '../jetons.js';
import { CorrectionInvalide, ItemIntrouvable, type ItemsService } from './items.service.js';

const dateOuNul = z.string().max(40).nullable().optional();
const schemaCorrection = z.object({
  nature: z.enum(NATURES).optional(),
  echeance: z.object({ type: z.string().max(40), date: dateOuNul, debut: dateOuNul, fin: dateOuNul }).optional(),
}).refine((c) => c.nature !== undefined || c.echeance !== undefined);

async function traduire<T>(appel: () => Promise<T>): Promise<T> {
  try {
    return await appel();
  } catch (e) {
    if (e instanceof ItemIntrouvable) throw new NotFoundException('Élément introuvable.');
    if (e instanceof CorrectionInvalide) throw new BadRequestException(e.message);
    throw e;
  }
}

@Controller('api')
@UseGuards(SessionGuard)
export class ItemsController {
  constructor(@Inject(ITEMS) private readonly items: ItemsService, @Inject(CONFIG) private readonly config: ConfigApi) {}

  @Post('items/:id/fait')
  @HttpCode(204)
  cocher(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return traduire(() => this.items.cocher(id));
  }

  @Delete('items/:id/fait')
  @HttpCode(204)
  decocher(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return traduire(() => this.items.decocher(id));
  }

  @Patch('items/:id')
  @HttpCode(204)
  corriger(@Param('id', ParseUUIDPipe) id: string, @Body() corps: unknown): Promise<void> {
    const p = schemaCorrection.safeParse(corps);
    if (!p.success) throw new BadRequestException('Correction illisible.');
    return traduire(() => this.items.corriger(id, p.data));
  }

  @Get('captures/:id/audio')
  async audio(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const a = await this.items.cheminAudio(id, this.config.audioRacine);
    if (!a) throw new NotFoundException('Audio indisponible.');
    res.type(a.mime).sendFile(a.chemin, (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: 'Audio indisponible.' });
    });
  }
}
```

Dans `apps/api/src/app.module.ts` : ajouter `ItemsController` aux contrôleurs et le fournisseur
`{ provide: ITEMS, inject: [CONFIG, PRISMA], useFactory: (c: ConfigApi, prisma: PrismaClient) => new ItemsService(prisma, c.typesEcheance) },`.

Ajouter à `apps/api/test/items.test.ts` un test HTTP :
```ts
describe('/api/items', () => {
  it('cocher exige une session et traduit un item inconnu en 404', async () => {
    const auth = new AuthService(prisma);
    await prisma.utilisateur.create({ data: { nom: 'l' } });
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    class M {}
    Module({ controllers: [ItemsController], providers: [
      { provide: ITEMS, useValue: service }, { provide: CONFIG, useValue: { audioRacine: tmpdir() } },
      { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      const url = `${app.url}/api/items/00000000-0000-4000-8000-000000000000/fait`;
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      const r = await fetch(url, { method: 'POST', headers: { cookie: `${NOM_COOKIE}=${s!.jeton}` } });
      expect(r.status).toBe(404);
      expect((await r.json()).message).toBe('Élément introuvable.');
    } finally {
      await app.fermer();
    }
  });
});
```
(imports à ajouter : `Module` de `@nestjs/common`, `AuthService`, `NOM_COOKIE`, `SessionGuard`, `ItemsController`, `AUTH`, `CONFIG`, `ITEMS`, `demarrerAppTest`.)

- [ ] **Step 6: Lancer les tests**

Run: `pnpm test -- apps/api && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Cocher et décocher une action, corriger la nature ou l'échéance d'un item avec historique, réécouter l'audio d'origine (2026-10-03). »
```bash
git add apps/api CHANGELOG.md
git commit -m "Ajoute le cochage, la correction et la réécoute"   # + ligne vide + Co-Authored-By
```

---

### Task 5: Captures privées par la PWA

**Files:**
- Create: `apps/api/src/privees/reencodeur.ts`, `apps/api/src/privees/privees.service.ts`, `apps/api/src/privees/privees.controller.ts`
- Modify: `apps/api/src/jetons.ts`, `apps/api/src/app.module.ts`, `CHANGELOG.md`
- Test: `apps/api/test/reencodeur.test.ts`, `apps/api/test/privees.test.ts`

**Interfaces:**
- Consumes: `StockageAudio` (lot 1-A : `ecrire(id, emisLe, donnees, extension, 'ordinaire' | 'prive'): Promise<string>`), `jourLocal`, `debutJour`, `ajouterJours`, `isoLocal`, `SessionGuard`, `demarrerAppTest`, `configurerApp` (raw sur `POST /api/captures/privees`).
- Produces :
  - `interface Reencodeur { versOpus(donnees: Buffer): Promise<Buffer> }`, `class ReencodeurFfmpeg implements Reencodeur { constructor(binaire?: string, delaiMs?: number) }`, `class AudioIllisible extends Error`
  - `const FORMATS_ACCEPTES: string[]`, `class FormatRefuse extends Error`
  - `interface DepotPrive { id: string; donnees: Buffer; mime: string; emisLe: Date; dureeS: number | null }`
  - `interface JourPrive { jour: string; captures: { id: string; heure: string; dureeS: number | null; etiquette: string | null }[] }`
  - `class CapturesPriveesService { constructor(prisma, stockage: StockageAudio, reencodeur: Reencodeur); enregistrer(utilisateurId: string, d: DepotPrive): Promise<{ id: string; nouvelle: boolean }>; etiqueter(id: string, etiquette: string | null): Promise<void>; lister(mois: string, fuseau: string): Promise<JourPrive[]> }` (et `JourPrive` ajouté à `packages/shared/src/api.ts`)
  - jeton `PRIVEES`
  - REST : `POST /api/captures/privees` (corps : l'audio brut ; en-têtes `Content-Type`, `X-Capture-Id` (UUID facultatif, pour rejouer sans doublon), `X-Emis-Le` (ISO facultatif), `X-Duree-S` (entier facultatif)) → 201 `{ id }`, ou 200 `{ id }` si déjà reçue ; 415 `{ message: 'Format audio non pris en charge.' }` ; 422 `{ message: 'Enregistrement illisible.' }` ; 400 `{ message: 'Enregistrement vide.' }`. `PATCH /api/captures/privees/:id` `{ etiquette: string | null }` (80 caractères au plus) → 204. `GET /api/captures/privees?mois=AAAA-MM` → `JourPrive[]`, les plus récents d'abord.

Règles :
- La capture est créée en **une seule écriture** avec `prive = true, etat = 'privee', canal = 'pwa'`, audio déjà réencodé et rangé dans `prive/` (Opus dans un conteneur Ogg, `audioMime = 'audio/ogg'`). Elle n'est jamais transcrite ni enfilée.
- Formats acceptés (partie avant `;` du `Content-Type`) : `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-wav`, `video/webm`.
- `X-Emis-Le` dans le futur de plus de 5 minutes, ou illisible : on prend l'heure de réception. `X-Duree-S` hors de 0 à 3600, ou illisible : nul.
- Rejouer le même `X-Capture-Id` renvoie 200, sans réencoder ni réécrire. Un identifiant qui désigne une capture ordinaire est refusé (400).
- Aucun texte de capture n'existe pour une privée : rien à journaliser au-delà de l'identifiant.

- [ ] **Step 1: Installer ffmpeg (contrôleur)**

Run: `brew install ffmpeg && ffmpeg -hide_banner -encoders | grep -c libopus`
Expected: `1`.

- [ ] **Step 2: Écrire les tests du réencodeur**

`apps/api/test/reencodeur.test.ts` :
```ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AudioIllisible, ReencodeurFfmpeg } from '../src/privees/reencodeur.js';

/** Une seconde de bip, en WebM/Opus comme MediaRecorder sur Chrome Android. Fabriquée, aucune voix. */
const webm = (): Buffer => execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-c:a', 'libopus', '-f', 'webm', 'pipe:1',
]);

describe('ReencodeurFfmpeg', () => {
  it('produit de l\'Opus dans un conteneur Ogg', async () => {
    const sortie = await new ReencodeurFfmpeg().versOpus(webm());
    expect(sortie.subarray(0, 4).toString()).toBe('OggS');
  });

  it('refuse des octets qui ne sont pas de l\'audio', async () => {
    await expect(new ReencodeurFfmpeg().versOpus(Buffer.from('pas de l\'audio'))).rejects.toBeInstanceOf(AudioIllisible);
  });

  it('signale un binaire absent', async () => {
    await expect(new ReencodeurFfmpeg('ffmpeg-inexistant').versOpus(webm())).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Écrire les tests du service et de la route**

`apps/api/test/privees.test.ts` :
```ts
import 'reflect-metadata';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { AUTH, PRIVEES } from '../src/jetons.js';
import { PriveesController } from '../src/privees/privees.controller.js';
import { CapturesPriveesService, FormatRefuse } from '../src/privees/privees.service.js';
import type { Reencodeur } from '../src/privees/reencodeur.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

class FauxReencodeur implements Reencodeur {
  appels = 0;
  async versOpus(): Promise<Buffer> {
    this.appels++;
    return Buffer.from('OggS-faux');
  }
}

let racine: string;
let reencodeur: FauxReencodeur;
let service: CapturesPriveesService;
let utilisateurId: string;
const ID = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

beforeEach(async () => {
  await viderBase(prisma);
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  reencodeur = new FauxReencodeur();
  service = new CapturesPriveesService(prisma, new StockageAudio(racine), reencodeur);
  utilisateurId = (await prisma.utilisateur.create({ data: { nom: 'l' } })).id;
});

const depot = (o: Partial<{ id: string; mime: string }> = {}) => ({
  id: o.id ?? ID, donnees: Buffer.from('webm'), mime: o.mime ?? 'audio/webm',
  emisLe: new Date('2026-10-06T06:12:00Z'), dureeS: 14,
});

describe('CapturesPriveesService', () => {
  it('crée en une écriture une capture privée, audio réencodé rangé dans prive/', async () => {
    expect(await service.enregistrer(utilisateurId, depot())).toEqual({ id: ID, nouvelle: true });
    const c = await prisma.capture.findUniqueOrThrow({ where: { id: ID } });
    expect(c).toMatchObject({ prive: true, etat: 'privee', canal: 'pwa', audioMime: 'audio/ogg', dureeS: 14, texteBrut: null });
    expect(c.audioPath).toBe(`prive/2026/10/${ID}.ogg`);
    expect(existsSync(join(racine, c.audioPath!))).toBe(true);
  });

  it('rejouer le même identifiant ne crée rien et ne réencode pas', async () => {
    await service.enregistrer(utilisateurId, depot());
    expect(await service.enregistrer(utilisateurId, depot())).toEqual({ id: ID, nouvelle: false });
    expect(reencodeur.appels).toBe(1);
    expect(await prisma.capture.count()).toBe(1);
  });

  it('refuse un format hors liste, avant tout réencodage', async () => {
    await expect(service.enregistrer(utilisateurId, depot({ mime: 'image/png' }))).rejects.toBeInstanceOf(FormatRefuse);
    expect(reencodeur.appels).toBe(0);
  });

  it('refuse un identifiant qui désigne une capture ordinaire', async () => {
    await prisma.capture.create({ data: { id: ID, utilisateurId, canal: 'telegram', prive: false, etat: 'recue', emisLe: new Date() } });
    await expect(service.enregistrer(utilisateurId, depot())).rejects.toThrow();
  });

  it('étiquette, puis liste par jour local, les plus récents d\'abord', async () => {
    await service.enregistrer(utilisateurId, depot());
    await service.enregistrer(utilisateurId, { ...depot({ id: '4a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d' }), emisLe: new Date('2026-10-06T22:30:00Z') });
    await service.etiqueter(ID, 'garage');
    const mois = await service.lister('2026-10', 'Europe/Paris');
    expect(mois.map((j) => j.jour)).toEqual(['2026-10-07', '2026-10-06']);
    expect(mois[1]!.captures).toEqual([{ id: ID, heure: '08:12', dureeS: 14, etiquette: 'garage' }]);
  });
});

describe('/api/captures/privees', () => {
  it('reçoit l\'audio brut, rejoue sans doublon, refuse un format inconnu', async () => {
    const auth = new AuthService(prisma);
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    class M {}
    Module({ controllers: [PriveesController], providers: [
      { provide: PRIVEES, useValue: service }, { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      const envoyer = (type: string) => fetch(`${app.url}/api/captures/privees`, {
        method: 'POST',
        headers: { cookie: `${NOM_COOKIE}=${s!.jeton}`, 'content-type': type, 'x-capture-id': ID, 'x-duree-s': '14' },
        body: Buffer.from('webm'),
      });
      const a = await envoyer('audio/webm;codecs=opus');
      expect(a.status).toBe(201);
      expect(await a.json()).toEqual({ id: ID });
      expect((await envoyer('audio/webm')).status).toBe(200);
      const c = await envoyer('image/png');
      expect(c.status).toBe(415);
      expect((await c.json()).message).toBe('Format audio non pris en charge.');
    } finally {
      await app.fermer();
    }
  });
});
```

- [ ] **Step 4: Lancer pour voir échouer**

Run: `pnpm test -- apps/api/test/reencodeur.test.ts apps/api/test/privees.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 5: Écrire le réencodeur**

`apps/api/src/privees/reencodeur.ts` :
```ts
import { spawn } from 'node:child_process';

export interface Reencodeur {
  versOpus(donnees: Buffer): Promise<Buffer>;
}

export class AudioIllisible extends Error {
  override name = 'AudioIllisible';
}

/** Réencode n'importe quel audio en Opus 32 kbit/s dans un conteneur Ogg. */
export class ReencodeurFfmpeg implements Reencodeur {
  constructor(private readonly binaire = 'ffmpeg', private readonly delaiMs = 60_000) {}

  versOpus(donnees: Buffer): Promise<Buffer> {
    return new Promise((resoudre, rejeter) => {
      const p = spawn(this.binaire, [
        '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
      const morceaux: Buffer[] = [];
      const minuterie = setTimeout(() => p.kill('SIGKILL'), this.delaiMs);
      p.stdout.on('data', (b: Buffer) => morceaux.push(b));
      p.on('error', (e) => {
        clearTimeout(minuterie);
        rejeter(e);
      });
      p.on('close', (code) => {
        clearTimeout(minuterie);
        if (code === 0 && morceaux.length > 0) resoudre(Buffer.concat(morceaux));
        else rejeter(new AudioIllisible(`ffmpeg : code ${code}`));
      });
      // EPIPE si ffmpeg abandonne avant la fin de l'entrée : l'erreur arrive par « close ».
      p.stdin.on('error', () => undefined);
      p.stdin.end(donnees);
    });
  }
}
```

- [ ] **Step 6: Écrire le service**

Ajouter à `packages/shared/src/api.ts` :
```ts
export interface JourPrive {
  jour: string;
  captures: { id: string; heure: string; dureeS: number | null; etiquette: string | null }[];
}
```

`apps/api/src/privees/privees.service.ts` :
```ts
import { Prisma, type PrismaClient } from '@organizer/db';
import { ajouterJours, debutJour, isoLocal, jourLocal, type JourPrive } from '@organizer/shared';
import type { StockageAudio } from '../ingestion/stockage.js';
import type { Reencodeur } from './reencodeur.js';

export const FORMATS_ACCEPTES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/webm'];

export class FormatRefuse extends Error {
  override name = 'FormatRefuse';
}

export interface DepotPrive { id: string; donnees: Buffer; mime: string; emisLe: Date; dureeS: number | null }

export class CapturesPriveesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stockage: StockageAudio,
    private readonly reencodeur: Reencodeur,
  ) {}

  async enregistrer(utilisateurId: string, d: DepotPrive): Promise<{ id: string; nouvelle: boolean }> {
    if (!FORMATS_ACCEPTES.includes(d.mime)) throw new FormatRefuse(d.mime);
    const existante = await this.prisma.capture.findUnique({ where: { id: d.id }, select: { prive: true } });
    if (existante) {
      if (!existante.prive) throw new Error(`Capture ${d.id} ordinaire : identifiant refusé`);
      return { id: d.id, nouvelle: false };
    }
    const opus = await this.reencodeur.versOpus(d.donnees);
    const audioPath = await this.stockage.ecrire(d.id, d.emisLe, opus, 'ogg', 'prive');
    try {
      // Une seule écriture : la capture naît privée (règle n° 6), avec son audio.
      await this.prisma.capture.create({
        data: {
          id: d.id, utilisateurId, canal: 'pwa', prive: true, etat: 'privee',
          audioPath, audioMime: 'audio/ogg', dureeS: d.dureeS, emisLe: d.emisLe,
        },
      });
      return { id: d.id, nouvelle: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { id: d.id, nouvelle: false };
      throw e;
    }
  }

  async etiqueter(id: string, etiquette: string | null): Promise<void> {
    const r = await this.prisma.capture.updateMany({ where: { id, prive: true }, data: { etiquette } });
    if (r.count === 0) throw new Error(`Capture privée ${id} introuvable`);
  }

  async lister(mois: string, fuseau: string): Promise<JourPrive[]> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) throw new Error('Mois attendu au format AAAA-MM');
    const premier = `${mois}-01`;
    const suivant = ajouterJours(`${mois}-28`, 4).slice(0, 7) + '-01';
    const captures = await this.prisma.capture.findMany({
      where: { prive: true, emisLe: { gte: debutJour(premier, fuseau), lt: debutJour(suivant, fuseau) } },
      orderBy: { emisLe: 'desc' },
      select: { id: true, emisLe: true, dureeS: true, etiquette: true },
    });
    const jours = new Map<string, JourPrive['captures']>();
    for (const c of captures) {
      const jour = jourLocal(c.emisLe, fuseau);
      jours.set(jour, [...(jours.get(jour) ?? []), {
        id: c.id, heure: isoLocal(c.emisLe, fuseau).slice(11, 16), dureeS: c.dureeS, etiquette: c.etiquette,
      }]);
    }
    return [...jours].map(([jour, liste]) => ({ jour, captures: liste }));
  }
}
```

- [ ] **Step 7: Écrire le contrôleur et le câbler**

Dans `apps/api/src/jetons.ts`, ajouter `export const PRIVEES = Symbol('PRIVEES');`.

`apps/api/src/privees/privees.controller.ts` :
```ts
import { randomUUID } from 'node:crypto';
import {
  BadRequestException, Body, Controller, Get, HttpCode, HttpException, Inject, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import type { JourPrive } from '@organizer/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { PRIVEES } from '../jetons.js';
import { FormatRefuse, type CapturesPriveesService } from './privees.service.js';
import { AudioIllisible } from './reencodeur.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const schemaEtiquette = z.object({ etiquette: z.string().trim().max(80).nullable() });

function entete(req: RequeteAuthentifiee, nom: string): string | undefined {
  const v = req.headers[nom];
  return Array.isArray(v) ? v[0] : v;
}

function emisLe(valeur: string | undefined, maintenant: Date): Date {
  const d = valeur ? new Date(valeur) : maintenant;
  return Number.isNaN(d.getTime()) || d.getTime() > maintenant.getTime() + 5 * 60_000 ? maintenant : d;
}

function duree(valeur: string | undefined): number | null {
  const n = Number(valeur);
  return valeur !== undefined && Number.isInteger(n) && n >= 0 && n <= 3600 ? n : null;
}

@Controller('api/captures/privees')
@UseGuards(SessionGuard)
export class PriveesController {
  constructor(@Inject(PRIVEES) private readonly privees: CapturesPriveesService) {}

  @Post()
  async deposer(@Req() req: RequeteAuthentifiee, @Res({ passthrough: true }) res: Response): Promise<{ id: string }> {
    const corps: unknown = req.body;
    if (!Buffer.isBuffer(corps) || corps.length === 0) throw new BadRequestException('Enregistrement vide.');
    const idDemande = entete(req, 'x-capture-id');
    const id = idDemande && UUID.test(idDemande) ? idDemande.toLowerCase() : randomUUID();
    const mime = (entete(req, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    try {
      const r = await this.privees.enregistrer(req.utilisateur.id, {
        id, donnees: corps, mime, emisLe: emisLe(entete(req, 'x-emis-le'), new Date()), dureeS: duree(entete(req, 'x-duree-s')),
      });
      res.status(r.nouvelle ? 201 : 200);
      return { id: r.id };
    } catch (e) {
      if (e instanceof FormatRefuse) throw new HttpException({ message: 'Format audio non pris en charge.' }, 415);
      if (e instanceof AudioIllisible) throw new HttpException({ message: 'Enregistrement illisible.' }, 422);
      if (e instanceof Error && e.message.includes('ordinaire')) throw new BadRequestException('Identifiant refusé.');
      throw e;
    }
  }

  @Patch(':id')
  @HttpCode(204)
  async etiqueter(@Param('id', ParseUUIDPipe) id: string, @Body() corps: unknown): Promise<void> {
    const p = schemaEtiquette.safeParse(corps);
    if (!p.success) throw new BadRequestException('Étiquette de 80 caractères au plus.');
    try {
      await this.privees.etiqueter(id, p.data.etiquette || null);
    } catch {
      throw new NotFoundException('Élément introuvable.');
    }
  }

  @Get()
  async lister(@Req() req: RequeteAuthentifiee, @Query('mois') mois: string | undefined): Promise<JourPrive[]> {
    try {
      return await this.privees.lister(mois ?? new Date().toISOString().slice(0, 7), req.utilisateur.fuseau);
    } catch {
      throw new BadRequestException('Mois attendu au format AAAA-MM.');
    }
  }
}
```

Dans `apps/api/src/app.module.ts` : ajouter `PriveesController` aux contrôleurs et le fournisseur
`{ provide: PRIVEES, inject: [CONFIG, PRISMA], useFactory: (c: ConfigApi, prisma: PrismaClient) => new CapturesPriveesService(prisma, new StockageAudio(c.audioRacine), new ReencodeurFfmpeg()) },`.

- [ ] **Step 8: Lancer les tests**

Run: `pnpm test -- apps/api && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Les captures privées par la PWA : audio réencodé en Opus et gardé sur le serveur, jamais transcrit ni classé, étiquette facultative, liste par jour (2026-10-03). »
```bash
git add packages/shared apps/api CHANGELOG.md
git commit -m "Reçoit les captures privées de la PWA"   # + ligne vide + Co-Authored-By
```

---

### Task 6: « Prochaine capture privée » dans Telegram

**Files:**
- Modify: `apps/api/src/ingestion/ingestion.service.ts`, `apps/api/src/telegram/bot.ts`, `README.md`, `CHANGELOG.md`
- Test: `apps/api/test/ingestion.test.ts` (ajouts), `apps/api/test/bot.test.ts` (ajouts et adaptations)

**Interfaces:**
- Consumes: `utilisateur.prochainePrivee` (tâche 1) ; `IngestionService` du lot 1-A.
- Produces :
  - `IngestionService.recevoir(utilisateurId, e): Promise<{ id: string; nouvelle: boolean; prive: boolean }>`. Le champ `prive` est ajouté. La capture est privée si et seulement si le drapeau était armé : consommation du drapeau et création dans la même transaction.
  - `IngestionService.armerPrivee(utilisateurId: string): Promise<void>`
  - `IngestionService.finaliserPrivee(id: string): Promise<void>` : télécharge et range dans `prive/`, n'enfile jamais.
  - `IngestionService.reprendre()` reprend aussi les captures privées Telegram sans audio.
  - Bot : `LIBELLE_PRIVEE = 'Prochaine capture privée'` (bouton de clavier persistant, envoyé avec le message de liaison réussie) ; réponses `La prochaine capture reste sur le serveur.` et `Reçu. Elle reste sur le serveur.`

Règles :
- Le bouton arme le drapeau du compte. La capture suivante, vocal ou texte, est créée `prive = true, etat = 'privee', canal = 'telegram'`, avec le drapeau consommé **dans la même transaction**. Si la création échoue, le drapeau revient et la relivraison de Telegram retrouve le même mode.
- Une relivraison d'une capture privée déjà reçue trouve la capture existante (`sourceRef`) : aucun nouvel accusé, aucun enfilage.
- `finaliser` (ordinaire) continue de refuser une capture privée.
- L'audio privé Telegram n'est pas réencodé : c'est déjà de l'Opus.

- [ ] **Step 1: Écrire les tests d'ingestion**

Ajouter à `apps/api/test/ingestion.test.ts` :
```ts
describe('prochaine capture privée', () => {
  it('le drapeau armé rend la capture suivante privée, une seule fois', async () => {
    await service.armerPrivee(utilisateurId);
    const a = await service.recevoir(utilisateurId, vocal('tg:7:1'));
    const b = await service.recevoir(utilisateurId, vocal('tg:7:2'));
    expect([a.prive, b.prive]).toEqual([true, false]);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ prive: true, etat: 'privee', canal: 'telegram' });
    expect((await prisma.utilisateur.findUniqueOrThrow({ where: { id: utilisateurId } })).prochainePrivee).toBe(false);
  });

  it('une création en échec rend le drapeau ; la relivraison reste privée', async () => {
    await service.armerPrivee(utilisateurId);
    await service.recevoir(utilisateurId, vocal('tg:7:1'));
    await service.armerPrivee(utilisateurId);
    // Même référence : la création échoue (P2002), la transaction rend le drapeau.
    const relivree = await service.recevoir(utilisateurId, vocal('tg:7:1'));
    expect(relivree).toMatchObject({ nouvelle: false, prive: true });
    expect((await prisma.utilisateur.findUniqueOrThrow({ where: { id: utilisateurId } })).prochainePrivee).toBe(true);
  });

  it('finaliserPrivee range l\'audio dans prive/ et n\'enfile jamais', async () => {
    await service.armerPrivee(utilisateurId);
    const { id } = await service.recevoir(utilisateurId, vocal());
    await service.finaliserPrivee(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c.audioPath).toBe(`prive/2026/10/${id}.oga`);
    expect(c.etat).toBe('privee');
    expect(file.ids).toEqual([]);
    await expect(service.finaliser(id)).rejects.toThrow('privée');
  });

  it('reprendre télécharge les privées restées sans audio, sans les enfiler', async () => {
    await service.armerPrivee(utilisateurId);
    const { id } = await service.recevoir(utilisateurId, vocal());
    expect(await service.reprendre(new Date(Date.now() + 5 * 60_000))).toBe(1);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).audioPath).not.toBeNull();
    expect(file.ids).toEqual([]);
  });
});
```
Dans le même fichier, le test existant « recevoir est idempotent sur la référence Telegram » attend désormais `{ id: a.id, nouvelle: false, prive: false }`.

- [ ] **Step 2: Écrire les tests du bot**

Dans `apps/api/test/bot.test.ts`, le faux `ingestion` de `monter` reçoit trois méthodes de plus et `recevoir` renvoie `prive`. Remplacer l'objet `ingestion` par :
```ts
  let arme = false;
  const privees: string[] = [];
  const ingestion = {
    recevoir: async (_u: string, e: CaptureEntrante) => {
      const nouvelle = !recues.includes(e.sourceRef);
      recues.push(e.sourceRef);
      const prive = nouvelle && arme;
      if (prive) arme = false;
      return { id: 'c1', nouvelle, prive };
    },
    finaliser: async (id: string) => { finalisees.push(id); },
    finaliserPrivee: async (id: string) => { privees.push(id); },
    armerPrivee: async () => { arme = true; },
  } as unknown as IngestionService;
```
et renvoyer `privees` dans l'objet de `monter`. Ajouter :
```ts
  it('le bouton arme la capture privée ; la suivante est accusée comme privée, jamais finalisée en ordinaire', async () => {
    const { bot, envois, finalisees, privees } = monter(true);
    await bot.handleUpdate(maj(1, { text: 'Prochaine capture privée' }));
    expect(envois[0]!.payload.text).toBe('La prochaine capture reste sur le serveur.');
    await bot.handleUpdate(maj(2, { voice: { file_id: 'F', file_unique_id: 'U', duration: 3 } }));
    expect(envois[1]!.payload.text).toBe('Reçu. Elle reste sur le serveur.');
    await new Promise((r) => setImmediate(r));
    expect(privees).toEqual(['c1']);
    expect(finalisees).toEqual([]);
  });

  it('la liaison réussie envoie le clavier avec le bouton privé', async () => {
    const { bot, envois } = monter(false);
    await bot.handleUpdate(maj(1, { text: '/start 123456', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    expect(JSON.stringify(envois[0]!.payload.reply_markup)).toContain('Prochaine capture privée');
  });
```

- [ ] **Step 3: Lancer pour voir échouer**

Run: `pnpm test -- apps/api/test/ingestion.test.ts apps/api/test/bot.test.ts`
Expected: FAIL (`armerPrivee` absent, `prive` absent).

- [ ] **Step 4: Écrire l'ingestion**

Dans `apps/api/src/ingestion/ingestion.service.ts`, remplacer `recevoir` par :
```ts
  /**
   * Étape 1, avant l'accusé de réception : la capture existe en base. Idempotent.
   * Si « prochaine capture privée » est armé, le drapeau est consommé dans la même transaction
   * que la création : un échec le rend, la relivraison retrouve le même mode (règle n° 6).
   */
  async recevoir(utilisateurId: string, e: CaptureEntrante): Promise<{ id: string; nouvelle: boolean; prive: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const consomme = await tx.utilisateur.updateMany({
          where: { id: utilisateurId, prochainePrivee: true }, data: { prochainePrivee: false },
        });
        const prive = consomme.count === 1;
        const c = await tx.capture.create({
          data: {
            utilisateurId, canal: 'telegram', prive, etat: prive ? 'privee' : 'recue',
            sourceRef: e.sourceRef, sourceFichier: e.fichier?.id ?? null, audioMime: e.fichier?.mime ?? null,
            dureeS: e.dureeS, texteEcrit: e.texte, emisLe: e.emisLe,
          },
          select: { id: true },
        });
        return { id: c.id, nouvelle: true, prive };
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      const c = await this.prisma.capture.findUniqueOrThrow({ where: { sourceRef: e.sourceRef }, select: { id: true, prive: true } });
      return { id: c.id, nouvelle: false, prive: c.prive };
    }
  }

  async armerPrivee(utilisateurId: string): Promise<void> {
    await this.prisma.utilisateur.update({ where: { id: utilisateurId }, data: { prochainePrivee: true } });
  }

  /** Range l'audio d'une capture privée Telegram dans prive/. Jamais enfilée. Rejouable. */
  async finaliserPrivee(id: string): Promise<void> {
    const c = await this.prisma.capture.findUniqueOrThrow({ where: { id } });
    if (!c.prive) throw new Error(`Capture ${id} ordinaire : pas de rangement privé`);
    if (c.audioPath || !c.sourceFichier) return;
    const f = await this.telechargeur.telecharger(c.sourceFichier);
    const audioPath = await this.stockage.ecrire(c.id, c.emisLe, f.donnees, f.extension, 'prive');
    await this.prisma.capture.update({ where: { id }, data: { audioPath } });
  }
```
Dans `reprendre`, après la boucle existante, ajouter :
```ts
    const privees = await this.prisma.capture.findMany({
      where: {
        prive: true, canal: 'telegram', audioPath: null, sourceFichier: { not: null },
        recuLe: { lt: new Date(maintenant.getTime() - 2 * 60_000) },
      },
      orderBy: { emisLe: 'asc' }, select: { id: true },
    });
    for (const { id } of privees) {
      try {
        await this.finaliserPrivee(id);
        n++;
      } catch (e) {
        this.journal(`Capture ${id} : rangement privé reporté (${(e as Error).name})`);
      }
    }
```

- [ ] **Step 5: Écrire le bot**

Dans `apps/api/src/telegram/bot.ts` :
- importer `Keyboard` depuis `grammy` ;
- ajouter en tête :
```ts
export const LIBELLE_PRIVEE = 'Prochaine capture privée';
const clavier = (): Keyboard => new Keyboard().text(LIBELLE_PRIVEE).resized().persistent();
```
- dans `/start`, la réponse de succès devient :
```ts
    if (r === 'lie') {
      await ctx.reply("C'est lié. Envoie un vocal quand tu veux.", { reply_markup: clavier() });
      return;
    }
    await ctx.reply('Code invalide ou expiré.');
```
- dans `bot.on('message')`, juste après la vérification du compte lié :
```ts
    if (ctx.message.text === LIBELLE_PRIVEE) {
      await d.ingestion.armerPrivee(u.id);
      await ctx.reply('La prochaine capture reste sur le serveur.');
      return;
    }
```
- après `recevoir`, remplacer l'accusé et la finalisation par :
```ts
    const { id, nouvelle, prive } = await d.ingestion.recevoir(u.id, e);
    if (!nouvelle) return;
    await ctx.reply(prive ? 'Reçu. Elle reste sur le serveur.' : 'Reçu.', { reply_parameters: { message_id: ctx.message.message_id } });
    // Pas d'attente : l'accusé part avant le téléchargement (CAP-03). La reprise rattrape un échec.
    const suite = prive ? d.ingestion.finaliserPrivee(id) : d.ingestion.finaliser(id);
    void suite.catch((err: unknown) => {
      console.error(`Capture ${id} : finalisation reportée (${(err as Error).name})`);
    });
```

- [ ] **Step 6: Mettre à jour le README**

Dans `README.md`, section qui décrit l'API, ajouter un paragraphe « Mode privé » qui dit, en phrases courtes :
- une capture faite par le bouton privé de la PWA, ou après le bouton « Prochaine capture privée » de Telegram, reste sur le serveur ;
- elle n'est jamais transcrite, jamais classée, jamais envoyée à Gemini ;
- on la retrouve par date et heure, avec une étiquette facultative.

Ajouter aussi la commande `pnpm --filter @organizer/api cli mot-de-passe <nom>` et la liste des routes `/api` des tâches 2 à 5. Vérifier chaque commande citée.

- [ ] **Step 7: Lancer toute la suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commiter**

Ligne de `CHANGELOG.md`, rubrique Ajouté : « Le bouton « Prochaine capture privée » du bot : la capture suivante reste sur le serveur, sans transcription ni classement (2026-10-03). »
```bash
git add apps/api README.md CHANGELOG.md
git commit -m "Ajoute la prochaine capture privée dans Telegram"   # + ligne vide + Co-Authored-By
```

---

## Hors de ce plan

- **Plan 1-B2** : la PWA SvelteKit (vues, cochage avec annulation 10 s, correction en deux gestes, enregistreur privé, raccourci Android, file hors ligne IndexedDB et Background Sync, vue Privé par calendrier).
- Vues Rapide, Fils, Pensées, recherche, Reporter : absentes de la liste du lot 1 dans le cahier (lots 2 et 3).
- Basculer un item ordinaire en privé après coup (cahier, « Le bouton privé ») : reporté, il faut d'abord trancher le sort de la transcription déjà faite.
- Plan 1-C : image avec ffmpeg, en-têtes de sécurité (CSP) au proxy, `trust proxy` vérifié derrière le Nginx Proxy Manager réel.
