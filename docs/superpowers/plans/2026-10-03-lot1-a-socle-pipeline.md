# Lot 1-A — Socle et pipeline de capture : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un vocal ou un texte envoyé au bot Telegram est accusé, stocké, classé par Gemini et écrit en base sous forme d'items, de façon idempotente, sans qu'une capture privée puisse jamais atteindre Gemini.

**Architecture:** Monorepo pnpm. `packages/shared` porte le chargement des prompts versionnés et le schéma Zod dérivé de `response-schema.json`, pour que les types d'échéance et les thèmes restent des données (décision 21). `packages/db` porte le schéma Prisma et deux garde-fous SQL sur le mode privé. `apps/api` (NestJS + grammY) reçoit, accuse, stocke et enfile. `apps/worker` (process Node + BullMQ) appelle Gemini derrière `ClassificationProvider` et écrit les items.

**Tech Stack:** Node 22 LTS, TypeScript strict (ESM, NodeNext), pnpm, NestJS 11, grammY 1.x, Prisma 6, PostgreSQL 17 + pgvector, BullMQ 5 sur Valkey 8, Zod 4, Vitest 3. API Gemini en REST (`fetch`).

**Spec:** `docs/cahier-des-charges.md` (sections Capture, Pipeline de traitement, Modèle de données, Sécurité), `docs/decisions.md`, `CLAUDE.md`.

**Suite du lot 1, plans séparés écrits après celui-ci :**
- **1-B — PWA et mode privé :** comptes et sessions, REST de lecture, vues Aujourd'hui, Cette semaine, Horizons, Rapide, À revoir, cochage, correction, enregistreur privé, raccourci Android, vue Privé.
- **1-C — Déploiement et supervision :** Dockerfiles, CI GHCR, `infra/docker-compose.yml`, webhook Telegram, proxy sortant, sondes, retrait du banc d'essai.

## Global Constraints

- Node 22 LTS ; NestJS 11 ; Prisma 6 ; PostgreSQL 17 + pgvector (`pgvector/pgvector:0.8.0-pg17`) ; Valkey 8 (`valkey/valkey:8.1-alpine`) ; grammY 1.x.
- Modèle `gemini-3.1-flash-lite` par défaut, `gemini-3.8-flash` en repli sur échec de schéma. Température 0,2. Sortie `responseMimeType: application/json` + `responseSchema`.
- TypeScript strict, aucun `any` implicite. Imports relatifs suffixés `.js` (NodeNext).
- Toute sortie de modèle est validée par un schéma Zod avant écriture en base.
- Le fournisseur d'IA est derrière `ClassificationProvider`. Basculer de modèle reste une affaire de configuration.
- Chaque item stocke `version_prompt` et `modele`.
- Thèmes, types d'échéance, importance, effort, contexte, tonalité : **jamais en enum dans le code ni en base**. Les valeurs admises viennent du `response-schema.json` de la version de prompt. Seule `nature` est figée (`action`, `pensee`, `information`, `ambigu` : règle produit n° 1).
- Messages visibles par l'utilisatrice : français, tutoiement, moins de 12 mots, aucun emoji, aucun prénom réel.
- Accusé de réception Telegram en moins de 2 s, sans attendre le téléchargement ni le classement (CAP-03).
- Horodatage à l'émission, pas à la réception (CAP-05). Fuseau `Europe/Paris` par défaut.
- Toute tâche de traitement est idempotente et rejouable sans doublon.
- Une capture privée n'entre jamais dans la file et n'atteint jamais Gemini, quel que soit le chemin de code (CAP-09, règle n° 6).
- **Aucun contenu de capture dans les journaux** : ni texte, ni transcription, ni corps de requête Gemini. Identifiants et noms d'erreur seulement.
- Crédit Gemini épuisé (HTTP 402) : captures gardées en file, ni `a_revoir` ni relance, une alerte à l'administrateur seul.
- Le worker refuse de démarrer si le palier Gemini n'est pas payé (règle n° 8).
- Dépôt public : aucun secret, aucune capture réelle, aucun prénom réel dans le code, les tests ou les fixtures.
- NestJS : **toujours injecter par jeton explicite** (`@Inject(JETON)`). `tsx` et Vitest n'émettent pas les métadonnées de décorateurs.

## Review Focus

1. **Telegram relivre la même mise à jour** (redémarrage, webhook rejoué) : une seule capture, un seul « Reçu. ». Test : tâche 7, `recevoir` deux fois ; tâche 8, deux `handleUpdate` identiques.
2. **Gemini renvoie une date sans secondes, en `Z`, ou un texte vide** (blocage de sécurité) : la date valide est acceptée, le texte vide part en `a_revoir` sans planter. Tests : tâche 2 (dates), tâche 4 (texte vide).
3. **Le worker meurt au milieu d'un classement puis rejoue le job** : aucun item en double. Test : tâche 5, rejeu après remise à `en_file`.
4. **Message transféré depuis une autre conversation** : `emis_le` est la date d'origine, pas celle du transfert. Test : tâche 7.
5. **Crédit épuisé au milieu d'un rattrapage** : les captures restent en file, aucune ne passe en `a_revoir`, une seule alerte. Test : tâche 6.

---

## Structure des fichiers

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, eslint.config.js
infra/dev/compose.yaml          Postgres + Valkey de dev, sur la VM Docker
infra/dev/tunnel.sh             démarre la stack de dev et ouvre le tunnel SSH
packages/shared/src/
  config.ts                     lireVar / exigerVar (X ou X_FILE)
  dates.ts                      isoLocal, jourSemaine
  tri.ts                        types TriSortie, zodDepuisSchema, chargerPrompt, rendrePrompt, normaliser
  files.ts                      noms de files BullMQ, charges utiles, options de job
  index.ts
packages/db/
  prisma/schema.prisma
  prisma/migrations/…_init/migration.sql   (+ garde-fous privés en SQL)
  src/index.ts                  creerPrisma
  src/test.ts                   viderBase (tests uniquement)
apps/worker/src/
  classement/provider.ts        ClassificationProvider + erreurs typées
  classement/gemini.ts          GeminiProvider (REST)
  classement/traiter.ts         traiterCapture : capture -> items
  worker.ts                     demarrerWorker, reprendre
  main.ts                       démarrage
apps/api/src/
  ingestion/extraire.ts         message Telegram -> CaptureEntrante
  ingestion/stockage.ts         StockageAudio
  ingestion/ingestion.service.ts recevoir, finaliser, reprendre
  ingestion/file.ts             FileClassementBullmq
  telegram/liaison.service.ts   codes de liaison chat <-> compte
  telegram/bot.ts               creerBot (grammY)
  telegram/telegram.controller.ts webhook
  alertes.ts                    consommateur des alertes admin
  config.ts, jetons.ts, app.module.ts, main.ts, cli.ts
```

---

### Task 1: Socle du monorepo et base de dev distante

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js`
- Create: `infra/dev/compose.yaml`, `infra/dev/tunnel.sh`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/config.ts`
- Test: `packages/shared/test/config.test.ts`
- Modify: `.env.example`, `CLAUDE.md` (arborescence, commandes), `docs/cahier-des-charges.md:526` (ligne `@google/genai`)

**Interfaces:**
- Produces: `lireVar(nom: string, env?: NodeJS.ProcessEnv): string | undefined`, `exigerVar(nom: string, env?: NodeJS.ProcessEnv): string` exportés par `@organizer/shared`.
- Produces: tunnel local `127.0.0.1:55432` (Postgres, utilisateur `organizer`, mot de passe `organizer`) et `127.0.0.1:56379` (Valkey).

- [ ] **Step 1: Installer pnpm**

Run: `brew install pnpm && pnpm -v`
Expected: un numéro de version (Node 26 n'embarque plus corepack).

- [ ] **Step 2: Écrire la racine du monorepo**

`pnpm-workspace.yaml` :
```yaml
packages:
  - apps/*
  - packages/*
```

`package.json` (remplacer `10.x.y` par la sortie de `pnpm -v`) :
```json
{
  "name": "organizer",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.x.y",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "pnpm --parallel --filter ./apps/* dev",
    "test": "pnpm --filter @organizer/db migrate:test && vitest run --no-file-parallelism",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "prisma": "pnpm --filter @organizer/db exec prisma"
  },
  "devDependencies": {
    "@types/node": "^22.18.0",
    "eslint": "^9.36.0",
    "typescript": "^5.9.0",
    "typescript-eslint": "^8.44.0",
    "vitest": "^3.2.0"
  }
}
```

`tsconfig.base.json` :
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts` :
```ts
import { defineConfig } from 'vitest/config';

// Base et file de test : la stack de dev de la VM, via infra/dev/tunnel.sh.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    env: {
      DATABASE_URL: 'postgresql://organizer:organizer@127.0.0.1:55432/organizer_test',
      REDIS_URL: 'redis://127.0.0.1:56379/1',
      TZ: 'Europe/Paris',
    },
    testTimeout: 15_000,
  },
});
```

`eslint.config.js` :
```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'infra/terrain/**', 'tools/**', 'design/**'] },
  ...tseslint.configs.recommended,
);
```

- [ ] **Step 3: Écrire la stack de dev distante**

`infra/dev/compose.yaml` :
```yaml
# Stack de dev et de test, sur la VM Docker. Ports liés à 127.0.0.1 de la VM,
# joints depuis le Mac par le tunnel SSH de tunnel.sh. Aucune donnée réelle.
name: organizer-dev

services:
  db:
    image: pgvector/pgvector:0.8.0-pg17
    environment:
      POSTGRES_USER: organizer
      POSTGRES_PASSWORD: organizer
      POSTGRES_DB: organizer
      TZ: Europe/Paris
    ports:
      - "127.0.0.1:55432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U organizer -d organizer"]
      interval: 5s
      timeout: 5s
      retries: 10

  queue:
    image: valkey/valkey:8.1-alpine
    ports:
      - "127.0.0.1:56379:6379"
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pgdata:
```

`infra/dev/tunnel.sh` :
```sh
#!/bin/sh
# Démarre Postgres et Valkey de dev sur la VM Docker, puis ouvre le tunnel SSH.
# Laisser tourner dans un terminal pendant le développement et les tests.
set -eu
HOTE="${ORGANIZER_SSH:-kix@192.168.1.201}"
ICI="$(cd "$(dirname "$0")" && pwd)"

ssh "$HOTE" 'mkdir -p ~/organizer-dev && cat > ~/organizer-dev/compose.yaml' < "$ICI/compose.yaml"
ssh "$HOTE" 'docker compose -f ~/organizer-dev/compose.yaml up -d --wait'
echo "Tunnel ouvert : Postgres 127.0.0.1:55432, Valkey 127.0.0.1:56379. Ctrl-C pour fermer."
exec ssh -N -o ExitOnForwardFailure=yes -L 55432:127.0.0.1:55432 -L 56379:127.0.0.1:56379 "$HOTE"
```

Run: `chmod +x infra/dev/tunnel.sh && infra/dev/tunnel.sh` (dans un terminal à part, `run_in_background` pour un agent)
Expected: `Tunnel ouvert : …`, puis `nc -z 127.0.0.1 55432 && nc -z 127.0.0.1 56379 && echo ok` affiche `ok`.

- [ ] **Step 4: Écrire le test de `config`**

`packages/shared/package.json` :
```json
{
  "name": "@organizer/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p ." },
  "dependencies": { "zod": "^4.1.0" }
}
```

`packages/shared/tsconfig.json` :
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/shared/test/config.test.ts` :
```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exigerVar, lireVar } from '../src/config.js';

describe('lireVar', () => {
  it('lit la variable directe', () => {
    expect(lireVar('CLE', { CLE: 'abc' })).toBe('abc');
  });

  it('préfère le fichier désigné par _FILE, sans retour à la ligne', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'secret');
    writeFileSync(f, 'depuis-fichier\n');
    expect(lireVar('CLE', { CLE: 'direct', CLE_FILE: f })).toBe('depuis-fichier');
  });

  it('traite une chaîne vide comme absente', () => {
    expect(lireVar('CLE', { CLE: '' })).toBeUndefined();
  });

  it('exigerVar nomme la variable manquante', () => {
    expect(() => exigerVar('CLE', {})).toThrow('CLE');
  });
});
```

- [ ] **Step 5: Lancer le test pour le voir échouer**

Run: `pnpm install && pnpm vitest run packages/shared/test/config.test.ts`
Expected: FAIL, `Cannot find module '../src/config.js'`.

- [ ] **Step 6: Écrire `config.ts` et l'index**

`packages/shared/src/config.ts` :
```ts
import { readFileSync } from 'node:fs';

/** Lit X, ou le contenu du fichier désigné par X_FILE (secrets Docker). */
export function lireVar(nom: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fichier = env[`${nom}_FILE`];
  if (fichier) return readFileSync(fichier, 'utf8').trim();
  const valeur = env[nom];
  return valeur === '' ? undefined : valeur;
}

export function exigerVar(nom: string, env: NodeJS.ProcessEnv = process.env): string {
  const valeur = lireVar(nom, env);
  if (!valeur) throw new Error(`Variable manquante : ${nom} (ou ${nom}_FILE)`);
  return valeur;
}
```

`packages/shared/src/index.ts` :
```ts
export * from './config.js';
```

- [ ] **Step 7: Lancer le test**

Run: `pnpm vitest run packages/shared/test/config.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Mettre à jour la documentation**

Dans `.env.example`, remplacer les deux premières URL et ajouter les variables du pipeline :
```
DATABASE_URL=postgresql://organizer:organizer@127.0.0.1:55432/organizer
REDIS_URL=redis://127.0.0.1:56379/0

# polling en dev (bot de dev distinct du bot de production), webhook en production
TELEGRAM_MODE=polling
PROMPTS_DIR=../../prompts
PROMPT_VERSION=tri/v1
# Valeurs de usageMetadata.serviceTier acceptées comme palier payé
GEMINI_TIERS_PAYES=standard
WORKER_CONCURRENCY=2
```

