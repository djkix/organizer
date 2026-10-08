# Effacement en deux temps et historique — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** livrer en 1.6.0 l'effacement « glisser → confirmation → 5 s pour annuler » et l'onglet Historique des envois non privés.

**Architecture:** côté PWA, un module pur `effacement.ts` (même forme que `cochage.ts`) diffère le `DELETE` de 5 s et pilote un
`Bandeau` généralisé ; le glissement déclenche la confirmation au lieu de découvrir un bouton. Côté API, un module
`historique` (service + contrôleur) lit les captures non privées du compte, groupées par jour dans son fuseau ; la PWA
ajoute une route `/historique` et un panneau de détail en lecture seule.

**Tech Stack:** SvelteKit 2 / Svelte 5, NestJS 11, Prisma 6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-effacement-historique-design.md`

## Global Constraints

- Ni rouge ni orange ; aucun compteur ni nombre d'éléments ; textes de 16 px minimum ; cibles de 44 px ; français, tutoiement, phrases de moins de 12 mots.
- Captures privées : jamais listées, jamais détaillées, 404 sur la route de détail.
- Décision 25 : chaque compte ne voit que ses envois ; un autre compte reçoit 404.
- Aucun texte de capture dans les journaux.
- Délai d'effacement : 5 000 ms ; aucun `DELETE` avant l'échéance ; un seul `DELETE` par effacement.
- CSP inchangée ; palette « Sérénité affinée » ; chaque commit met à jour `CHANGELOG.md`.

## Review Focus

- Effacer puis cocher une autre ligne dans les 5 s : un seul bandeau, le plus récent ; l'effacement part quand même à l'échéance.
- Effacer, puis ouvrir le détail d'une autre action ou changer d'onglet : l'effacement en attente part, la ligne ne réapparaît pas.
- Capture sans texte (vocal en file) ou texte très long sans espace : « Pas encore transcrit. » ou début coupé sans débordement.
- Capture émise à 23 h 30 heure de Paris le dernier jour du mois : rangée dans le bon jour et le bon mois.
- Barre du bas à quatre entrées à 360 px : aucun débordement, libellés lisibles.

---

### Task 1: Effaceur différé

**Files:** Create `apps/web/src/lib/effacement.ts`; Test `apps/web/test/effacement.test.ts`

**Interfaces — Produces:**

```ts
export const DELAI_EFFACEMENT_MS = 5_000;
export interface EtatEffacement { enAttente: string | null }
export interface DepsEffaceur {
  effacer(itemId: string): Promise<void>;          // envoi réel (mis en file par l'appelant)
  surChangement(etat: EtatEffacement): void;
  surEchec(itemId: string): void;                  // la ligne revient, message calme
}
export interface Effaceur {
  planifier(itemId: string): void;                 // fait partir l'éventuel précédent tout de suite
  annuler(): string | null;                        // rend l'id annulé, aucune requête
  vider(): void;                                   // envoie maintenant l'effacement en attente
}
export function creerEffaceur(d: DepsEffaceur, delaiMs?: number): Effaceur;
```

- [ ] Tests (horloge factice `vi.useFakeTimers()`) : rien n'est envoyé avant 5 s, un envoi à 5 s ; `annuler()` dans le délai → aucun envoi, renvoie l'id ; deuxième `planifier` → le premier part immédiatement, le second à son échéance ; `vider()` → envoi immédiat, plus rien ensuite ; échec de `effacer` → `surEchec(id)` ; `etat.enAttente` suit chaque étape.
- [ ] Lancer `npx vitest run apps/web/test/effacement.test.ts` → échec (module absent).
- [ ] Implémenter (minuterie unique, `envoyer(id)` qui appelle `d.effacer(id).catch(() => d.surEchec(id))`).
- [ ] Relancer → vert ; commit « Ajoute l'effaceur différé de cinq secondes ».

### Task 2: Bandeau généralisé et accueil

**Files:** Modify `apps/web/src/lib/composants/Bandeau.svelte`, `apps/web/src/routes/+page.svelte`, `apps/web/src/lib/messages.ts`; Test `apps/web/e2e/a-faire.spec.ts`

**Interfaces — Consumes:** `creerEffaceur` (Task 1). **Produces:** `Bandeau` props `{ texte: string | null; annulable: boolean; surAnnuler: () => void }`.

- [ ] E2E d'abord : depuis le détail, « Effacer » puis confirmer → la ligne disparaît, bandeau « Effacé. » + « Annuler » ; aucune requête `DELETE` pendant 4,9 s (`page.clock.fastForward`) ; « Annuler » → ligne revenue, aucune requête ; nouvel effacement → une seule requête après 5 s. Lancer → échec.
- [ ] `Bandeau` : affiche `texte`, bouton « Annuler » si `annulable`. Accueil : `effacer(l)` planifie via l'effaceur (`effaces` contient l'id tout de suite) ; bandeau = effacement en attente (« Effacé. ») si c'est le geste le plus récent, sinon cochage (« Fait. ») ou annonce ; `onDestroy` → `effaceur.vider()` ; échec → id retiré d'`effaces`, annonce `MESSAGES.effaceRate`.
- [ ] Relancer e2e → vert ; `npx vitest run apps/web/test` vert ; commit « Diffère l'effacement de cinq secondes, avec Annuler ».

### Task 3: Glisser ouvre la confirmation

**Files:** Modify `apps/web/src/lib/glisser.ts`, `apps/web/src/lib/composants/LigneAction.svelte`, `apps/web/src/routes/+page.svelte`; Test `apps/web/test/glisser.test.ts`, `apps/web/e2e/a-faire.spec.ts`

- [ ] Tests unitaires : `SEUIL_OUVERTURE` = 96, `DISTANCE_MAX` = 160 ; un glissement horizontal de 100 px → `ouvrir`, de 80 px → `refermer`, vertical → `refermer`. Retirer les tests d'`Ouverture` (logique supprimée). E2E : glisser franchement → feuille visible tout de suite, la ligne revenue à `translateX(0)` ; glisser de 50 px → aucune feuille ; défilement vertical → aucune feuille. Lancer → échec.
- [ ] `glisser.ts` : nouveaux seuils, suppression de `Ouverture`/`creerOuverture`. `LigneAction` : plus de bouton découvert ni de prop d'ouverture ; à `fin() === 'ouvrir'` → `decalage = 0` puis `surEffacer()`. Accueil : retirer la gestion « une ligne ouverte à la fois ». Mettre à jour les e2e de la 1.4.1 qui visaient le bouton découvert.
- [ ] Relancer → vert ; commit « Glisser une action ouvre directement la confirmation ».

### Task 4: À revoir

**Files:** Modify `apps/web/src/routes/a-revoir/+page.svelte`; Test `apps/web/e2e/correction.spec.ts`

- [ ] E2E : « Effacer » sur un item ambigu, confirmer → disparu, « Annuler » pendant 5 s → revenu sans requête ; sinon une seule requête après 5 s. Lancer → échec.
- [ ] Même effaceur et même `Bandeau` dans la page (instance propre, `onDestroy` → `vider`).
- [ ] Relancer → vert ; commit « Applique l'effacement en deux temps à À revoir ».

### Task 5: API de l'historique

**Files:** Create `apps/api/src/historique/historique.service.ts`, `historique.controller.ts`; Modify `apps/api/src/app.module.ts`, `apps/api/src/jetons.ts`, `packages/shared/src/api.ts`; Test `apps/api/test/historique.test.ts`, `apps/api/test/isolation.test.ts`

**Interfaces — Produces** (`packages/shared/src/api.ts`):

```ts
export type SourceEnvoi = 'pwa' | 'telegram';
export type EtatEnvoi = 'en_cours' | 'classee' | 'a_revoir';
export interface EnvoiHistorique { id: string; heure: string; source: SourceEnvoi; vocal: boolean; dureeS: number | null; debut: string | null; etat: EtatEnvoi; natures: Nature[] }
export interface JourHistorique { jour: string; envois: EnvoiHistorique[] }
export type StatutElement = 'a_faire' | 'fait' | 'efface' | 'note';
export interface ElementEnvoi { itemId: string; texte: string; nature: Nature; statut: StatutElement }
export interface DetailEnvoi { id: string; emisLe: string; source: SourceEnvoi; vocal: boolean; dureeS: number | null; etat: EtatEnvoi; texte: string | null; aAudio: boolean; elements: ElementEnvoi[] }
export function debutTexte(texte: string | null, max = 140): string | null; // coupe au dernier espace, ajoute « … »
```

- [ ] Tests (base de test) : liste du mois avec une capture ordinaire classée (2 items action + pensée → `natures: ['action','pensee']`), une en file (`en_cours`, `debut: null`), une privée (absente) ; mois invalide → `MoisInvalide` ; 23 h 30 Paris le 31 → jour du 31 ; détail : statuts `a_faire`/`fait`/`efface`/`note`, privée → `undefined`, autre compte → `undefined`. `debutTexte` : court inchangé, long coupé au dernier espace avec « … », mot unique de 300 caractères coupé à 140. Isolation : autre compte → 404 sur liste (vide) et détail ; capture privée → 404. Aucun texte dans les journaux. Lancer → échec.
- [ ] Implémenter le service (mêmes bornes de mois que `CapturesPriveesService.lister`, `vocal = audioPath !== null || canal === 'telegram' && texteEcrit === null`, tri `emisLe desc`), le contrôleur (`@Controller('api/historique')`, `SessionGuard`, `MoisInvalide` → 400, `undefined` → 404) et l'enregistrement du module.
- [ ] Relancer `npx vitest run --no-file-parallelism apps/api/test/historique.test.ts apps/api/test/isolation.test.ts` → vert ; `pnpm typecheck` ; commit « Ajoute l'API de l'historique des envois ».

### Task 6: Écran Historique

**Files:** Create `apps/web/src/routes/historique/+page.svelte`, `apps/web/src/lib/composants/DetailEnvoi.svelte`, `apps/web/src/lib/historique.ts`; Modify `apps/web/src/lib/api.ts`, `apps/web/src/lib/config.ts`, `apps/web/src/lib/composants/Navigation.svelte`, `apps/web/src/lib/composants/icones.ts`, `apps/web/src/lib/messages.ts`; Test `apps/web/test/historique.test.ts`, `apps/web/test/api.test.ts`, `apps/web/e2e/historique.spec.ts`

**Interfaces — Consumes:** types de Task 5. **Produces:** `api.historique(mois)`, `api.envoi(id)` ; `libelleSource(e): string` (« Vocal », « Vocal, Telegram », « Écrit »), `pastillesEnvoi(e): Pastille[]`, `libelleStatut(s): string | null`.

- [ ] Tests unitaires (`historique.test.ts`, `api.test.ts`) puis e2e : onglet « Historique » dans la barre (4 entrées), liste du mois groupée par jour, ligne avec heure, source, durée, début, pastilles ; mois précédent ; ligne → détail (texte, lecteur, éléments et statuts) ; « Retour » ; état vide « Rien ce mois-ci. ». Lancer → échec.
- [ ] Implémenter : `CHEMINS.historique = '/historique'`, icône `horloge` (`M12 7v5l3 2`, cercle `M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18`), barre en `repeat(4, …)`, page sur le modèle de Privé (navigation par mois, groupes `.groupe`, cartes), panneau `DetailEnvoi` sur le modèle de `DetailItem` (focus au titre, Échap et Retour ferment).
- [ ] Relancer → vert ; commit « Ajoute l'onglet Historique des envois ».

### Task 7: Vérification, documentation, publication

**Files:** Modify `apps/web/e2e/apparence.spec.ts`, `docs/cahier-des-charges.md` (tableau des vues : ligne « Historique »), `CHANGELOG.md`

- [ ] `apparence.spec.ts` : Historique et son détail à 360 px, clair et sombre, sans débordement, cibles de 44 px. Toute la suite : `pnpm lint && pnpm typecheck && pnpm test` puis `npx playwright test`.
- [ ] Revue finale par un relecteur frais ; corrections Critique/Important en TDD.
- [ ] CHANGELOG `[1.6.0]`, fusion dans `main`, étiquette `v1.6.0`, CI verte, déploiement (`docs/exploitation.md`, y compris `docker compose rm -f migrate`), contrôle santé et journaux.
