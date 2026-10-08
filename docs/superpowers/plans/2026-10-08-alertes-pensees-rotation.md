# Alertes admin, vue Pensées, rotation de l'audio — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** livrer en 1.7.0 la liste des alertes techniques pour l'admin, l'onglet Pensées et la rotation de l'audio ordinaire.

**Architecture:** l'API enregistre chaque job `alertes` dans une table `alerte` et l'expose à l'admin ; un module `pensees`
(service + contrôleur) lit les pensées du compte ; une classe `RotationAudio` dans l'API purge l'audio ordinaire éligible
chaque heure. La PWA ajoute l'écran Pensées, la section Alertes de Réglages et un point sur l'onglet Réglages.

**Tech Stack:** NestJS 11, Prisma 6 (une migration additive), SvelteKit 2 / Svelte 5, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-alertes-pensees-rotation-design.md`

## Global Constraints

- Admin seulement pour les alertes : un non-admin reçoit 404 sur `/api/alertes*` et ne voit ni section ni point.
- Pensées : nature `pensee`, non archivées, captures non privées, compte de la session ; jamais de case à cocher.
- Rotation : > 40 Go → purge jusqu'à < 35 Go ; ordinaire, texte stocké (`texte_brut` ou `texte_ecrit`), émise il y a plus de 30 jours, `audio_path` non nul ; jamais privée.
- Aucun texte de capture dans les journaux ; messages d'alerte techniques seulement.
- Ni rouge ni orange, aucun nombre visible par L, 16 px, 44 px, français, tutoiement, CSP inchangée ; chaque commit met à jour `CHANGELOG.md`.

## Review Focus

- Job d'alerte rejoué par BullMQ (échec Telegram) : une seule ligne en base.
- Admin qui ouvre Réglages : le point disparaît après « Tout marquer comme vu », revient à la prochaine alerte.
- Pensée corrigée en action depuis le détail : elle quitte la liste Pensées et apparaît dans À faire.
- Fichier audio déjà absent du disque pour une capture éligible : la purge marque quand même la capture, sans planter.
- Capture privée la plus ancienne du volume : jamais touchée, même si c'est le seul moyen de passer sous 35 Go.

---

### Task 1: Alertes enregistrées et exposées à l'admin
**Files:** `packages/db/prisma/schema.prisma` + migration ; `apps/api/src/alertes.ts` ; Create `apps/api/src/alertes/alertes.controller.ts` ; `apps/api/src/app.module.ts` ; `packages/shared/src/api.ts` ; Test `apps/api/test/alertes.test.ts`.
- [ ] Tests : `envoyerAlerte(message, prisma, bot, cle)` crée une ligne, rejoué avec la même clé → une seule ; sans admin lié → ligne quand même ; `GET /api/alertes` admin → liste récente + `nonVues` ; `POST /api/alertes/vues` → toutes vues ; non-admin → 404 sur les deux. Rouge.
- [ ] Modèle `Alerte { id, cle String @unique, message, creeLe, vueLe? }` + migration ; `envoyerAlerte` fait un `upsert` sur `cle` avant Telegram ; le worker BullMQ passe `job.id` ; contrôleur `api/alertes` (SessionGuard, admin sinon 404). Vert ; commit.

### Task 2: Alertes dans la PWA
**Files:** `apps/web/src/lib/api.ts`, `apps/web/src/lib/alertes.ts` (état partagé), `apps/web/src/lib/composants/Navigation.svelte`, `apps/web/src/routes/reglages/+page.svelte`, `apps/web/src/routes/+layout.svelte` ; Test `apps/web/test/api.test.ts`, `apps/web/e2e/alertes.spec.ts`.
- [ ] E2E : admin avec une alerte non vue → point sur Réglages ; Réglages montre la section, « Tout marquer comme vu » → point parti, requête POST ; non-admin → ni point ni section ni requête. Rouge.
- [ ] Client `alertes()`, `marquerAlertesVues()` ; store `alertesNonVues` rafraîchi au montage du layout (si admin) et à `visibilitychange` ; point CSS sur l'onglet ; section Réglages. Vert ; commit.

### Task 3: API des pensées
**Files:** Create `apps/api/src/pensees/pensees.service.ts`, `pensees.controller.ts` ; `apps/api/src/app.module.ts`, `apps/api/src/jetons.ts`, `packages/shared/src/api.ts` ; Test `apps/api/test/pensees.test.ts`, `apps/api/test/isolation.test.ts`.
- [ ] Tests : mois groupé par jour (fuseau), plus récentes d'abord ; filtres thème et personne ; actions, archivées et autre compte exclus ; `themes`/`personnes` distincts triés ; mois invalide → 400 ; isolation à deux comptes. Rouge.
- [ ] Service + contrôleur `api/pensees`. Vert ; commit.

### Task 4: Écran Pensées, barre du bas, Historique dans Réglages
**Files:** Create `apps/web/src/routes/pensees/+page.svelte`, `apps/web/src/lib/composants/DetailPensee.svelte` ; `Navigation.svelte`, `config.ts`, `icones.ts`, `messages.ts`, `api.ts`, `reglages/+page.svelte` ; Test `apps/web/e2e/pensees.spec.ts`, e2e existants (barre).
- [ ] E2E : barre À faire, Pensées, Privé, Réglages ; liste par jour, filtres (une requête avec `theme=`), aucune case à cocher ; détail : transcription, « C'est une chose à faire » → PATCH nature action et la pensée quitte la liste ; « Effacer » → 5 s puis DELETE ; Réglages → « Historique des envois » ouvre l'Historique, onglet Réglages actif. Rouge.
- [ ] Implémentation (modèle : Historique pour la page, DetailItem pour les gestes, effaceur 1.6). Vert ; commit.

### Task 5: Rotation de l'audio
**Files:** Create `apps/api/src/rotation.ts` ; `apps/api/src/app.module.ts`, `apps/api/src/veille/veille.ts` ; Test `apps/api/test/rotation.test.ts`, `apps/api/test/veille.test.ts`.
- [ ] Tests (seuils injectés en octets, fichiers réels dans un dossier temporaire) : sous le seuil haut → rien ; au-dessus → plus anciennes éligibles d'abord jusqu'au seuil bas ; privée, sans texte, récente (< 30 j), déjà purgée → jamais ; fichier absent → capture marquée quand même ; rien d'éligible → alerte une fois par épisode ; veille : seuil 40 Go, nouveau message. Rouge.
- [ ] `RotationAudio.passer()` + minuterie horaire dans l'API ; veille. Vert ; commit.

### Task 6: Vérification, documentation, publication
- [ ] Apparence à 360 px (Pensées, Réglages admin) ; cahier (vues, rotation dans l'API, alertes PWA) ; exploitation (alertes) ; suites complètes ; revue finale fraîche ; CHANGELOG `[1.7.0]` ; fusion, étiquette, CI, déploiement (migration jouée par `migrate`), contrôles.