Dans `CLAUDE.md`, section Arborescence, ajouter après `packages/shared` :
```
packages/db       schéma Prisma, migrations, garde-fous SQL du mode privé
```
et après `infra/` :
```
infra/dev/        Postgres et Valkey de dev sur la VM Docker, tunnel SSH
```
Section Commandes, ajouter en tête du bloc :
```bash
infra/dev/tunnel.sh      # à laisser ouvert : base et file de dev/test sur la VM
```
et supprimer les lignes `pnpm test:prompt` et `docker compose -f infra/docker-compose.yml up -d` (le rejeu des fixtures arrive au branchement de fin de lot 1 ; la stack de prod relève du plan 1-C).

Dans `docs/cahier-des-charges.md`, ligne de la table Stack technique :
`| Transcription et tri | API Gemini, `@google/genai` | `gemini-3.1-flash-lite` | Audio natif, sortie JSON sous schéma, un seul appel |`
devient :
`| Transcription et tri | API Gemini en REST, sans SDK | `gemini-3.1-flash-lite` | Audio natif, sortie JSON sous schéma, un seul appel ; appel éprouvé par le banc d'essai, `serviceTier` lisible |`

- [ ] **Step 9: Vérifier et commiter**

Run: `pnpm typecheck && pnpm lint && git status --short`
Expected: aucune erreur ; aucun `.env` ni `data/` dans la liste.

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json vitest.config.ts eslint.config.js \
  infra/dev packages/shared .env.example CLAUDE.md docs/cahier-des-charges.md
git commit -m "Pose le socle du monorepo et la base de dev sur la VM"
```

---

### Task 2: Prompts versionnés et schéma de tri

**Files:**
- Create: `packages/shared/src/dates.ts`, `packages/shared/src/tri.ts`, `packages/shared/src/files.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/tri.test.ts`, `packages/shared/test/dates.test.ts`, `packages/shared/test/sortie-exemple.ts`

**Interfaces:**
- Consumes: `prompts/tri/v1/system.md`, `prompts/tri/v1/response-schema.json` (existants).
- Produces :
  - `NATURES`, `type Nature`, `interface ItemTri`, `interface TriSortie`, `interface ConfianceTri`
  - `interface Prompt { version: string; systeme: string; responseSchema: unknown; valider(sortie: unknown): TriSortie }`
  - `chargerPrompt(racine: string, version: string): Prompt`
  - `interface VariablesPrompt { emis_le: string; jour_semaine: string; fuseau: string; themes_connus: string[]; prenoms_connus: string[]; exemples: string }`
  - `rendrePrompt(systeme: string, v: VariablesPrompt): string`
  - `normaliser(s: TriSortie): TriSortie`, `normaliserTheme(t: string): string`
  - `isoLocal(date: Date, fuseau: string): string`, `jourSemaine(date: Date, fuseau: string): string`
  - `FILE_CLASSEMENT = 'classement'`, `FILE_ALERTES = 'alertes'`, `interface JobClassement { captureId: string }`, `interface JobAlerte { message: string }`, `OPTIONS_JOB_CLASSEMENT`
  - `sortieExemple(): TriSortie` dans `packages/shared/test/sortie-exemple.ts`, réutilisé par les tests des tâches 4 à 6.

- [ ] **Step 1: Écrire la sortie d'exemple fabriquée**

`packages/shared/test/sortie-exemple.ts` :
```ts
import type { TriSortie } from '../src/tri.js';

/** Sortie de tri fabriquée, conforme à tri/v1. Aucun énoncé réel. */
export function sortieExemple(): TriSortie {
  return {
    transcription: "rappeler le garage jeudi, et je crois que je dis oui trop vite",
    items: [
      {
        position: 1, texte: 'rappeler le garage jeudi', nature: 'action',
        echeance_type: 'jour', echeance_expr: 'jeudi', echeance_date: '2026-10-08T00:00:00+02:00',
        fenetre_debut: null, fenetre_fin: null, importance: 'normale', effort: 'moins_5min',
        contexte: 'appel', alarme: false, alarme_expr: null, tonalite: null,
        personnes: [], theme: 'Voiture', confiance: { nature: 0.95, echeance: 0.9, theme: 0.8 },
      },
      {
        position: 2, texte: 'je crois que je dis oui trop vite', nature: 'pensee',
        echeance_type: null, echeance_expr: null, echeance_date: null,
        fenetre_debut: null, fenetre_fin: null, importance: null, effort: null,
        contexte: null, alarme: null, alarme_expr: null, tonalite: 'constat',
        personnes: [], theme: 'moi', confiance: { nature: 0.9, echeance: null, theme: 0.85 },
      },
    ],
  };
}
```

- [ ] **Step 2: Écrire les tests de dates**

`packages/shared/test/dates.test.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { isoLocal, jourSemaine } from '../src/dates.js';

describe('dates', () => {
  it('isoLocal porte le décalage d\'été', () => {
    expect(isoLocal(new Date('2026-10-06T06:12:00Z'), 'Europe/Paris')).toBe('2026-10-06T08:12:00+02:00');
  });
  it('isoLocal porte le décalage d\'hiver', () => {
    expect(isoLocal(new Date('2026-12-01T09:00:00Z'), 'Europe/Paris')).toBe('2026-12-01T10:00:00+01:00');
  });
  it('isoLocal écrit +00:00 pour UTC', () => {
    expect(isoLocal(new Date('2026-12-01T09:00:00Z'), 'UTC')).toBe('2026-12-01T09:00:00+00:00');
  });
  it('jourSemaine en français, dans le fuseau', () => {
    expect(jourSemaine(new Date('2026-10-06T23:30:00Z'), 'Europe/Paris')).toBe('mercredi');
  });
});
```

- [ ] **Step 3: Écrire les tests du tri**

`packages/shared/test/tri.test.ts` :
```ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chargerPrompt, normaliser, normaliserTheme, rendrePrompt } from '../src/tri.js';
import { sortieExemple } from './sortie-exemple.js';

const PROMPTS = join(import.meta.dirname, '../../../prompts');
const v1 = () => chargerPrompt(PROMPTS, 'tri/v1');

describe('chargerPrompt tri/v1', () => {
  it('valide une sortie conforme', () => {
    expect(v1().valider(sortieExemple()).items).toHaveLength(2);
  });

  it('expose la version et le schéma tel que transmis à Gemini', () => {
    const p = v1();
    expect(p.version).toBe('tri/v1');
    expect(p.systeme).toContain('{{emis_le}}');
    expect(p.responseSchema).toHaveProperty('type', 'OBJECT');
  });

  it('refuse une nature hors liste', () => {
    const s = sortieExemple();
    (s.items[0] as { nature: string }).nature = 'tache';
    expect(() => v1().valider(s)).toThrow();
  });

  it('refuse un type d\'échéance absent du schéma de la version', () => {
    const s = sortieExemple();
    s.items[0]!.echeance_type = 'bientot';
    expect(() => v1().valider(s)).toThrow();
  });

  it('accepte une date sans secondes ou en Z', () => {
    const s = sortieExemple();
    s.items[0]!.echeance_date = '2026-10-08T10:00+02:00';
    s.items[0]!.fenetre_fin = '2026-12-24T23:00:00Z';
    expect(() => v1().valider(s)).not.toThrow();
  });

  it('refuse une date sans fuseau', () => {
    const s = sortieExemple();
    s.items[0]!.echeance_date = '2026-10-08T10:00:00';
    expect(() => v1().valider(s)).toThrow();
  });

  it('refuse un attribut obligatoire absent', () => {
    const s = sortieExemple() as unknown as { items: Record<string, unknown>[] };
    delete s.items[0]!.theme;
    expect(() => v1().valider(s)).toThrow();
  });

  it('refuse une version dont les natures diffèrent de la règle produit', () => {
    const racine = mkdtempSync(join(tmpdir(), 'prompts-'));
    cpSync(join(PROMPTS, 'tri/v1'), join(racine, 'tri/v9'), { recursive: true });
    const f = join(racine, 'tri/v9/response-schema.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"ambigu"]', '"ambigu", "rappel"]'));
    expect(() => chargerPrompt(racine, 'tri/v9')).toThrow('natures');
  });
});

describe('normaliser', () => {
  it('vide les attributs d\'action sur une pensée et la tonalité sur une action', () => {
    const s = sortieExemple();
    s.items[1]!.echeance_type = 'jour';
    s.items[0]!.tonalite = 'elan';
    const n = normaliser(s);
    expect(n.items[1]!.echeance_type).toBeNull();
    expect(n.items[0]!.tonalite).toBeNull();
  });

  it('retire l\'alarme d\'une action non datée', () => {
    const s = sortieExemple();
    s.items[0]!.alarme = true;
    s.items[0]!.alarme_expr = 'préviens-moi';
    const n = normaliser(s);
    expect(n.items[0]!.alarme).toBeNull();
    expect(n.items[0]!.alarme_expr).toBeNull();
  });

  it('renumérote les positions de 1 à n', () => {
    const s = sortieExemple();
    s.items[0]!.position = 7;
    s.items[1]!.position = 7;
    expect(normaliser(s).items.map((i) => i.position)).toEqual([1, 2]);
  });

  it('normaliserTheme retire accents, majuscules et espaces superflus', () => {
    expect(normaliserTheme('  Santé   Été ')).toBe('sante ete');
  });
});

describe('rendrePrompt', () => {
  it('remplace les variables et signale l\'absence de thèmes', () => {
    const r = rendrePrompt('{{emis_le}} {{themes_connus}} | {{prenoms_connus}} | {{inconnue}}', {
      emis_le: '2026-10-06T08:12:00+02:00', jour_semaine: 'mardi', fuseau: 'Europe/Paris',
      themes_connus: [], prenoms_connus: ['A', 'B'], exemples: '',
    });
    expect(r).toBe("2026-10-06T08:12:00+02:00 aucun pour l'instant | A, B | {{inconnue}}");
  });

  it('n\'interprète pas les motifs spéciaux de replace dans les valeurs', () => {
    const r = rendrePrompt('{{themes_connus}}', {
      emis_le: '', jour_semaine: '', fuseau: '', themes_connus: ['$&'], prenoms_connus: [], exemples: '',
    });
    expect(r).toBe('$&');
  });
});
```

- [ ] **Step 4: Lancer les tests pour les voir échouer**

Run: `pnpm vitest run packages/shared`
Expected: FAIL, modules `dates.js` et `tri.js` introuvables.

- [ ] **Step 5: Écrire `dates.ts`**

`packages/shared/src/dates.ts` :
```ts
/** Date ISO 8601 avec le décalage du fuseau, ex. 2026-10-06T08:12:00+02:00 */
export function isoLocal(date: Date, fuseau: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const decalage = p.timeZoneName === 'GMT' ? '+00:00' : (p.timeZoneName ?? 'GMT').replace('GMT', '');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${decalage}`;
}

export function jourSemaine(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long' }).format(date);
}
```

- [ ] **Step 6: Écrire `tri.ts`**

`packages/shared/src/tri.ts` :
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Seule énumération figée dans le code : la règle produit n° 1 en dépend. */
export const NATURES = ['action', 'pensee', 'information', 'ambigu'] as const;
export type Nature = (typeof NATURES)[number];

export interface ConfianceTri { nature: number; echeance: number | null; theme: number }

/** Les valeurs des champs texte sont admises par le response-schema de la version, pas par le code. */
export interface ItemTri {
  position: number;
  texte: string;
  nature: Nature;
  echeance_type: string | null;
  echeance_expr: string | null;
  echeance_date: string | null;
  fenetre_debut: string | null;
  fenetre_fin: string | null;
  importance: string | null;
  effort: string | null;
  contexte: string | null;
  alarme: boolean | null;
  alarme_expr: string | null;
  tonalite: string | null;
  personnes: string[];
  theme: string;
  confiance: ConfianceTri;
}

export interface TriSortie { transcription: string; items: ItemTri[] }

interface Noeud {
  type: string;
  nullable?: boolean;
  enum?: string[];
  format?: string;
  properties?: Record<string, Noeud>;
  required?: string[];
  items?: Noeud;
}

const dateIso = z.string().refine(
  (s) => /(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
  'date ISO 8601 avec fuseau attendue',
);

/** Traduit le sous-ensemble OpenAPI de responseSchema en schéma Zod. */
export function zodDepuisSchema(n: Noeud): z.ZodType {
  let s: z.ZodType;
  switch (n.type) {
    case 'OBJECT': {
      const requis = new Set(n.required ?? []);
      const forme: Record<string, z.ZodType> = {};
      for (const [cle, enfant] of Object.entries(n.properties ?? {})) {
        const zs = zodDepuisSchema(enfant);
        forme[cle] = requis.has(cle) ? zs : zs.optional();
      }
      s = z.object(forme);
      break;
    }
    case 'ARRAY':
      if (!n.items) throw new Error('ARRAY sans items dans le schéma');
      s = z.array(zodDepuisSchema(n.items));
      break;
    case 'STRING':
      s = n.enum ? z.enum(n.enum as [string, ...string[]]) : n.format === 'date-time' ? dateIso : z.string();
      break;
    case 'INTEGER':
      s = z.number().int();
      break;
    case 'NUMBER':
      s = z.number();
      break;
    case 'BOOLEAN':
      s = z.boolean();
      break;
    default:
      throw new Error(`Type de schéma non pris en charge : ${n.type}`);
  }
  return n.nullable ? s.nullable() : s;
}

export interface Prompt {
  version: string;
  systeme: string;
  responseSchema: unknown;
  valider(sortie: unknown): TriSortie;
}

export function chargerPrompt(racine: string, version: string): Prompt {
  const dossier = join(racine, version);
  const systeme = readFileSync(join(dossier, 'system.md'), 'utf8');
  const responseSchema = JSON.parse(readFileSync(join(dossier, 'response-schema.json'), 'utf8')) as Noeud;
  const natures = responseSchema.properties?.items?.items?.properties?.nature?.enum;
  if (JSON.stringify(natures) !== JSON.stringify(NATURES)) {
    throw new Error(`Prompt ${version} : natures attendues ${NATURES.join(', ')}`);
  }
  const schema = zodDepuisSchema(responseSchema);
  return { version, systeme, responseSchema, valider: (s) => normaliser(schema.parse(s) as TriSortie) };
}

export interface VariablesPrompt {
  emis_le: string;
  jour_semaine: string;
  fuseau: string;
  themes_connus: string[];
  prenoms_connus: string[];
  exemples: string;
}

export function rendrePrompt(systeme: string, v: VariablesPrompt): string {
  const aucun = "aucun pour l'instant";
  const valeurs: Record<string, string> = {
    emis_le: v.emis_le,
    jour_semaine: v.jour_semaine,
    fuseau: v.fuseau,
    themes_connus: v.themes_connus.join(', ') || aucun,
    prenoms_connus: v.prenoms_connus.join(', ') || aucun,
    exemples: v.exemples,
  };
  return systeme.replace(/\{\{(\w+)\}\}/g, (motif, cle: string) => valeurs[cle] ?? motif);
}

export function normaliserTheme(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const ATTRIBUTS_ACTION = [
  'echeance_type', 'echeance_expr', 'echeance_date', 'fenetre_debut', 'fenetre_fin',
  'importance', 'effort', 'contexte', 'alarme', 'alarme_expr',
] as const;

/** Applique les règles du prompt que le schéma ne peut pas exprimer. */
export function normaliser(s: TriSortie): TriSortie {
  return {
    transcription: s.transcription,
    items: s.items.map((it, i) => {
      const n: ItemTri = { ...it, position: i + 1, theme: normaliserTheme(it.theme) };
      if (n.nature !== 'action') {
        for (const k of ATTRIBUTS_ACTION) n[k] = null;
      } else if (n.echeance_type !== 'datee') {
        n.alarme = null;
        n.alarme_expr = null;
      }
      if (n.nature !== 'pensee') n.tonalite = null;
      return n;
    }),
  };
}
```

- [ ] **Step 7: Écrire `files.ts` et compléter l'index**

`packages/shared/src/files.ts` :
```ts
export const FILE_CLASSEMENT = 'classement';
export const FILE_ALERTES = 'alertes';

export interface JobClassement { captureId: string }
export interface JobAlerte { message: string }

/** Environ 16 minutes de reprises avant de passer la capture en a_transcrire. */
export const OPTIONS_JOB_CLASSEMENT = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;
```

`packages/shared/src/index.ts` :
```ts
export * from './config.js';
export * from './dates.js';
export * from './files.js';
export * from './tri.js';
```

- [ ] **Step 8: Lancer les tests**

Run: `pnpm vitest run packages/shared && pnpm typecheck`
Expected: PASS ; aucune erreur de type.

- [ ] **Step 9: Commiter**

```bash
git add packages/shared
git commit -m "Charge les prompts versionnés et valide la sortie de tri par leur schéma"
```

---

### Task 3: Schéma de base et garde-fous du mode privé

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`, `packages/db/src/test.ts`
- Create (généré puis complété) : `packages/db/prisma/migrations/<horodatage>_init/migration.sql`
- Test: `packages/db/test/capture.test.ts`

**Interfaces:**
- Produces: `creerPrisma(url?: string): PrismaClient` et tous les types `@prisma/client` réexportés par `@organizer/db` ; `viderBase(p: PrismaClient): Promise<void>` par `@organizer/db/test`.
- Produces (modèles Prisma, noms TypeScript) : `utilisateur { id, nom, telegramChatId: bigint | null, fuseau, admin }`, `codeLiaison { code, utilisateurId, expireLe }`, `capture { id, utilisateurId, canal: 'telegram'|'pwa', prive, sourceRef, sourceFichier, audioPath, audioMime, audioPurgeLe, dureeS, texteEcrit, texteBrut, emisLe, recuLe, etat, erreur, versionPrompt, modele, tokensEntree, tokensSortie, classeLe }`, `theme { id, libelle }`, `item { id, captureId, position, texte, nature, confiance, themeId, personnes, versionPrompt, modele, creeLe, archiveLe }`, `action { itemId, echeanceType, echeanceExpr, echeanceDate, fenetreDebut, fenetreFin, importance, effort, contexte, alarme, alarmeExpr, faitLe, reporteN }`, `pensee { itemId, tonalite }`, `correction { id, itemId, champ, ancienneValeur, nouvelleValeur, corrigeLe }`.
- États de capture : `recue`, `en_file`, `a_transcrire`, `classee`, `a_revoir`, `privee`.

- [ ] **Step 1: Écrire le paquet et le schéma**

`packages/db/package.json` :
```json
{
  "name": "@organizer/db",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts", "./test": "./src/test.ts" },
  "scripts": {
    "postinstall": "prisma generate",
    "typecheck": "tsc --noEmit -p .",
    "migrate:test": "DATABASE_URL=postgresql://organizer:organizer@127.0.0.1:55432/organizer_test prisma migrate reset --force --skip-generate --skip-seed"
  },
  "dependencies": { "@prisma/client": "^6.16.0" },
  "devDependencies": { "prisma": "^6.16.0" }
}
```

`packages/db/tsconfig.json` :
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/db/prisma/schema.prisma` :
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Canal {
  telegram
  pwa
}

enum EtatCapture {
  recue
  en_file
  a_transcrire
  classee
  a_revoir
  privee
}

/// Seule énumération métier figée : règle produit n° 1.
enum Nature {
  action
  pensee
  information
  ambigu
}

model Utilisateur {
  id             String        @id @default(uuid()) @db.Uuid
  nom            String        @unique
  telegramChatId BigInt?       @unique @map("telegram_chat_id")
  fuseau         String        @default("Europe/Paris")
  admin          Boolean       @default(false)
  creeLe         DateTime      @default(now()) @map("cree_le")
  captures       Capture[]
  codes          CodeLiaison[]

  @@map("utilisateur")
}

model CodeLiaison {
  code          String      @id
  utilisateurId String      @map("utilisateur_id") @db.Uuid
  expireLe      DateTime    @map("expire_le")
  utilisateur   Utilisateur @relation(fields: [utilisateurId], references: [id], onDelete: Cascade)

  @@map("code_liaison")
}

/// Immuable sauf état et résultats de traitement. Conservée à vie.
model Capture {
  id            String      @id @default(uuid()) @db.Uuid
  utilisateurId String      @map("utilisateur_id") @db.Uuid
  canal         Canal
  prive         Boolean
  sourceRef     String?     @unique @map("source_ref")
  sourceFichier String?     @map("source_fichier")
  audioPath     String?     @map("audio_path")
  audioMime     String?     @map("audio_mime")
  audioPurgeLe  DateTime?   @map("audio_purge_le")
  dureeS        Int?        @map("duree_s")
  texteEcrit    String?     @map("texte_ecrit")
  texteBrut     String?     @map("texte_brut")
  emisLe        DateTime    @map("emis_le")
  recuLe        DateTime    @default(now()) @map("recu_le")
  etat          EtatCapture
  erreur        String?
  versionPrompt String?     @map("version_prompt")
  modele        String?
  tokensEntree  Int?        @map("tokens_entree")
  tokensSortie  Int?        @map("tokens_sortie")
  classeLe      DateTime?   @map("classe_le")
  utilisateur   Utilisateur @relation(fields: [utilisateurId], references: [id])
  items         Item[]

  @@index([etat])
  @@map("capture")
}

/// Donnée, pas code (décision 21) : alimentée par les sorties de tri.
model Theme {
  id      String   @id @default(uuid()) @db.Uuid
  libelle String   @unique
  creeLe  DateTime @default(now()) @map("cree_le")
  items   Item[]

  @@map("theme")
}

model Item {
  id            String       @id @default(uuid()) @db.Uuid
  captureId     String       @map("capture_id") @db.Uuid
  position      Int
  texte         String
  nature        Nature
  confiance     Json
  themeId       String?      @map("theme_id") @db.Uuid
  personnes     String[]
  versionPrompt String       @map("version_prompt")
  modele        String
  creeLe        DateTime     @default(now()) @map("cree_le")
  archiveLe     DateTime?    @map("archive_le")
  capture       Capture      @relation(fields: [captureId], references: [id])
  theme         Theme?       @relation(fields: [themeId], references: [id])
  action        Action?
  pensee        Pensee?
  corrections   Correction[]

  @@unique([captureId, position])
  @@map("item")
}

/// Types d'échéance, importance, effort, contexte : texte libre validé par le prompt.
model Action {
  itemId       String    @id @map("item_id") @db.Uuid
  echeanceType String?   @map("echeance_type")
  echeanceExpr String?   @map("echeance_expr")
  echeanceDate DateTime? @map("echeance_date")
  fenetreDebut DateTime? @map("fenetre_debut")
  fenetreFin   DateTime? @map("fenetre_fin")
  importance   String?
  effort       String?
  contexte     String?
  alarme       Boolean   @default(false)
  alarmeExpr   String?   @map("alarme_expr")
  faitLe       DateTime? @map("fait_le")
  reporteN     Int       @default(0) @map("reporte_n")
  item         Item      @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@map("action")
}

model Pensee {
  itemId   String  @id @map("item_id") @db.Uuid
  tonalite String?
  item     Item    @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@map("pensee")
}

model Correction {
  id             String   @id @default(uuid()) @db.Uuid
  itemId         String   @map("item_id") @db.Uuid
  champ          String
  ancienneValeur Json?    @map("ancienne_valeur")
  nouvelleValeur Json?    @map("nouvelle_valeur")
  corrigeLe      DateTime @default(now()) @map("corrige_le")
  item           Item     @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@map("correction")
}
```

- [ ] **Step 2: Générer la migration et y ajouter les garde-fous privés**

Run (tunnel ouvert) : `cd packages/db && DATABASE_URL=postgresql://organizer:organizer@127.0.0.1:55432/organizer pnpm exec prisma migrate dev --name init --create-only`
Expected: `packages/db/prisma/migrations/<horodatage>_init/migration.sql` créé.

Ajouter à la fin de ce `migration.sql` :
```sql
-- Mode privé (règle n° 6, CAP-09). Une capture privée naît privée et ne quitte
-- jamais l'état privee : elle ne peut donc ni entrer en file ni être classée.
ALTER TABLE "capture" ADD CONSTRAINT "capture_prive_etat"
  CHECK (("prive" AND "etat" = 'privee') OR (NOT "prive" AND "etat" <> 'privee'));

CREATE FUNCTION capture_prive_immuable() RETURNS trigger AS $$
BEGIN
  IF OLD.prive AND NOT NEW.prive THEN
    RAISE EXCEPTION 'Une capture privée ne redevient jamais ordinaire';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER capture_prive_immuable BEFORE UPDATE ON "capture"
  FOR EACH ROW EXECUTE FUNCTION capture_prive_immuable();
```

Run: `DATABASE_URL=postgresql://organizer:organizer@127.0.0.1:55432/organizer pnpm exec prisma migrate dev && cd ../..`
Expected: `Your database is now in sync with your schema.`

- [ ] **Step 3: Écrire `src/index.ts` et `src/test.ts`**

`packages/db/src/index.ts` :
```ts
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export function creerPrisma(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('Variable manquante : DATABASE_URL');
  return new PrismaClient({ datasources: { db: { url } } });
}
```

`packages/db/src/test.ts` :
```ts
import type { PrismaClient } from '@prisma/client';

/** Tests uniquement : vide toutes les tables métier. */
export async function viderBase(p: PrismaClient): Promise<void> {
  await p.$executeRawUnsafe(
    'TRUNCATE correction, action, pensee, item, theme, capture, code_liaison, utilisateur CASCADE',
  );
}
```

- [ ] **Step 4: Écrire les tests des garde-fous**

`packages/db/test/capture.test.ts` :
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

const utilisateur = () => prisma.utilisateur.create({ data: { nom: 'test' } });

describe('garde-fous du mode privé', () => {
  it('accepte une capture privée dans l\'état privee', async () => {
    const u = await utilisateur();
    const c = await prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() },
    });
    expect(c.prive).toBe(true);
  });

  it('refuse une capture privée dans un autre état', async () => {
    const u = await utilisateur();
    await expect(prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'en_file', emisLe: new Date() },
    })).rejects.toThrow();
  });

  it('refuse de faire sortir une capture privée de l\'état privee', async () => {
    const u = await utilisateur();
    const c = await prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() },
    });
    await expect(prisma.capture.update({ where: { id: c.id }, data: { etat: 'en_file' } })).rejects.toThrow();
  });

  it('refuse qu\'une capture privée redevienne ordinaire', async () => {
    const u = await utilisateur();
    const c = await prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() },
    });
    await expect(prisma.capture.update({
      where: { id: c.id }, data: { prive: false, etat: 'recue' },
    })).rejects.toThrow();
  });

  it('refuse l\'état privee pour une capture ordinaire', async () => {
    const u = await utilisateur();
    await expect(prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'privee', emisLe: new Date() },
    })).rejects.toThrow();
  });
});

describe('capture', () => {
  it('source_ref est unique', async () => {
    const u = await utilisateur();
    const data = { utilisateurId: u.id, canal: 'telegram' as const, prive: false, etat: 'recue' as const, emisLe: new Date(), sourceRef: 'tg:1:1' };
    await prisma.capture.create({ data });
    await expect(prisma.capture.create({ data })).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm install && pnpm test -- packages/db`
Expected: la migration est rejouée sur `organizer_test`, puis PASS, 6 tests.

- [ ] **Step 6: Commiter**

```bash
git add packages/db pnpm-lock.yaml
git commit -m "Ajoute le schéma de base et verrouille le mode privé en SQL"
```

---

### Task 4: `ClassificationProvider` et fournisseur Gemini

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/classement/provider.ts`, `apps/worker/src/classement/gemini.ts`
- Test: `apps/worker/test/gemini.test.ts`

**Interfaces:**
- Consumes: `Prompt`, `TriSortie` (tâche 2).
- Produces :
  - `interface EntreeClassement { systeme: string; audio?: { mime: string; donnees: Buffer }; texte?: string }`
  - `interface ResultatClassement { sortie: TriSortie; modele: string; tokensEntree: number; tokensSortie: number }`
  - `interface ClassificationProvider { classer(e: EntreeClassement): Promise<ResultatClassement>; verifierPalierPaye(): Promise<void> }`
  - erreurs `CreditEpuise`, `SortieNonConforme`, `PalierNonPaye` (toutes `extends Error`)
  - `class GeminiProvider implements ClassificationProvider`, `constructor(o: OptionsGemini)`, `interface OptionsGemini { cle: string; modele: string; repli: string; prompt: Prompt; tiersPayes: string[]; fetch?: typeof fetch }`

- [ ] **Step 1: Écrire le paquet**

`apps/worker/package.json` :
```json
{
  "name": "@organizer/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/main.ts",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@organizer/db": "workspace:*",
    "@organizer/shared": "workspace:*",
    "bullmq": "^5.58.0",
    "ioredis": "^5.7.0"
  },
  "devDependencies": { "tsx": "^4.20.0" }
}
```

`apps/worker/tsconfig.json` :
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm install`

- [ ] **Step 2: Écrire les tests du fournisseur**

`apps/worker/test/gemini.test.ts` :
```ts
import { join } from 'node:path';
import { chargerPrompt } from '@organizer/shared';
import { describe, expect, it } from 'vitest';
import { sortieExemple } from '../../../packages/shared/test/sortie-exemple.js';
import { GeminiProvider } from '../src/classement/gemini.js';
import { CreditEpuise, PalierNonPaye, SortieNonConforme } from '../src/classement/provider.js';

const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');

interface Appel { url: string; corps: Record<string, unknown>; entetes: Record<string, string> }

function faux(reponses: Array<{ status: number; texte?: string; tier?: string }>) {
  const appels: Appel[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    appels.push({ url: String(url), corps: JSON.parse(String(init?.body)), entetes: init?.headers as Record<string, string> });
    const r = reponses.shift();
    if (!r) throw new Error('appel inattendu');
    const corps = r.status === 200
      ? { candidates: [{ content: { parts: [{ text: r.texte ?? '' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, serviceTier: r.tier ?? 'standard' } }
      : { error: { message: 'contenu de la requête qui ne doit pas fuiter', status: 'ERREUR' } };
    return new Response(JSON.stringify(corps), { status: r.status });
  };
  return { appels, fetch: f as typeof fetch };
}

const provider = (f: typeof fetch) =>
  new GeminiProvider({ cle: 'cle-test', modele: 'principal', repli: 'repli', prompt, tiersPayes: ['standard'], fetch: f });

const audio = { mime: 'audio/ogg', donnees: Buffer.from('OggS-faux') };

describe('GeminiProvider.classer', () => {
  it('renvoie la sortie validée, le modèle et les jetons', async () => {
    const { fetch } = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    const r = await provider(fetch).classer({ systeme: 'S', audio });
    expect(r.modele).toBe('principal');
    expect(r.sortie.items[0]!.theme).toBe('voiture');
    expect([r.tokensEntree, r.tokensSortie]).toEqual([100, 20]);
  });

  it('envoie l\'audio en ligne, le schéma, la température 0,2 et la clé en en-tête', async () => {
    const { fetch, appels } = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    await provider(fetch).classer({ systeme: 'S', audio });
    const a = appels[0]!;
    expect(a.url).toContain('/models/principal:generateContent');
    expect(a.url).not.toContain('cle-test');
    expect(a.entetes['x-goog-api-key']).toBe('cle-test');
    const gen = a.corps.generationConfig as Record<string, unknown>;
    expect(gen.temperature).toBe(0.2);
    expect(gen.responseMimeType).toBe('application/json');
    expect(gen.responseSchema).toEqual(prompt.responseSchema);
    expect(JSON.stringify(a.corps.contents)).toContain(audio.donnees.toString('base64'));
  });

  it('passe au modèle de repli sur une sortie hors schéma', async () => {
    const { fetch, appels } = faux([
      { status: 200, texte: '{"transcription": 3}' },
      { status: 200, texte: JSON.stringify(sortieExemple()) },
    ]);
    const r = await provider(fetch).classer({ systeme: 'S', texte: 'bonjour' });
    expect(r.modele).toBe('repli');
    expect(appels[1]!.url).toContain('/models/repli:');
  });

  it('lève SortieNonConforme si le repli échoue aussi', async () => {
    const { fetch } = faux([{ status: 200, texte: 'pas du json' }, { status: 200, texte: '{}' }]);
    await expect(provider(fetch).classer({ systeme: 'S', texte: 'x' })).rejects.toBeInstanceOf(SortieNonConforme);
  });

  it('traite un texte vide (réponse bloquée) comme une sortie non conforme', async () => {
    const { fetch } = faux([{ status: 200, texte: '' }, { status: 200, texte: '' }]);
    await expect(provider(fetch).classer({ systeme: 'S', texte: 'x' })).rejects.toBeInstanceOf(SortieNonConforme);
  });

  it('lève CreditEpuise sur HTTP 402, sans tenter le repli', async () => {
    const { fetch, appels } = faux([{ status: 402 }]);
    await expect(provider(fetch).classer({ systeme: 'S', texte: 'x' })).rejects.toBeInstanceOf(CreditEpuise);
    expect(appels).toHaveLength(1);
  });

  it('laisse remonter une panne serveur comme erreur passagère, sans contenu', async () => {
    const { fetch, appels } = faux([{ status: 503 }]);
    const err = await provider(fetch).classer({ systeme: 'S', texte: 'secret de L' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SortieNonConforme);
    expect(String((err as Error).message)).not.toMatch(/secret de L|fuiter/);
    expect(appels).toHaveLength(1);
  });
});

describe('GeminiProvider.verifierPalierPaye', () => {
  it('accepte un palier déclaré payé', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: 'standard' }]);
    await expect(provider(fetch).verifierPalierPaye()).resolves.toBeUndefined();
  });

  it('refuse un palier inconnu ou absent', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: 'free' }]);
    await expect(provider(fetch).verifierPalierPaye()).rejects.toBeInstanceOf(PalierNonPaye);
  });
});
```

- [ ] **Step 3: Lancer les tests pour les voir échouer**

Run: `pnpm vitest run apps/worker/test/gemini.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 4: Écrire `provider.ts`**

`apps/worker/src/classement/provider.ts` :
```ts
import type { TriSortie } from '@organizer/shared';

export interface EntreeClassement {
  systeme: string;
  audio?: { mime: string; donnees: Buffer };
  texte?: string;
}

export interface ResultatClassement {
  sortie: TriSortie;
  modele: string;
  tokensEntree: number;
  tokensSortie: number;
}

/** Seul point de contact avec un modèle. Un modèle local doit pouvoir s'y brancher. */
export interface ClassificationProvider {
  classer(e: EntreeClassement): Promise<ResultatClassement>;
  verifierPalierPaye(): Promise<void>;
}

/** Crédit ou plafond atteint : indisponibilité temporaire, pas une erreur de classement. */
export class CreditEpuise extends Error {
  override name = 'CreditEpuise';
}

/** Sortie hors schéma sur le modèle principal puis le repli. */
export class SortieNonConforme extends Error {
  override name = 'SortieNonConforme';
}

export class PalierNonPaye extends Error {
  override name = 'PalierNonPaye';
}
```

- [ ] **Step 5: Écrire `gemini.ts`**

`apps/worker/src/classement/gemini.ts` :
```ts
import type { Prompt } from '@organizer/shared';
import {
  CreditEpuise, PalierNonPaye, SortieNonConforme,
  type ClassificationProvider, type EntreeClassement, type ResultatClassement,
} from './provider.js';

const URL_API = 'https://generativelanguage.googleapis.com/v1beta/models/';

export interface OptionsGemini {
  cle: string;
  modele: string;
  repli: string;
  prompt: Prompt;
  /** Valeurs de usageMetadata.serviceTier reconnues comme palier payé. */
  tiersPayes: string[];
  fetch?: typeof fetch;
}

interface ReponseGemini {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; serviceTier?: string };
}

interface Brut { texte: string; entree: number; sortie: number; tier: string | undefined }

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export class GeminiProvider implements ClassificationProvider {
  constructor(private readonly o: OptionsGemini) {}

  async classer(e: EntreeClassement): Promise<ResultatClassement> {
    let derniere: unknown;
    for (const modele of [this.o.modele, this.o.repli]) {
      const brut = await this.appeler(modele, e);
      try {
        const sortie = this.o.prompt.valider(JSON.parse(brut.texte));
        return { sortie, modele, tokensEntree: brut.entree, tokensSortie: brut.sortie };
      } catch (err) {
        derniere = err;
      }
    }
    throw new SortieNonConforme(`Sortie hors schéma sur ${this.o.modele} puis ${this.o.repli}`, { cause: derniere });
  }

  async verifierPalierPaye(): Promise<void> {
    const r = await this.appeler(this.o.modele, { systeme: 'Contrôle de palier. Réponds le JSON minimal.', texte: 'ok' });
    if (!r.tier || !this.o.tiersPayes.includes(r.tier)) {
      throw new PalierNonPaye(`Palier Gemini « ${r.tier ?? 'inconnu'} » : palier payé exigé`);
    }
  }

  private async appeler(modele: string, e: EntreeClassement): Promise<Brut> {
    const parts: Part[] = [];
    if (e.audio) {
      parts.push({ inlineData: { mimeType: e.audio.mime, data: e.audio.donnees.toString('base64') } }, { text: 'Voici le vocal.' });
    }
    if (e.texte) parts.push({ text: `Message écrit, pas de vocal. Ce texte est la transcription :\n${e.texte}` });

    const r = await (this.o.fetch ?? fetch)(`${URL_API}${modele}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.o.cle },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: e.systeme }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: this.o.prompt.responseSchema },
      }),
    });
    // Jamais le corps d'erreur dans le message : il peut citer la requête.
    if (r.status === 402) throw new CreditEpuise(`Gemini ${modele} : HTTP 402`);
    if (!r.ok) throw new Error(`Gemini ${modele} : HTTP ${r.status}`);
    const j = (await r.json().catch(() => ({}))) as ReponseGemini;
    return {
      texte: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
      entree: j.usageMetadata?.promptTokenCount ?? 0,
      sortie: j.usageMetadata?.candidatesTokenCount ?? 0,
      tier: j.usageMetadata?.serviceTier,
    };
  }
}
```

- [ ] **Step 6: Lancer les tests**

Run: `pnpm vitest run apps/worker/test/gemini.test.ts && pnpm typecheck`
Expected: PASS, 9 tests ; aucune erreur de type.

- [ ] **Step 7: Commiter**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "Ajoute ClassificationProvider et le fournisseur Gemini avec repli"
```

---

### Task 5: Classement d'une capture en items

**Files:**
- Create: `apps/worker/src/classement/traiter.ts`
- Test: `apps/worker/test/traiter.test.ts`, `apps/worker/test/aides.ts`

**Interfaces:**
- Consumes: `ClassificationProvider`, `SortieNonConforme` (tâche 4) ; `Prompt`, `rendrePrompt`, `isoLocal`, `jourSemaine` (tâche 2) ; modèles Prisma (tâche 3).
- Produces :
  - `interface DepsTraitement { prisma: PrismaClient; provider: ClassificationProvider; prompt: Prompt; audioRacine: string; maintenant?: () => Date }`
  - `type Issue = 'classee' | 'a_revoir' | 'deja_traitee'`
  - `traiterCapture(id: string, d: DepsTraitement): Promise<Issue>`
  - `class CapturePriveeRefusee extends Error`
  - dans `test/aides.ts` : `class FauxProvider implements ClassificationProvider` (`appels: EntreeClassement[]`, `reponses: Array<ResultatClassement | Error>`), `creerCaptureTexte(prisma, texte?): Promise<{ id: string }>`.

- [ ] **Step 1: Écrire les aides de test**

`apps/worker/test/aides.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { sortieExemple } from '../../../packages/shared/test/sortie-exemple.js';
import type { ClassificationProvider, EntreeClassement, ResultatClassement } from '../src/classement/provider.js';

export const resultatExemple = (): ResultatClassement => ({
  sortie: { ...sortieExemple(), items: sortieExemple().items.map((i) => ({ ...i, theme: i.theme.toLowerCase() })) },
  modele: 'modele-test', tokensEntree: 10, tokensSortie: 5,
});

export class FauxProvider implements ClassificationProvider {
  appels: EntreeClassement[] = [];
  constructor(public reponses: Array<ResultatClassement | Error> = []) {}

  async classer(e: EntreeClassement): Promise<ResultatClassement> {
    this.appels.push(e);
    const r = this.reponses.length > 1 ? this.reponses.shift() : this.reponses[0];
    if (!r) return resultatExemple();
    if (r instanceof Error) throw r;
    return r;
  }

  async verifierPalierPaye(): Promise<void> {}
}

export async function creerCaptureTexte(prisma: PrismaClient, texte = 'rappeler le garage jeudi'): Promise<{ id: string }> {
  const u = await prisma.utilisateur.upsert({ where: { nom: 'test' }, create: { nom: 'test' }, update: {} });
  return prisma.capture.create({
    data: {
      utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'en_file',
      texteEcrit: texte, emisLe: new Date('2026-10-06T06:12:00Z'),
    },
    select: { id: true },
  });
}
```

- [ ] **Step 2: Écrire les tests du traitement**

`apps/worker/test/traiter.test.ts` :
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { chargerPrompt } from '@organizer/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SortieNonConforme } from '../src/classement/provider.js';
import { CapturePriveeRefusee, traiterCapture, type DepsTraitement } from '../src/classement/traiter.js';
import { creerCaptureTexte, FauxProvider } from './aides.js';

const prisma = creerPrisma();
const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');
const audioRacine = mkdtempSync(join(tmpdir(), 'audio-'));
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

const deps = (provider: FauxProvider): DepsTraitement => ({
  prisma, provider, prompt, audioRacine, maintenant: () => new Date('2026-10-06T06:13:00Z'),
});

describe('traiterCapture', () => {
  it('écrit les items, leur sous-type, le thème, la version et le modèle', async () => {
    const { id } = await creerCaptureTexte(prisma);
    expect(await traiterCapture(id, deps(new FauxProvider()))).toBe('classee');

    const items = await prisma.item.findMany({ where: { captureId: id }, include: { action: true, pensee: true, theme: true }, orderBy: { position: 'asc' } });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ nature: 'action', versionPrompt: 'tri/v1', modele: 'modele-test' });
    expect(items[0]!.action).toMatchObject({ echeanceType: 'jour', contexte: 'appel', alarme: false });
    expect(items[0]!.theme?.libelle).toBe('voiture');
    expect(items[1]!.pensee?.tonalite).toBe('constat');
    expect(items[1]!.action).toBeNull();

    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ etat: 'classee', modele: 'modele-test', versionPrompt: 'tri/v1', tokensEntree: 10 });
    expect(c.texteBrut).toContain('garage');
  });

  it('transmet la date d\'émission locale et les thèmes connus au prompt', async () => {
    await prisma.theme.create({ data: { libelle: 'maison' } });
    const { id } = await creerCaptureTexte(prisma);
    const p = new FauxProvider();
    await traiterCapture(id, deps(p));
    expect(p.appels[0]!.systeme).toContain('2026-10-06T08:12:00+02:00 (mardi)');
    expect(p.appels[0]!.systeme).toContain('maison');
    expect(p.appels[0]!.texte).toBe('rappeler le garage jeudi');
  });

  it('envoie l\'audio stocké quand la capture en a un', async () => {
    const { id } = await creerCaptureTexte(prisma);
    mkdirSync(join(audioRacine, 'ordinaire'), { recursive: true });
    writeFileSync(join(audioRacine, 'ordinaire', `${id}.oga`), 'OggS-faux');
    await prisma.capture.update({ where: { id }, data: { texteEcrit: null, audioPath: `ordinaire/${id}.oga`, audioMime: 'audio/ogg' } });
    const p = new FauxProvider();
    await traiterCapture(id, deps(p));
    expect(p.appels[0]!.audio?.donnees.toString()).toBe('OggS-faux');
    expect(p.appels[0]!.texte).toBeUndefined();
  });

  it('refuse une capture privée sans appeler le fournisseur', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
    const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    const p = new FauxProvider();
    await expect(traiterCapture(c.id, deps(p))).rejects.toBeInstanceOf(CapturePriveeRefusee);
    expect(p.appels).toHaveLength(0);
  });

  it('ne rappelle pas Gemini pour une capture déjà classée', async () => {
    const { id } = await creerCaptureTexte(prisma);
    const p = new FauxProvider();
    await traiterCapture(id, deps(p));
    expect(await traiterCapture(id, deps(p))).toBe('deja_traitee');
    expect(p.appels).toHaveLength(1);
  });

  it('un rejeu après interruption ne double aucun item', async () => {
    const { id } = await creerCaptureTexte(prisma);
    await traiterCapture(id, deps(new FauxProvider()));
    await prisma.capture.update({ where: { id }, data: { etat: 'en_file' } });
    await traiterCapture(id, deps(new FauxProvider()));
    expect(await prisma.item.count({ where: { captureId: id } })).toBe(2);
    expect(await prisma.theme.count()).toBe(2);
  });

  it('passe en a_revoir sur une sortie non conforme, sans item', async () => {
    const { id } = await creerCaptureTexte(prisma);
    expect(await traiterCapture(id, deps(new FauxProvider([new SortieNonConforme('x')])))).toBe('a_revoir');
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c.etat).toBe('a_revoir');
    expect(c.erreur).toBe('sortie_non_conforme');
    expect(await prisma.item.count()).toBe(0);
  });

  it('laisse remonter une erreur passagère sans changer l\'état', async () => {
    const { id } = await creerCaptureTexte(prisma);
    await expect(traiterCapture(id, deps(new FauxProvider([new Error('HTTP 503')])))).rejects.toThrow('503');
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('en_file');
  });
});
```

- [ ] **Step 3: Lancer les tests pour les voir échouer**

Run: `pnpm test -- apps/worker/test/traiter.test.ts`
Expected: FAIL, `traiter.js` introuvable.

- [ ] **Step 4: Écrire `traiter.ts`**

`apps/worker/src/classement/traiter.ts` :
```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@organizer/db';
import { isoLocal, jourSemaine, rendrePrompt, type Prompt } from '@organizer/shared';
import { SortieNonConforme, type ClassificationProvider, type ResultatClassement } from './provider.js';

export interface DepsTraitement {
  prisma: PrismaClient;
  provider: ClassificationProvider;
  prompt: Prompt;
  audioRacine: string;
  maintenant?: () => Date;
}

export type Issue = 'classee' | 'a_revoir' | 'deja_traitee';

export class CapturePriveeRefusee extends Error {
  override name = 'CapturePriveeRefusee';
}

const dateOuNull = (s: string | null): Date | null => (s ? new Date(s) : null);

export async function traiterCapture(id: string, d: DepsTraitement): Promise<Issue> {
  const c = await d.prisma.capture.findUniqueOrThrow({ where: { id }, include: { utilisateur: true } });
  // Première vérification, avant toute lecture d'audio : règle n° 6.
  if (c.prive) throw new CapturePriveeRefusee(`Capture ${id} privée : jamais envoyée`);
  if (c.etat === 'classee' || c.etat === 'a_revoir') return 'deja_traitee';

  const audio = c.audioPath
    ? { mime: c.audioMime ?? 'audio/ogg', donnees: await readFile(join(d.audioRacine, c.audioPath)) }
    : undefined;
  if (!audio && !c.texteEcrit) throw new Error(`Capture ${id} sans audio ni texte`);

  const fuseau = c.utilisateur.fuseau;
  const systeme = rendrePrompt(d.prompt.systeme, {
    emis_le: isoLocal(c.emisLe, fuseau),
    jour_semaine: jourSemaine(c.emisLe, fuseau),
    fuseau,
    themes_connus: (await d.prisma.theme.findMany({ orderBy: { libelle: 'asc' }, select: { libelle: true } })).map((t) => t.libelle),
    prenoms_connus: (await d.prisma.$queryRaw<{ prenom: string }[]>`SELECT DISTINCT unnest(personnes) AS prenom FROM item ORDER BY 1`).map((r) => r.prenom),
    exemples: '',
  });

  let r: ResultatClassement;
  try {
    r = await d.provider.classer({ systeme, audio, texte: audio ? undefined : (c.texteEcrit ?? undefined) });
  } catch (e) {
    if (!(e instanceof SortieNonConforme)) throw e;
    await d.prisma.capture.update({
      where: { id }, data: { etat: 'a_revoir', erreur: 'sortie_non_conforme', versionPrompt: d.prompt.version },
    });
    return 'a_revoir';
  }

  await enregistrer(d.prisma, id, r, d.prompt.version, (d.maintenant ?? (() => new Date()))());
  return 'classee';
}

/** Réécrit tous les items de la capture d'un bloc : un rejeu ne double rien. */
async function enregistrer(p: PrismaClient, captureId: string, r: ResultatClassement, version: string, maintenant: Date): Promise<void> {
  await p.$transaction(async (tx) => {
    await tx.item.deleteMany({ where: { captureId } });
    for (const it of r.sortie.items) {
      const theme = it.theme
        ? await tx.theme.upsert({ where: { libelle: it.theme }, create: { libelle: it.theme }, update: {} })
        : null;
      await tx.item.create({
        data: {
          captureId,
          position: it.position,
          texte: it.texte,
          nature: it.nature,
          confiance: { nature: it.confiance.nature, echeance: it.confiance.echeance, theme: it.confiance.theme },
          themeId: theme?.id ?? null,
          personnes: it.personnes,
          versionPrompt: version,
          modele: r.modele,
          action: it.nature === 'action' ? {
            create: {
              echeanceType: it.echeance_type,
              echeanceExpr: it.echeance_expr,
              echeanceDate: dateOuNull(it.echeance_date),
              fenetreDebut: dateOuNull(it.fenetre_debut),
              fenetreFin: dateOuNull(it.fenetre_fin),
              importance: it.importance,
              effort: it.effort,
              contexte: it.contexte,
              alarme: it.alarme === true,
              alarmeExpr: it.alarme_expr,
            },
          } : undefined,
          pensee: it.nature === 'pensee' ? { create: { tonalite: it.tonalite } } : undefined,
        },
      });
    }
    await tx.capture.update({
      where: { id: captureId },
      data: {
        texteBrut: r.sortie.transcription, etat: 'classee', erreur: null, versionPrompt: version,
        modele: r.modele, tokensEntree: r.tokensEntree, tokensSortie: r.tokensSortie, classeLe: maintenant,
      },
    });
  });
}
```

- [ ] **Step 5: Lancer les tests**

Run: `pnpm test -- apps/worker/test/traiter.test.ts && pnpm typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commiter**

```bash
git add apps/worker
git commit -m "Classe une capture en items, de façon rejouable, en refusant le privé"
```

---

### Task 6: Worker BullMQ, crédit épuisé, reprise et démarrage

**Files:**
- Create: `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`
- Test: `apps/worker/test/worker.test.ts`

**Interfaces:**
- Consumes: `traiterCapture`, `CapturePriveeRefusee`, `DepsTraitement` (tâche 5) ; `CreditEpuise`, `GeminiProvider` (tâche 4) ; `FILE_CLASSEMENT`, `FILE_ALERTES`, `JobClassement`, `JobAlerte`, `OPTIONS_JOB_CLASSEMENT`, `chargerPrompt`, `exigerVar`, `lireVar` (tâches 1-2).
- Produces :
  - `interface DepsWorker extends DepsTraitement { connexion: ConnectionOptions; concurrence: number; alerter(message: string): Promise<void>; nomFile?: string; pauseCreditMs?: number }`
  - `demarrerWorker(d: DepsWorker): Worker<JobClassement>`
  - `reprendre(prisma: PrismaClient, file: Queue<JobClassement>): Promise<number>`
  - alertes admin publiées dans la file `alertes` (`JobAlerte`), consommées par l'API (tâche 8).

- [ ] **Step 1: Écrire les tests du worker**

`apps/worker/test/worker.test.ts` :
```ts
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { chargerPrompt, OPTIONS_JOB_CLASSEMENT, type JobClassement } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CreditEpuise } from '../src/classement/provider.js';
import { demarrerWorker, reprendre } from '../src/worker.js';
import { creerCaptureTexte, FauxProvider, resultatExemple } from './aides.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');
let nomFile: string;
let file: Queue<JobClassement>;
let worker: Worker<JobClassement> | undefined;

beforeEach(async () => {
  await viderBase(prisma);
  nomFile = `classement-test-${randomUUID()}`;
  file = new Queue<JobClassement>(nomFile, { connection: connexion });
});
afterEach(async () => {
  await worker?.close();
  await file.obliterate({ force: true });
  await file.close();
});
afterAll(async () => {
  await prisma.$disconnect();
  connexion.disconnect();
});

async function attendre(condition: () => Promise<boolean>, ms = 8000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('délai dépassé');
}

const etat = async (id: string) => (await prisma.capture.findUniqueOrThrow({ where: { id } })).etat;

function lancer(provider: FauxProvider, alertes: string[] = [], pauseCreditMs = 300) {
  worker = demarrerWorker({
    prisma, provider, prompt, audioRacine: tmpdir(), connexion, concurrence: 1, nomFile, pauseCreditMs,
    alerter: async (m) => { alertes.push(m); },
  });
}

describe('demarrerWorker', () => {
  it('classe une capture enfilée', async () => {
    const { id } = await creerCaptureTexte(prisma);
    lancer(new FauxProvider());
    await file.add('classer', { captureId: id }, { jobId: id });
    await attendre(async () => (await etat(id)) === 'classee');
  });

  it('crédit épuisé : garde les captures en file, alerte une seule fois, reprend ensuite', async () => {
    const a = await creerCaptureTexte(prisma, 'un');
    const b = await creerCaptureTexte(prisma, 'deux');
    const alertes: string[] = [];
    const p = new FauxProvider([new CreditEpuise('402'), new CreditEpuise('402'), resultatExemple()]);
    lancer(p, alertes);
    await file.add('classer', { captureId: a.id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: a.id });
    await file.add('classer', { captureId: b.id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: b.id });
    await attendre(async () => (await etat(a.id)) === 'classee' && (await etat(b.id)) === 'classee');
    expect(alertes).toHaveLength(1);
    expect(await prisma.capture.count({ where: { etat: 'a_revoir' } })).toBe(0);
  });

  it('passe en a_transcrire quand les essais sont épuisés', async () => {
    const { id } = await creerCaptureTexte(prisma);
    lancer(new FauxProvider([new Error('HTTP 503')]));
    await file.add('classer', { captureId: id }, { jobId: id, attempts: 1 });
    await attendre(async () => (await etat(id)) === 'a_transcrire');
  });

  it('rejette un job pointant une capture privée sans appeler le fournisseur', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
    const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    const p = new FauxProvider();
    lancer(p);
    const job = await file.add('classer', { captureId: c.id }, { jobId: c.id, attempts: 3 });
    await attendre(async () => (await job.getState()) === 'failed');
    expect(p.appels).toHaveLength(0);
    expect(await etat(c.id)).toBe('privee');
  });
});

describe('reprendre', () => {
  it('réenfile les captures a_transcrire, jamais les privées', async () => {
    const { id } = await creerCaptureTexte(prisma);
    await prisma.capture.update({ where: { id }, data: { etat: 'a_transcrire' } });
    expect(await reprendre(prisma, file)).toBe(1);
    expect(await etat(id)).toBe('en_file');
    expect(await file.count()).toBe(1);
  });
});
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `pnpm test -- apps/worker/test/worker.test.ts`
Expected: FAIL, `worker.js` introuvable.

- [ ] **Step 3: Écrire `worker.ts`**

`apps/worker/src/worker.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { FILE_CLASSEMENT, OPTIONS_JOB_CLASSEMENT, type JobClassement } from '@organizer/shared';
import { UnrecoverableError, Worker, type ConnectionOptions, type Queue } from 'bullmq';
import { CreditEpuise } from './classement/provider.js';
import { CapturePriveeRefusee, traiterCapture, type DepsTraitement } from './classement/traiter.js';

export interface DepsWorker extends DepsTraitement {
  connexion: ConnectionOptions;
  concurrence: number;
  alerter(message: string): Promise<void>;
  nomFile?: string;
  pauseCreditMs?: number;
}

export function demarrerWorker(d: DepsWorker): Worker<JobClassement> {
  let creditSignale = false;
  const w: Worker<JobClassement> = new Worker<JobClassement>(
    d.nomFile ?? FILE_CLASSEMENT,
    async (job) => {
      try {
        const issue = await traiterCapture(job.data.captureId, d);
        creditSignale = false;
        return issue;
      } catch (e) {
        if (e instanceof CapturePriveeRefusee) throw new UnrecoverableError('capture privée refusée');
        if (e instanceof CreditEpuise) {
          // Indisponibilité, pas un échec : la file s'arrête et garde l'ordre.
          if (!creditSignale) {
            creditSignale = true;
            await d.alerter('Crédit Gemini épuisé : classement suspendu.');
          }
          await w.rateLimit(d.pauseCreditMs ?? 15 * 60_000);
          throw Worker.RateLimitError();
        }
        throw e;
      }
    },
    { connection: d.connexion, concurrency: d.concurrence },
  );

  w.on('failed', (job, err) => {
    if (!job || err instanceof UnrecoverableError || err.name === 'UnrecoverableError') return;
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void d.prisma.capture.updateMany({
      where: { id: job.data.captureId, prive: false, etat: { in: ['recue', 'en_file'] } },
      data: { etat: 'a_transcrire', erreur: err.name },
    });
  });
  return w;
}

/** Réenfile les captures dont le classement a échoué faute de réseau ou d'API. */
export async function reprendre(prisma: PrismaClient, file: Queue<JobClassement>): Promise<number> {
  const captures = await prisma.capture.findMany({
    where: { etat: 'a_transcrire', prive: false }, orderBy: { emisLe: 'asc' }, select: { id: true },
  });
  for (const { id } of captures) {
    await prisma.capture.update({ where: { id }, data: { etat: 'en_file' } });
    await file.add('classer', { captureId: id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: `${id}-reprise-${Date.now()}` });
  }
  return captures.length;
}
```

Si `Worker.RateLimitError` n'existe pas dans la version installée de BullMQ, utiliser `import { RateLimitError } from 'bullmq'` et `throw new RateLimitError()`.

- [ ] **Step 4: Lancer les tests**

Run: `pnpm test -- apps/worker/test/worker.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Écrire `main.ts`**

`apps/worker/src/main.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import {
  chargerPrompt, exigerVar, FILE_ALERTES, FILE_CLASSEMENT, lireVar,
  type JobAlerte, type JobClassement,
} from '@organizer/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { GeminiProvider } from './classement/gemini.js';
import { demarrerWorker, reprendre } from './worker.js';

const prisma = creerPrisma();
const connexion = new Redis(exigerVar('REDIS_URL'), { maxRetriesPerRequest: null });
const prompt = chargerPrompt(lireVar('PROMPTS_DIR') ?? '../../prompts', lireVar('PROMPT_VERSION') ?? 'tri/v1');
const provider = new GeminiProvider({
  cle: exigerVar('GEMINI_API_KEY'),
  modele: lireVar('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite',
  repli: lireVar('GEMINI_MODEL_FALLBACK') ?? 'gemini-3.8-flash',
  prompt,
  tiersPayes: (lireVar('GEMINI_TIERS_PAYES') ?? 'standard').split(',').map((s) => s.trim()),
});

// Règle n° 8 : pas de palier payé, pas de worker.
await provider.verifierPalierPaye();

const alertes = new Queue<JobAlerte>(FILE_ALERTES, { connection: connexion });
const file = new Queue<JobClassement>(FILE_CLASSEMENT, { connection: connexion });
const worker = demarrerWorker({
  prisma, provider, prompt,
  audioRacine: exigerVar('AUDIO_STORAGE_PATH'),
  connexion,
  concurrence: Number(lireVar('WORKER_CONCURRENCY') ?? '2'),
  alerter: async (message) => { await alertes.add('alerte', { message }); },
});

const minuterie = setInterval(() => {
  reprendre(prisma, file).catch((e: unknown) => console.error(`Reprise impossible : ${(e as Error).name}`));
}, 60 * 60_000);

console.log(`Worker démarré. Prompt ${prompt.version}, concurrence ${worker.opts.concurrency}.`);

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

- [ ] **Step 6: Vérifier et commiter**

Run: `pnpm typecheck && pnpm lint`
Expected: aucune erreur.

```bash
git add apps/worker
git commit -m "Branche le worker sur BullMQ : crédit épuisé, reprise, contrôle du palier"
```

---

### Task 7: Ingestion d'une capture Telegram

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/ingestion/extraire.ts`, `apps/api/src/ingestion/stockage.ts`, `apps/api/src/ingestion/ingestion.service.ts`, `apps/api/src/ingestion/file.ts`
- Test: `apps/api/test/extraire.test.ts`, `apps/api/test/ingestion.test.ts`

**Interfaces:**
- Consumes: modèles Prisma (tâche 3) ; `OPTIONS_JOB_CLASSEMENT`, `JobClassement` (tâche 2).
- Produces :
  - `interface CaptureEntrante { sourceRef: string; emisLe: Date; dureeS: number | null; fichier: { id: string; mime: string } | null; texte: string | null }`
  - `extraireCapture(m: Message): CaptureEntrante | null`
  - `class StockageAudio { constructor(racine: string); ecrire(id: string, emisLe: Date, donnees: Buffer, extension: string, type: 'ordinaire' | 'prive'): Promise<string> }`
  - `interface Telechargeur { telecharger(fichierId: string): Promise<{ donnees: Buffer; extension: string }> }`
  - `interface FileClassement { enfiler(captureId: string): Promise<void> }`, `class FileClassementBullmq implements FileClassement`
  - `class IngestionService { constructor(prisma, stockage, telechargeur, file, journal?); recevoir(utilisateurId: string, e: CaptureEntrante): Promise<{ id: string; nouvelle: boolean }>; finaliser(id: string): Promise<void>; reprendre(maintenant?: Date): Promise<number> }`

- [ ] **Step 1: Écrire le paquet**

`apps/api/package.json` :
```json
{
  "name": "@organizer/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/main.ts",
    "cli": "tsx --env-file=../../.env src/cli.ts",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": {
    "@nestjs/common": "^11.1.0",
    "@nestjs/core": "^11.1.0",
    "@nestjs/platform-express": "^11.1.0",
    "@organizer/db": "workspace:*",
    "@organizer/shared": "workspace:*",
    "bullmq": "^5.58.0",
    "grammy": "^1.38.0",
    "ioredis": "^5.7.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.0"
  },
  "devDependencies": { "@types/express": "^5.0.0", "tsx": "^4.20.0" }
}
```

`apps/api/tsconfig.json` :
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm install`

- [ ] **Step 2: Écrire les tests d'extraction**

`apps/api/test/extraire.test.ts` :
```ts
import type { Message } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { extraireCapture } from '../src/ingestion/extraire.js';

const base = { message_id: 42, date: 1_791_270_720, chat: { id: 7, type: 'private', first_name: 'x' } } as const;
const msg = (m: Record<string, unknown>) => ({ ...base, ...m }) as unknown as Message;

describe('extraireCapture', () => {
  it('un vocal', () => {
    const c = extraireCapture(msg({ voice: { file_id: 'F', file_unique_id: 'U', duration: 12, mime_type: 'audio/ogg' } }));
    expect(c).toEqual({ sourceRef: 'tg:7:42', emisLe: new Date(1_791_270_720_000), dureeS: 12, fichier: { id: 'F', mime: 'audio/ogg' }, texte: null });
  });

  it('un texte d\'un seul mot', () => {
    expect(extraireCapture(msg({ text: 'pain' }))).toMatchObject({ texte: 'pain', fichier: null, dureeS: null });
  });

  it('une vidéo ronde est traitée comme un vocal', () => {
    const c = extraireCapture(msg({ video_note: { file_id: 'V', file_unique_id: 'U', duration: 5, length: 240 } }));
    expect(c?.fichier).toEqual({ id: 'V', mime: 'video/mp4' });
  });

  it('un message transféré garde la date d\'origine', () => {
    const c = extraireCapture(msg({ text: 'idée', forward_origin: { type: 'hidden_user', date: 1_791_000_000, sender_user_name: 'x' } }));
    expect(c?.emisLe).toEqual(new Date(1_791_000_000_000));
  });

  it('ignore les commandes et les messages sans voix ni texte', () => {
    expect(extraireCapture(msg({ text: '/start 123' }))).toBeNull();
    expect(extraireCapture(msg({ sticker: { file_id: 'S' } }))).toBeNull();
  });
});
```

- [ ] **Step 3: Écrire les tests d'ingestion**

`apps/api/test/ingestion.test.ts` :
```ts
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureEntrante } from '../src/ingestion/extraire.js';
import { IngestionService, type FileClassement, type Telechargeur } from '../src/ingestion/ingestion.service.js';
import { StockageAudio } from '../src/ingestion/stockage.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

class FausseFile implements FileClassement {
  ids: string[] = [];
  async enfiler(id: string): Promise<void> { this.ids.push(id); }
}

class FauxTelechargeur implements Telechargeur {
  appels = 0;
  echoue = false;
  async telecharger(): Promise<{ donnees: Buffer; extension: string }> {
    this.appels++;
    if (this.echoue) throw new Error('réseau');
    return { donnees: Buffer.from('OggS-faux'), extension: 'oga' };
  }
}

let racine: string;
let file: FausseFile;
let tele: FauxTelechargeur;
let service: IngestionService;
let utilisateurId: string;

beforeEach(async () => {
  await viderBase(prisma);
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  file = new FausseFile();
  tele = new FauxTelechargeur();
  service = new IngestionService(prisma, new StockageAudio(racine), tele, file, () => {});
  utilisateurId = (await prisma.utilisateur.create({ data: { nom: 'test' } })).id;
});

const vocal = (ref = 'tg:7:42'): CaptureEntrante => ({
  sourceRef: ref, emisLe: new Date('2026-10-06T06:12:00Z'), dureeS: 12, fichier: { id: 'F', mime: 'audio/ogg' }, texte: null,
});

describe('IngestionService', () => {
  it('recevoir est idempotent sur la référence Telegram', async () => {
    const a = await service.recevoir(utilisateurId, vocal());
    const b = await service.recevoir(utilisateurId, vocal());
    expect(a.nouvelle).toBe(true);
    expect(b).toEqual({ id: a.id, nouvelle: false });
    expect(await prisma.capture.count()).toBe(1);
  });

  it('recevoir crée une capture ordinaire horodatée à l\'émission', async () => {
    const { id } = await service.recevoir(utilisateurId, vocal());
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({
      prive: false, canal: 'telegram', etat: 'recue', emisLe: new Date('2026-10-06T06:12:00Z'), sourceFichier: 'F',
    });
  });

  it('finaliser range l\'audio, enfile une fois et passe en_file', async () => {
    const { id } = await service.recevoir(utilisateurId, vocal());
    await service.finaliser(id);
    await service.finaliser(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c.etat).toBe('en_file');
    expect(c.audioPath).toBe(`ordinaire/2026/10/${id}.oga`);
    expect(readFileSync(join(racine, c.audioPath!), 'utf8')).toBe('OggS-faux');
    expect(file.ids).toEqual([id]);
    expect(tele.appels).toBe(1);
  });

  it('finaliser un texte n\'appelle pas Telegram', async () => {
    const { id } = await service.recevoir(utilisateurId, { ...vocal(), fichier: null, dureeS: null, texte: 'pain' });
    await service.finaliser(id);
    expect(tele.appels).toBe(0);
    expect(file.ids).toEqual([id]);
  });

  it('un téléchargement en échec laisse la capture en recue, puis reprendre la finalise', async () => {
    const { id } = await service.recevoir(utilisateurId, vocal());
    tele.echoue = true;
    await expect(service.finaliser(id)).rejects.toThrow();
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('recue');
    expect(file.ids).toEqual([]);

    tele.echoue = false;
    expect(await service.reprendre(new Date(Date.now() + 5 * 60_000))).toBe(1);
    expect(file.ids).toEqual([id]);
  });

  it('ne passe pas en_file une capture déjà classée par le worker', async () => {
    const { id } = await service.recevoir(utilisateurId, { ...vocal(), fichier: null, texte: 'x' });
    file.enfiler = async (cid) => { await prisma.capture.update({ where: { id: cid }, data: { etat: 'classee' } }); };
    await service.finaliser(id);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('classee');
  });

  it('refuse d\'enfiler une capture privée', async () => {
    const c = await prisma.capture.create({ data: { utilisateurId, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    await expect(service.finaliser(c.id)).rejects.toThrow('privée');
    expect(file.ids).toEqual([]);
  });

  it('assainit l\'extension du fichier', async () => {
    const chemin = await new StockageAudio(racine).ecrire('abc', new Date('2026-01-15T00:00:00Z'), Buffer.from('x'), '../../etc', 'ordinaire');
    expect(chemin).toBe('ordinaire/2026/01/abc.bin');
    expect(existsSync(join(racine, chemin))).toBe(true);
  });
});
```

- [ ] **Step 4: Lancer les tests pour les voir échouer**

Run: `pnpm test -- apps/api`
Expected: FAIL, modules introuvables.

- [ ] **Step 5: Écrire `extraire.ts` et `stockage.ts`**

`apps/api/src/ingestion/extraire.ts` :
```ts
import type { Message } from 'grammy/types';

export interface CaptureEntrante {
  sourceRef: string;
  emisLe: Date;
  dureeS: number | null;
  fichier: { id: string; mime: string } | null;
  texte: string | null;
}

export function extraireCapture(m: Message): CaptureEntrante | null {
  // Une vidéo ronde envoyée par erreur est traitée comme un vocal : Gemini en lit la piste son.
  const media = m.voice ?? m.audio ?? (m.video_note ? { ...m.video_note, mime_type: 'video/mp4' } : undefined);
  if (!media && !m.text) return null;
  if (m.text?.startsWith('/')) return null;
  // CAP-05 : un transfert garde la date du message d'origine.
  const date = m.forward_origin?.date ?? m.date;
  return {
    sourceRef: `tg:${m.chat.id}:${m.message_id}`,
    emisLe: new Date(date * 1000),
    dureeS: media?.duration ?? null,
    fichier: media ? { id: media.file_id, mime: media.mime_type ?? 'audio/ogg' } : null,
    texte: m.text ?? null,
  };
}
```

`apps/api/src/ingestion/stockage.ts` :
```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class StockageAudio {
  constructor(private readonly racine: string) {}

  /** Écrit l'audio et renvoie son chemin relatif à la racine. Réécrire le même fichier est sans effet. */
  async ecrire(id: string, emisLe: Date, donnees: Buffer, extension: string, type: 'ordinaire' | 'prive'): Promise<string> {
    const ext = /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'bin';
    const mois = String(emisLe.getUTCMonth() + 1).padStart(2, '0');
    const relatif = `${type}/${emisLe.getUTCFullYear()}/${mois}/${id}.${ext}`;
    await mkdir(dirname(join(this.racine, relatif)), { recursive: true });
    await writeFile(join(this.racine, relatif), donnees);
    return relatif;
  }
}
```

- [ ] **Step 6: Écrire `ingestion.service.ts` et `file.ts`**

`apps/api/src/ingestion/ingestion.service.ts` :
```ts
import { Prisma, type PrismaClient } from '@organizer/db';
import type { CaptureEntrante } from './extraire.js';
import type { StockageAudio } from './stockage.js';

export interface Telechargeur {
  telecharger(fichierId: string): Promise<{ donnees: Buffer; extension: string }>;
}

export interface FileClassement {
  enfiler(captureId: string): Promise<void>;
}

export class IngestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stockage: StockageAudio,
    private readonly telechargeur: Telechargeur,
    private readonly file: FileClassement,
    private readonly journal: (message: string) => void = (m) => console.error(m),
  ) {}

  /** Étape 1, avant l'accusé de réception : la capture existe en base. Idempotent. */
  async recevoir(utilisateurId: string, e: CaptureEntrante): Promise<{ id: string; nouvelle: boolean }> {
    try {
      const c = await this.prisma.capture.create({
        data: {
          utilisateurId, canal: 'telegram', prive: false, etat: 'recue',
          sourceRef: e.sourceRef, sourceFichier: e.fichier?.id ?? null, audioMime: e.fichier?.mime ?? null,
          dureeS: e.dureeS, texteEcrit: e.texte, emisLe: e.emisLe,
        },
        select: { id: true },
      });
      return { id: c.id, nouvelle: true };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      const c = await this.prisma.capture.findUniqueOrThrow({ where: { sourceRef: e.sourceRef }, select: { id: true } });
      return { id: c.id, nouvelle: false };
    }
  }

  /** Étape 2, après l'accusé : audio rangé, job enfilé. Rejouable. */
  async finaliser(id: string): Promise<void> {
    const c = await this.prisma.capture.findUniqueOrThrow({ where: { id } });
    if (c.prive) throw new Error(`Capture ${id} privée : jamais enfilée`);
    if (c.etat !== 'recue') return;
    if (c.sourceFichier && !c.audioPath) {
      const f = await this.telechargeur.telecharger(c.sourceFichier);
      const audioPath = await this.stockage.ecrire(c.id, c.emisLe, f.donnees, f.extension, 'ordinaire');
      await this.prisma.capture.update({ where: { id }, data: { audioPath } });
    }
    await this.file.enfiler(id);
    // updateMany : le worker a pu classer la capture entre-temps.
    await this.prisma.capture.updateMany({ where: { id, etat: 'recue' }, data: { etat: 'en_file' } });
  }

  /** Reprend les captures restées en recue (téléchargement en échec, redémarrage). */
  async reprendre(maintenant: Date = new Date()): Promise<number> {
    const enAttente = await this.prisma.capture.findMany({
      where: { etat: 'recue', prive: false, recuLe: { lt: new Date(maintenant.getTime() - 2 * 60_000) } },
      orderBy: { emisLe: 'asc' }, select: { id: true },
    });
    let n = 0;
    for (const { id } of enAttente) {
      try {
        await this.finaliser(id);
        n++;
      } catch (e) {
        this.journal(`Capture ${id} : finalisation reportée (${(e as Error).name})`);
      }
    }
    return n;
  }
}
```

`apps/api/src/ingestion/file.ts` :
```ts
import { OPTIONS_JOB_CLASSEMENT, type JobClassement } from '@organizer/shared';
import type { Queue } from 'bullmq';
import type { FileClassement } from './ingestion.service.js';

export class FileClassementBullmq implements FileClassement {
  constructor(private readonly file: Queue<JobClassement>) {}

  async enfiler(captureId: string): Promise<void> {
    // jobId = captureId : un double enfilage est ignoré par BullMQ.
    await this.file.add('classer', { captureId }, { ...OPTIONS_JOB_CLASSEMENT, jobId: captureId });
  }
}
```

- [ ] **Step 7: Lancer les tests**

Run: `pnpm test -- apps/api && pnpm typecheck`
Expected: PASS, 13 tests.

- [ ] **Step 8: Commiter**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "Ingère les captures Telegram : idempotence, audio rangé, enfilage"
```

---

### Task 8: Bot, liaison des comptes, alertes et application NestJS

**Files:**
- Create: `apps/api/src/telegram/liaison.service.ts`, `apps/api/src/telegram/bot.ts`, `apps/api/src/telegram/telegram.controller.ts`, `apps/api/src/alertes.ts`, `apps/api/src/config.ts`, `apps/api/src/jetons.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/cli.ts`
- Test: `apps/api/test/liaison.test.ts`, `apps/api/test/bot.test.ts`

**Interfaces:**
- Consumes: `IngestionService`, `extraireCapture`, `StockageAudio`, `FileClassementBullmq`, `Telechargeur` (tâche 7) ; `FILE_ALERTES`, `FILE_CLASSEMENT`, `JobAlerte`, `exigerVar`, `lireVar` (tâches 1-2).
- Produces :
  - `class LiaisonService { constructor(prisma, maintenant?: () => Date); creerCode(nom: string): Promise<string>; lier(code: string, chatId: number): Promise<'lie' | 'invalide'>; utilisateurDuChat(chatId: number): Promise<{ id: string } | null> }`
  - `creerBot(token: string, d: { liaison: LiaisonService; ingestion: IngestionService }, options?: BotConfig<Context>): Bot`
  - REST : `GET /health` → `{ ok: true }` ; `POST /telegram/webhook` (mode webhook, en-tête `X-Telegram-Bot-Api-Secret-Token` vérifié).
  - CLI : `pnpm --filter @organizer/api cli creer-utilisateur <nom> [--admin]`, `pnpm --filter @organizer/api cli code-liaison <nom>`.

- [ ] **Step 1: Écrire les tests de liaison**

`apps/api/test/liaison.test.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LiaisonService } from '../src/telegram/liaison.service.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await viderBase(prisma);
  await prisma.utilisateur.createMany({ data: [{ nom: 'a' }, { nom: 'b' }] });
});

let horloge = new Date('2026-10-06T08:00:00Z');
const service = () => new LiaisonService(prisma, () => horloge);

describe('LiaisonService', () => {
  it('un code de six chiffres lie le chat au compte, une seule fois', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    const code = await service().creerCode('a');
    expect(code).toMatch(/^\d{6}$/);
    expect(await service().lier(code, 7)).toBe('lie');
    expect((await service().utilisateurDuChat(7))?.id).toBe((await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'a' } })).id);
    expect(await service().lier(code, 8)).toBe('invalide');
  });

  it('un code expire au bout de 10 minutes', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    const code = await service().creerCode('a');
    horloge = new Date('2026-10-06T08:10:01Z');
    expect(await service().lier(code, 7)).toBe('invalide');
  });

  it('un chat déjà lié à un autre compte est refusé', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    await service().lier(await service().creerCode('a'), 7);
    expect(await service().lier(await service().creerCode('b'), 7)).toBe('invalide');
  });

  it('un chat inconnu n\'a pas de compte', async () => {
    expect(await service().utilisateurDuChat(999)).toBeNull();
  });
});
```

- [ ] **Step 2: Écrire les tests du bot**

`apps/api/test/bot.test.ts` :
```ts
import type { UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import type { CaptureEntrante } from '../src/ingestion/extraire.js';
import type { IngestionService } from '../src/ingestion/ingestion.service.js';
import type { LiaisonService } from '../src/telegram/liaison.service.js';
import { creerBot } from '../src/telegram/bot.js';

const botInfo = { id: 1, is_bot: true, first_name: 'test', username: 'test_bot' } as UserFromGetMe;

function monter(lie: boolean) {
  const envois: { method: string; payload: Record<string, unknown> }[] = [];
  const recues: string[] = [];
  const finalisees: string[] = [];
  const liaison = {
    utilisateurDuChat: async () => (lie ? { id: 'u1' } : null),
    lier: async (code: string) => (code === '123456' ? 'lie' : 'invalide'),
  } as unknown as LiaisonService;
  const ingestion = {
    recevoir: async (_u: string, e: CaptureEntrante) => {
      const nouvelle = !recues.includes(e.sourceRef);
      recues.push(e.sourceRef);
      return { id: 'c1', nouvelle };
    },
    finaliser: async (id: string) => { finalisees.push(id); },
  } as unknown as IngestionService;
  const bot = creerBot('0:test', { liaison, ingestion }, { botInfo });
  bot.api.config.use(async (_prev, method, payload) => {
    envois.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  return { bot, envois, recues, finalisees };
}

const maj = (id: number, message: Record<string, unknown>) => ({
  update_id: id,
  message: { message_id: 42, date: 1_791_270_720, chat: { id: 7, type: 'private', first_name: 'x' }, ...message },
}) as never;

describe('creerBot', () => {
  it('accuse réception d\'un vocal et lance la finalisation', async () => {
    const { bot, envois, finalisees } = monter(true);
    await bot.handleUpdate(maj(1, { voice: { file_id: 'F', file_unique_id: 'U', duration: 3 } }));
    expect(envois).toHaveLength(1);
    expect(envois[0]).toMatchObject({ method: 'sendMessage', payload: { chat_id: 7, text: 'Reçu.' } });
    await new Promise((r) => setImmediate(r));
    expect(finalisees).toEqual(['c1']);
  });

  it('une mise à jour relivrée ne produit pas de second accusé', async () => {
    const { bot, envois, recues } = monter(true);
    await bot.handleUpdate(maj(1, { text: 'pain' }));
    await bot.handleUpdate(maj(1, { text: 'pain' }));
    expect(recues).toHaveLength(2);
    expect(envois.filter((e) => e.payload.text === 'Reçu.')).toHaveLength(1);
  });

  it('un chat non lié ne crée aucune capture', async () => {
    const { bot, envois, recues } = monter(false);
    await bot.handleUpdate(maj(1, { text: 'pain' }));
    expect(recues).toHaveLength(0);
    expect(envois[0]!.payload.text).toBe("Ce compte n'est pas lié.");
  });

  it('/start avec un code lie le chat', async () => {
    const { bot, envois } = monter(false);
    await bot.handleUpdate(maj(1, { text: '/start 123456', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    expect(envois[0]!.payload.text).toBe("C'est lié. Envoie un vocal quand tu veux.");
  });

  it('les messages du bot font moins de 12 mots et sans emoji', async () => {
    const { bot, envois } = monter(false);
    await bot.handleUpdate(maj(1, { text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    await bot.handleUpdate(maj(2, { text: '/start 000000', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    await bot.handleUpdate(maj(3, { text: 'pain' }));
    for (const e of envois) {
      const texte = String(e.payload.text);
      expect(texte.split(/\s+/).length).toBeLessThan(12);
      expect(texte).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
```

- [ ] **Step 3: Lancer les tests pour les voir échouer**

Run: `pnpm test -- apps/api/test/liaison.test.ts apps/api/test/bot.test.ts`
Expected: FAIL, modules introuvables.

- [ ] **Step 4: Écrire `liaison.service.ts`**

`apps/api/src/telegram/liaison.service.ts` :
```ts
import { randomInt } from 'node:crypto';
import { Prisma, type PrismaClient } from '@organizer/db';

const VALIDITE_MS = 10 * 60_000;

export class LiaisonService {
  constructor(private readonly prisma: PrismaClient, private readonly maintenant: () => Date = () => new Date()) {}

  async creerCode(nom: string): Promise<string> {
    const u = await this.prisma.utilisateur.findUniqueOrThrow({ where: { nom } });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.codeLiaison.create({
      data: { code, utilisateurId: u.id, expireLe: new Date(this.maintenant().getTime() + VALIDITE_MS) },
    });
    return code;
  }

  async lier(code: string, chatId: number): Promise<'lie' | 'invalide'> {
    const c = await this.prisma.codeLiaison.findUnique({ where: { code } });
    if (!c || c.expireLe <= this.maintenant()) return 'invalide';
    try {
      await this.prisma.$transaction([
        this.prisma.utilisateur.update({ where: { id: c.utilisateurId }, data: { telegramChatId: BigInt(chatId) } }),
        this.prisma.codeLiaison.delete({ where: { code } }),
      ]);
      return 'lie';
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'invalide';
      throw e;
    }
  }

  utilisateurDuChat(chatId: number): Promise<{ id: string } | null> {
    return this.prisma.utilisateur.findUnique({ where: { telegramChatId: BigInt(chatId) }, select: { id: true } });
  }
}
```

- [ ] **Step 5: Écrire `bot.ts`**

`apps/api/src/telegram/bot.ts` :
```ts
import { Bot, type BotConfig, type Context } from 'grammy';
import { extraireCapture } from '../ingestion/extraire.js';
import type { IngestionService } from '../ingestion/ingestion.service.js';
import type { LiaisonService } from './liaison.service.js';

export interface DepsBot { liaison: LiaisonService; ingestion: IngestionService }

export function creerBot(token: string, d: DepsBot, options?: BotConfig<Context>): Bot {
  const bot = new Bot(token, options);

  bot.command('start', async (ctx) => {
    const code = ctx.match.trim();
    if (!code) {
      await ctx.reply('Envoie /start suivi de ton code.');
      return;
    }
    const r = await d.liaison.lier(code, ctx.chat.id);
    await ctx.reply(r === 'lie' ? "C'est lié. Envoie un vocal quand tu veux." : 'Code invalide ou expiré.');
  });

  bot.on('message', async (ctx) => {
    const u = await d.liaison.utilisateurDuChat(ctx.chat.id);
    if (!u) {
      await ctx.reply("Ce compte n'est pas lié.");
      return;
    }
    const e = extraireCapture(ctx.message);
    if (!e) return;
    const { id, nouvelle } = await d.ingestion.recevoir(u.id, e);
    if (!nouvelle) return;
    await ctx.reply('Reçu.', { reply_parameters: { message_id: ctx.message.message_id } });
    // Pas d'attente : l'accusé part avant le téléchargement (CAP-03). La reprise rattrape un échec.
    void d.ingestion.finaliser(id).catch((err: unknown) => {
      console.error(`Capture ${id} : finalisation reportée (${(err as Error).name})`);
    });
  });

  bot.catch((err) => {
    // Jamais le contenu du message : identifiant de mise à jour et nom d'erreur seulement.
    console.error(`Mise à jour ${err.ctx.update.update_id} : ${(err.error as Error).name}`);
  });
  return bot;
}
```

- [ ] **Step 6: Lancer les tests**

Run: `pnpm test -- apps/api/test/liaison.test.ts apps/api/test/bot.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Écrire la configuration, les jetons et les alertes**

`apps/api/src/config.ts` :
```ts
import { exigerVar, lireVar } from '@organizer/shared';

export interface ConfigApi {
  port: number;
  redisUrl: string;
  telegramToken: string;
  telegramMode: 'polling' | 'webhook';
  webhookSecret: string | undefined;
  audioRacine: string;
}

export function lireConfigApi(): ConfigApi {
  const mode = lireVar('TELEGRAM_MODE') ?? 'webhook';
  if (mode !== 'polling' && mode !== 'webhook') throw new Error(`TELEGRAM_MODE inconnu : ${mode}`);
  const webhookSecret = lireVar('TELEGRAM_WEBHOOK_SECRET');
  if (mode === 'webhook' && !webhookSecret) throw new Error('TELEGRAM_WEBHOOK_SECRET obligatoire en mode webhook');
  return {
    port: Number(lireVar('PORT') ?? '3000'),
    redisUrl: exigerVar('REDIS_URL'),
    telegramToken: exigerVar('TELEGRAM_BOT_TOKEN'),
    telegramMode: mode,
    webhookSecret,
    audioRacine: exigerVar('AUDIO_STORAGE_PATH'),
  };
}
```

`apps/api/src/jetons.ts` :
```ts
export const CONFIG = Symbol('CONFIG');
export const PRISMA = Symbol('PRISMA');
export const REDIS = Symbol('REDIS');
export const BOT = Symbol('BOT');
export const INGESTION = Symbol('INGESTION');
```

`apps/api/src/alertes.ts` :
```ts
import type { PrismaClient } from '@organizer/db';
import { FILE_ALERTES, type JobAlerte } from '@organizer/shared';
import { Worker, type ConnectionOptions } from 'bullmq';
import type { Bot } from 'grammy';

/** L'API est le seul point d'envoi de messages : les alertes du worker passent par ici, vers l'admin seul. */
export function demarrerAlertes(connexion: ConnectionOptions, prisma: PrismaClient, bot: Bot): Worker<JobAlerte> {
  return new Worker<JobAlerte>(FILE_ALERTES, async (job) => {
    const admins = await prisma.utilisateur.findMany({ where: { admin: true, telegramChatId: { not: null } } });
    for (const a of admins) await bot.api.sendMessage(Number(a.telegramChatId), job.data.message);
  }, { connection: connexion });
}
```

- [ ] **Step 8: Écrire le contrôleur, le module et le démarrage**

`apps/api/src/telegram/telegram.controller.ts` :
```ts
import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { webhookCallback, type Bot } from 'grammy';
import type { ConfigApi } from '../config.js';
import { BOT, CONFIG } from '../jetons.js';

@Controller()
export class TelegramController {
  private readonly gestionnaire: (req: Request, res: Response) => Promise<void>;

  constructor(@Inject(BOT) bot: Bot, @Inject(CONFIG) config: ConfigApi) {
    this.gestionnaire = webhookCallback(bot, 'express', { secretToken: config.webhookSecret });
  }

  @Get('health')
  sante(): { ok: true } {
    return { ok: true };
  }

  @Post('telegram/webhook')
  async recevoir(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.gestionnaire(req, res);
  }
}
```

`apps/api/src/app.module.ts` :
```ts
import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { creerPrisma, type PrismaClient } from '@organizer/db';
import { FILE_CLASSEMENT, type JobClassement } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import type { Bot } from 'grammy';
import { Redis } from 'ioredis';
import { demarrerAlertes } from './alertes.js';
import { lireConfigApi, type ConfigApi } from './config.js';
import { FileClassementBullmq } from './ingestion/file.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { StockageAudio } from './ingestion/stockage.js';
import { BOT, CONFIG, INGESTION, PRISMA, REDIS } from './jetons.js';
import { creerBot } from './telegram/bot.js';
import { LiaisonService } from './telegram/liaison.service.js';
import { TelegramController } from './telegram/telegram.controller.js';

class Cycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private minuterie?: NodeJS.Timeout;
  private alertes?: Worker;

  constructor(
    @Inject(CONFIG) private readonly config: ConfigApi,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(INGESTION) private readonly ingestion: IngestionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bot.init();
    if (this.config.telegramMode === 'polling') {
      await this.bot.api.deleteWebhook({ drop_pending_updates: false });
      void this.bot.start();
    }
    this.alertes = demarrerAlertes(this.redis, this.prisma, this.bot);
    this.minuterie = setInterval(() => void this.ingestion.reprendre(), 5 * 60_000);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.minuterie);
    if (this.config.telegramMode === 'polling') await this.bot.stop();
    await this.alertes?.close();
    await this.prisma.$disconnect();
    this.redis.disconnect();
  }
}

@Module({
  controllers: [TelegramController],
  providers: [
    { provide: CONFIG, useFactory: lireConfigApi },
    { provide: PRISMA, useFactory: () => creerPrisma() },
    { provide: REDIS, inject: [CONFIG], useFactory: (c: ConfigApi) => new Redis(c.redisUrl, { maxRetriesPerRequest: null }) },
    {
      provide: INGESTION,
      inject: [CONFIG, PRISMA, REDIS],
      useFactory: (c: ConfigApi, prisma: PrismaClient, redis: Redis) => {
        const file = new FileClassementBullmq(new Queue<JobClassement>(FILE_CLASSEMENT, { connection: redis }));
        // Le bot n'existe pas encore ici : le téléchargeur passe par l'API HTTP de Telegram.
        const telechargeur = {
          async telecharger(fichierId: string) {
            const base = `https://api.telegram.org`;
            const r = await fetch(`${base}/bot${c.telegramToken}/getFile?file_id=${encodeURIComponent(fichierId)}`);
            const j = (await r.json()) as { ok: boolean; result?: { file_path?: string } };
            const chemin = j.result?.file_path;
            if (!j.ok || !chemin) throw new Error('Telegram getFile en échec');
            const f = await fetch(`${base}/file/bot${c.telegramToken}/${chemin}`);
            if (!f.ok) throw new Error(`Téléchargement Telegram : HTTP ${f.status}`);
            return { donnees: Buffer.from(await f.arrayBuffer()), extension: chemin.split('.').pop() ?? 'bin' };
          },
        };
        return new IngestionService(prisma, new StockageAudio(c.audioRacine), telechargeur, file);
      },
    },
    {
      provide: BOT,
      inject: [CONFIG, PRISMA, INGESTION],
      useFactory: (c: ConfigApi, prisma: PrismaClient, ingestion: IngestionService) =>
        creerBot(c.telegramToken, { liaison: new LiaisonService(prisma), ingestion }),
    },
    Cycle,
  ],
})
export class AppModule {}
```

`apps/api/src/main.ts` :
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { lireConfigApi } from './config.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
app.enableShutdownHooks();
await app.listen(lireConfigApi().port);
console.log(`API démarrée sur le port ${lireConfigApi().port}.`);
```

`apps/api/src/cli.ts` :
```ts
import { creerPrisma } from '@organizer/db';
import { LiaisonService } from './telegram/liaison.service.js';

// Aucune inscription libre : les comptes se créent ici, par l'administrateur.
const [commande, nom] = process.argv.slice(2);
const prisma = creerPrisma();
try {
  if (commande === 'creer-utilisateur' && nom) {
    await prisma.utilisateur.create({ data: { nom, admin: process.argv.includes('--admin') } });
    console.log(`Compte ${nom} créé.`);
  } else if (commande === 'code-liaison' && nom) {
    console.log(`Code valable 10 minutes : /start ${await new LiaisonService(prisma).creerCode(nom)}`);
  } else {
    console.log('Usage : cli creer-utilisateur <nom> [--admin] | cli code-liaison <nom>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
```

- [ ] **Step 9: Vérifier toute la suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: toute la suite PASS (environ 72 tests), aucune erreur de type ni de lint.

- [ ] **Step 10: Essai de bout en bout avec un bot de dev**

Prérequis manuels, par Franck :
1. Créer un bot de dev distinct auprès de @BotFather (le banc d'essai garde `@organizer_lud_bot` : deux processus en long polling sur le même jeton se bloquent).
2. Compléter le `.env` racine (ignoré par Git) avec `TELEGRAM_BOT_TOKEN` du bot de dev, `GEMINI_API_KEY`, `TELEGRAM_MODE=polling`, `AUDIO_STORAGE_PATH=../../data/audio`, `PROMPTS_DIR=../../prompts`, et les URL du tunnel.

Run :
```bash
pnpm prisma migrate deploy
pnpm --filter @organizer/api cli creer-utilisateur franck --admin
pnpm --filter @organizer/api cli code-liaison franck
pnpm dev
```
Puis dans Telegram : `/start <code>`, puis un vocal fabriqué de 5 secondes (« rappeler le garage jeudi »).

Expected :
- « Reçu. » en moins de 2 s.
- Dans les 45 s : `pnpm prisma studio` montre la capture `classee`, ses items, leur `version_prompt` `tri/v1` et leur `modele`.
- Les journaux de l'API et du worker ne contiennent ni la transcription ni le texte.

- [ ] **Step 11: Commiter**

```bash
git status --short   # aucun .env, data/, corpus/
git add apps/api
git commit -m "Branche le bot Telegram, la liaison des comptes et les alertes admin"
```

---

## Hors de ce plan (rappel)

- **Plan 1-B** : authentification, REST de lecture et de correction, PWA (vues, cochage, correction), bouton privé complet (enregistreur, raccourci Android, vue Privé, ffmpeg à l'envoi), repli Telegram « prochaine capture privée ».
- **Plan 1-C** : Dockerfiles et build des paquets en `dist`, CI GHCR, `infra/docker-compose.yml` mis à jour, `setWebhook`, proxy sortant à liste fermée, sondes de supervision, retrait du banc d'essai.
- **Branchement de fin de lot 1** (décision 21) : typologie de thèmes et prompt validés sur le corpus, `pnpm test:prompt` sur `fixtures/`.
- Reportés au lot 2 par le cahier : garde-fou de longueur (CAP-12), désambiguïsation, rattachement vectoriel, apprentissage des corrections.
