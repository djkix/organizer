# Refonte de l'interface — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** habiller toute la PWA dans la direction « Sérénité affinée » de la maquette validée, ajouter la transcription dans le détail et le crayon du mot privé, puis publier et déployer la 1.5.0.

**Architecture:** les couleurs restent pilotées par `design/tokens.json` (testé) et `design/tokens.css` (consommé par `apps/web/src/app.css`) ; chaque composant Svelte garde son comportement et ne change que de style ; une route API en lecture seule fournit la transcription.

**Tech Stack:** SvelteKit 2 / Svelte 5 statique, NestJS 11, Prisma 6, Vitest, Playwright, `@fontsource-variable/plus-jakarta-sans`.

**Spec:** `docs/superpowers/specs/2026-10-07-refonte-interface-design.md` — maquette : https://claude.ai/artifact/9CFZaw7oQPYcDq1GLChqK5 (copie des sources dans le dossier de travail de la session, à ne pas versionner).

## Global Constraints

- Contraste WCAG AA (4,5) sur tous les textes, 3 pour icônes et bords de commandes, 7 pour les deux grands boutons, dans les deux thèmes.
- Zones tactiles de 44 px minimum ; texte de 16 px minimum partout (fini le 14 px des métadonnées).
- Ni rouge ni orange ; aucun compteur, pourcentage, jauge ni félicitation ; pas d'emoji ; repère Privé visible dès la première image.
- Messages visibles en français, tutoiement, moins de 12 mots ; les libellés existants de `apps/web/src/lib/messages.ts` restent ceux de la 1.4.2 sauf « Jour » → « Dans la journée ».
- Police auto-hébergée, aucune ressource externe (CSP inchangée).
- Chaque commit met à jour `CHANGELOG.md` (« Non publié ») ; documentation en français ; aucune donnée réelle dans les fixtures ou captures.
- Une capture privée n'est jamais transcrite ni exposée par la nouvelle route.

## Review Focus

- Texte long (action de 120 caractères, mot privé de 80) à 360 px de large : la carte passe à la ligne, ne déborde pas, les pastilles restent sous le texte.
- Transcription absente, vide ou en erreur réseau : le détail affiche le lecteur seul, sans message d'erreur.
- Thème sombre forcé par `data-theme="dark"` (pas seulement `prefers-color-scheme`) : mêmes jetons que le sombre système.
- Semaine où le jour courant n'a aucune action : la bande le montre quand même en accent, sans ancre morte.
- `prefers-reduced-motion: reduce` : l'onde de l'enregistreur ne bouge pas.

---

### Task 1: Palette et jetons

**Files:**
- Modify: `design/tokens.json`, `design/tokens.css`
- Test: `apps/web/test/contrastes.test.ts`

**Interfaces:**
- Produces: variables CSS `--bg --surface --surface-alt --text --muted --accent --accent-soft --accent-ink --private --private-soft --private-ink --private-bg --check --line --cta --cta-text --cta-edge --cta-private --cta-private-text --cta-private-edge --tag-*-bg --tag-*-text --radius-card(16px) --radius-pill --touch-min(44px) --font-body(16px) --font-meta(16px) --font-title(28px) --line-height(1.5)`. `--alarm` est supprimé.

- [ ] **Step 1: Test d'abord.** Dans `contrastes.test.ts`, retirer `['alarm', 'surface']` d'`ICONES`, ajouter à `TEXTES` : `['accentInk','accentSoft'] ['accentInk','surface'] ['accentInk','surfaceAlt'] ['muted','surfaceAlt'] ['privateInk','privateSoft'] ['privateInk','privateBg'] ['text','privateBg'] ['muted','privateBg']`, à `ICONES` : `['check','surface'] ['private','privateBg']`, et un test « aucun jeton nommé alarm ».
- [ ] **Step 2:** `pnpm --filter web exec vitest run test/contrastes.test.ts` → échec (jetons absents).
- [ ] **Step 3: Valeurs** (`tokens.json`, mêmes clés en `light` et `dark`) :

| Clé | light | dark |
| --- | --- | --- |
| bg | #F6F8F9 | #0F1416 |
| surface | #FFFFFF | #182024 |
| surfaceAlt | #E8EDEF | #1D272B |
| text | #172024 | #E7EDEF |
| muted | #4B575D | #A7B3B8 |
| accent | #00677D | #5FC3DD |
| accentSoft | #DDEFF4 | #12333B |
| accentInk | #00515F | #9ADDEE |
| private | #5B4B8A | #A797D9 |
| privateSoft | #EEEAF6 | #2A2440 |
| privateInk | #463874 | #C9BDF0 |
| privateBg | #F7F6FA | #13111B |
| check | #7D8A90 | #6F7D83 |
| line | #DCE3E6 | #2A3539 |
| cta / ctaText / ctaEdge | #005A6C / #FFFFFF / #00404D | #8AD8EC / #04262E / #5FC3DD |
| ctaPrivate / ctaPrivateText / ctaPrivateEdge | #4A3B78 / #FFFFFF / #2F2552 | #C4B8F0 / #1A1330 / #8B7BC4 |
| tagEcheance Bg/Text | #DDEFF4 / #00515F | #12333B / #9ADDEE |
| tagAlarme Bg/Text | #CFE6EC / #003F4B | #0B3E49 / #B8E9F5 |
| tagAction Bg/Text | #E2EFEA / #1E5548 | #173229 / #9FD8C4 |
| tagPensee Bg/Text | #E3E8F4 / #2C4A7A | #25304A / #B6C9F0 |
| tagInfo Bg/Text | #E8EDEF / #2E3A40 | #232D31 / #C9D3D7 |
| tagArevoir Bg/Text | #ECE9E1 / #4E4630 | #36322A / #E0D5B8 |
| tagPrive Bg/Text | #EEEAF6 / #463874 | #2A2440 / #C9BDF0 |

Reporter les mêmes valeurs dans `tokens.css` (bloc `:root`, bloc `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`, bloc `:root[data-theme="dark"]`), en kebab-case, plus les mesures ci-dessus. Remplacer tout `var(--alarm)` dans `apps/web/src` par `var(--accent)`.
- [ ] **Step 4:** même commande → vert (toutes les paires ont été calculées : AA, AAA pour les grands boutons).
- [ ] **Step 5:** commit « Passe la palette en Sérénité affinée » avec CHANGELOG (« Modifié »).

### Task 2: Police et socle CSS

**Files:**
- Modify: `apps/web/package.json`, `apps/web/src/app.css`, `apps/web/src/routes/+layout.svelte`
- Test: `apps/web/test/regles-produit.test.ts` (inchangé, doit rester vert), `pnpm --filter web build` + `node apps/web/scripts/budget.mjs`

- [ ] **Step 1:** `pnpm --filter web add @fontsource-variable/plus-jakarta-sans` ; dans `+layout.svelte`, `import '@fontsource-variable/plus-jakarta-sans/wght.css';` avant `app.css`.
- [ ] **Step 2:** `app.css` : `font-family: 'Plus Jakarta Sans Variable', system-ui, sans-serif;` ; `.entete { padding: 28px 20px 12px }`, `.entete h1 { font-size: var(--font-title); font-weight: 700; letter-spacing: -0.02em; line-height: 36px }` ; `.sous`, `.discret`, `.groupe` à `var(--font-meta)` (16 px) ; `.groupe { font-weight: 700; color: var(--text); padding: 14px 20px 8px }` ; `.carte { border: 1px solid var(--line); border-radius: var(--radius-card) }` ; `.bouton { border-radius: 12px; border: 1px solid var(--line); background: var(--surface) }` ; `.bouton-principal { border-radius: 14px; background: var(--accent); color: var(--bg) }` ; `.lien { color: var(--accent-ink); text-underline-offset: 4px; font-weight: 600 }` ; `:focus-visible` inchangé.
- [ ] **Step 3:** `pnpm --filter web build && node apps/web/scripts/budget.mjs` → sous 150 Ko ; `pnpm --filter web exec vitest run` → vert.
- [ ] **Step 4:** vérifier dans `infra/caddy` que la CSP sert `font-src 'self'` (ou `default-src 'self'`) ; sinon l'ajouter et adapter `apps/web/e2e/csp.spec.ts`.
- [ ] **Step 5:** commit « Adopte Plus Jakarta Sans et le socle de la nouvelle interface ».

### Task 3: Composants de liste et barre du bas

**Files:**
- Modify: `apps/web/src/lib/composants/LigneAction.svelte`, `Pastille.svelte`, `BoutonsEnregistrer.svelte`, `BoutonPrive.svelte`, `Navigation.svelte`, `Bandeau.svelte`, `apps/web/src/lib/pastilles.ts`
- Test: `apps/web/test/pastilles.test.ts`, `apps/web/e2e/a-faire.spec.ts`

- [ ] **Step 1: Test** : dans `pastilles.test.ts`, l'échéance `jour` donne `{ type: 'echeance', libelle: 'Dans la journée' }`. Lancer → échec.
- [ ] **Step 2:** `pastilles.ts` : `'Jour'` → `'Dans la journée'`. Relancer → vert.
- [ ] **Step 3: Styles** (maquette, artboard « Aujourd'hui — clair ») :
  - `LigneAction` : carte `background: var(--surface); border: 1px solid var(--line); border-radius: 14px; min-height: 64px; padding: 6px 12px 6px 4px; margin: 0 0 10px`, case de 22 px à bord `2px var(--check)` dans une cible de 44 px, cochée en `var(--accent)` avec coche `var(--bg)` ; texte 16 px / 500 ; pastilles en ligne sous le texte (`flex-wrap: wrap; gap: 6px`). Le glissement et « Effacer » gardent leur logique.
  - `Pastille` : `border-radius: 8px; padding: 2px 10px; font-size: 16px; font-weight: 600; line-height: 24px` ; type `alarme` : fond `var(--surface)`, bord `1px solid var(--accent)`, texte `var(--accent-ink)`, cloche 16 px.
  - `BoutonsEnregistrer` : grille `2fr 1fr`, gap 10 px, marge `12px 20px 14px`, boutons de 64 px, rayon 18 px, liseré `inset 0 -3px 0 var(--cta-edge)` / `var(--cta-private-edge)`, icônes 24/22 px, 18 px / 600.
  - `BoutonPrive` (hors accueil) : même style que le bouton Privé, pleine largeur, libellé « Enregistrer en privé » sur l'écran Privé seulement si le composant le permet déjà ; sinon libellé inchangé.
  - `Navigation` : fond `var(--surface)`, filet haut `var(--line)`, entrées de 56 px, libellés 16 px, icône active dans une pastille `var(--accent-soft)` (`padding: 2px 18px; border-radius: 999px`) et texte `var(--accent-ink)` ; sur l'écran Privé, l'entrée active prend `var(--private-soft)` / `var(--private-ink)`.
  - `Bandeau` : rayon 14 px, fond `var(--text)`, texte `var(--bg)`.
- [ ] **Step 4:** `pnpm --filter web exec vitest run && pnpm --filter web exec playwright test e2e/a-faire.spec.ts` → vert (adapter les sélecteurs fondés sur un texte « Jour »).
- [ ] **Step 5:** commit « Habille les lignes, les pastilles et la barre du bas ».

### Task 4: Accueil, onglets et bande de jours

**Files:**
- Modify: `apps/web/src/routes/+page.svelte`, `apps/web/src/lib/vues.ts`
- Create: `apps/web/src/lib/composants/BandeJours.svelte`
- Test: `apps/web/test/vues.test.ts`

**Interfaces:**
- Produces: `export interface JourBande { jour: string; abrege: string; numero: number; courant: boolean; ancre: string | null }` et `export function bandeJours(vue: VueSemaine, aujourdhui: string): JourBande[]` dans `vues.ts` (7 jours à partir d'`aujourdhui`, `abrege` en « Lun » … « Dim », `ancre` = `jour-<AAAA-MM-JJ>` si le jour a au moins une action, sinon `null`).

- [ ] **Step 1: Test** dans `vues.test.ts` :

```ts
import { bandeJours } from '../src/lib/vues';
it('bande de sept jours, jour courant marqué, ancres sur les jours non vides', () => {
  const vue = { jours: [{ jour: '2026-10-08', actions: [ligne()] }, { jour: '2026-10-12', actions: [ligne()] }] };
  const b = bandeJours(vue, '2026-10-07');
  expect(b.map((j) => `${j.abrege} ${j.numero}`)).toEqual(['Mer 7', 'Jeu 8', 'Ven 9', 'Sam 10', 'Dim 11', 'Lun 12', 'Mar 13']);
  expect(b[0]).toMatchObject({ courant: true, ancre: null });
  expect(b[1]!.ancre).toBe('jour-2026-10-08');
  expect(b[2]!.ancre).toBeNull();
});
```

(`ligne()` : fabrique de `LigneAction` déjà présente dans le fichier, ou à y ajouter avec des valeurs fabriquées.)
- [ ] **Step 2:** lancer → échec (`bandeJours` absent).
- [ ] **Step 3:** implémenter `bandeJours` avec les dates en UTC à midi pour éviter les décalages (`new Date(`${aujourdhui}T12:00:00Z`)`, `+ i * 86_400_000`, jour de semaine par `getUTCDay()`, table `['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']`).
- [ ] **Step 4:** relancer → vert.
- [ ] **Step 5: Accueil** : `nav.onglets` devient une piste segmentée (`display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 4px; padding: 4px; background: var(--surface-alt); border-radius: 12px; margin: 4px 20px 16px`), onglet de 44 px, actif : fond `var(--surface)`, texte `var(--accent-ink)`, 600, ombre `0 1px 2px rgb(0 0 0 / 0.08)`. En vue `semaine`, insérer `<BandeJours jours={bandeJours(donnees.vue, aujourdhui)} />` sous les onglets et poser `id={'jour-' + g.jour}` sur chaque titre de groupe (étendre `groupes()` pour exposer `jour` si nécessaire). `BandeJours` : `nav aria-label="Jours"`, grille de 7 colonnes, cases de 64 px (abrégé 16 px / 500 au-dessus, numéro 18 px / 700) ; courant : fond `var(--accent)`, texte `var(--bg)`, `aria-current="date"` ; avec ancre : carte `var(--surface)` + filet, lien `href="#jour-…"` ; sans ancre : texte `var(--muted)`, `<span>` non cliquable.
- [ ] **Step 6:** `pnpm --filter web exec vitest run && pnpm --filter web exec playwright test e2e/a-faire.spec.ts` → vert.
- [ ] **Step 7:** commit « Ajoute la bande de jours de la semaine et les onglets segmentés ».

### Task 5: Route de transcription

**Files:**
- Modify: `apps/api/src/items/items.service.ts`, `apps/api/src/items/items.controller.ts`, `apps/web/src/lib/api.ts`
- Test: `apps/api/test/items.test.ts`, `apps/api/test/isolation.test.ts`

**Interfaces:**
- Produces: `ItemsService.transcription(utilisateurId: string, captureId: string): Promise<string | null | undefined>` (`undefined` = introuvable, privée ou autre compte) ; `GET /api/captures/:id/transcription` → `200 { texte: string | null }` ou 404 ; client `api.transcription(captureId: string): Promise<string | null>`.

- [ ] **Step 1: Tests** dans `items.test.ts` (base de test, tunnel ouvert) :

```ts
describe('transcription', () => {
  it('rend texte_brut, sinon texte_ecrit, sinon null', async () => {
    const { captureId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const moi = await compteTest(prisma);
    await prisma.capture.update({ where: { id: captureId }, data: { texteBrut: 'Appeler le garage jeudi.', texteEcrit: null } });
    expect(await service.transcription(moi, captureId)).toBe('Appeler le garage jeudi.');
    await prisma.capture.update({ where: { id: captureId }, data: { texteBrut: null, texteEcrit: 'Écrit.' } });
    expect(await service.transcription(moi, captureId)).toBe('Écrit.');
    await prisma.capture.update({ where: { id: captureId }, data: { texteEcrit: null } });
    expect(await service.transcription(moi, captureId)).toBeNull();
  });
  it('ne rend jamais une capture privée ni celle d\'un autre compte', async () => {
    const { captureId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await prisma.capture.update({ where: { id: captureId }, data: { prive: true, texteBrut: 'x' } });
    expect(await service.transcription(await compteTest(prisma), captureId)).toBeUndefined();
    await prisma.capture.update({ where: { id: captureId }, data: { prive: false } });
    const autre = (await prisma.utilisateur.create({ data: { nom: 'autre-compte' } })).id;
    expect(await service.transcription(autre, captureId)).toBeUndefined();
  });
});
```

(si `creerAction` ne renvoie pas `captureId`, l'y ajouter dans `aides-items.ts`.) Dans `isolation.test.ts`, ajouter la route à la liste des routes vérifiées à deux comptes (404 pour l'autre compte), au format des cas existants.
- [ ] **Step 2:** `pnpm --filter api exec vitest run test/items.test.ts` → échec.
- [ ] **Step 3: Service** :

```ts
/** Ce que l'utilisatrice a dit : jamais pour une capture privée (aucune transcription n'existe), jamais pour un autre compte. */
async transcription(utilisateurId: string, captureId: string): Promise<string | null | undefined> {
  const c = await this.prisma.capture.findFirst({ where: { id: captureId, utilisateurId, prive: false }, select: { texteBrut: true, texteEcrit: true } });
  if (!c) return undefined;
  return c.texteBrut ?? c.texteEcrit ?? null;
}
```

Contrôleur, à côté de `audio` :

```ts
@Get('captures/:id/transcription')
async transcription(@Req() req: RequeteAuthentifiee, @Param('id', ParseUUIDPipe) id: string): Promise<{ texte: string | null }> {
  const texte = await this.items.transcription(req.utilisateur.id, id);
  if (texte === undefined) throw new NotFoundException('Élément introuvable.');
  return { texte };
}
```

Client `api.ts` : `transcription(captureId: string): Promise<string | null>` qui appelle `GET /api/captures/${encodeURIComponent(captureId)}/transcription` avec la même fonction de requête que `etiqueter`, et renvoie `null` sur toute erreur.
- [ ] **Step 4:** `pnpm --filter api exec vitest run test/items.test.ts test/isolation.test.ts && pnpm typecheck` → vert.
- [ ] **Step 5:** commit « Expose la transcription d'une capture ordinaire dans le détail » (CHANGELOG « Ajouté »).

### Task 6: Détail et confirmation d'effacement

**Files:**
- Modify: `apps/web/src/lib/composants/DetailItem.svelte`, `ConfirmerEffacer.svelte`, `Lecteur.svelte`
- Test: `apps/web/e2e/correction.spec.ts`

- [ ] **Step 1:** `DetailItem` : à l'ouverture, `api.transcription(ligne.captureId)` dans un `$effect` (résultat dans un `$state<string | null>(null)`, aucune erreur affichée). Carte « Ce que tu as dit » visible si `ligne.aAudio || transcription` : citation `« … »` (fond `var(--bg)`, rayon 12 px, italique, 16 px, `-webkit-line-clamp: 6` + bouton lien « Lire tout » quand le texte dépasse, qui retire la limite), puis `Lecteur`.
- [ ] **Step 2: Styles** (artboard « Détail ») : titre 24 px / 700 ; cartes `.carte` ; étiquettes de carte 16 px / 600 `var(--muted)` ; « Quand » en 18 px / 600 ; choix en boutons de 44 px rayon 12 px, le choix courant bordé `1.5px var(--accent)` sur `var(--accent-soft)` ; interrupteur 52 × 32 px en `var(--accent)` ; bas : « Effacer » en `.bouton` à gauche, « Ce n'est pas une chose à faire » en `.lien` à droite.
- [ ] **Step 3:** `Lecteur` : bouton rond de 48 px `var(--accent)` (ou `var(--private)` via une prop `teinte` déjà passée par l'écran Privé si elle existe ; sinon ajouter `teinte?: 'accent' | 'prive'`, défaut `accent`), durée en chiffres tabulaires.
- [ ] **Step 4:** `ConfirmerEffacer` : feuille basse (`position: fixed; inset: auto 0 0 0; border-radius: 24px 24px 0 0; padding: 24px 20px calc(24px + env(safe-area-inset-bottom))`, voile `rgb(0 0 0 / 0.3)`), textes et boutons inchangés.
- [ ] **Step 5:** ajouter à `correction.spec.ts` un cas : détail ouvert, la transcription simulée apparaît entre guillemets ; transcription en 404 → seul le lecteur reste. `pnpm --filter web exec playwright test e2e/correction.spec.ts` → vert.
- [ ] **Step 6:** commit « Habille le détail et y montre ce que tu as dit ».

### Task 7: Enregistreur

**Files:**
- Modify: `apps/web/src/lib/composants/Enregistreur.svelte`
- Test: `apps/web/e2e/enregistrer.spec.ts`, `apps/web/e2e/prive.spec.ts`, `apps/web/test/enregistreur.test.ts`

- [ ] **Step 1: Styles** (artboards « Enregistrement » et « Enregistrement privé ») : fermer en haut à gauche (48 px) ; pastille de 88 px (`var(--accent-soft)` / micro `var(--accent)`, ou `var(--private-soft)` / cadenas `var(--private)` en privé) ; « J'écoute » 28 px / 700 ; phrase de mode 18 px / 600 en encre ; consigne 16 px `var(--muted)` ; onde de 16 barres de 4 px (`aria-hidden`), animée en `@keyframes` (hauteur 30 % ↔ 100 %, décalages par barre) seulement quand `etat === 'ecoute'`, immobile sous `@media (prefers-reduced-motion: reduce)` ; minuteur 32 px / 600 chiffres tabulaires ; bouton rond de 96 px (`var(--accent)` ou `var(--private)`) avec halo `0 0 0 10px` en teinte douce, carré de 32 px `var(--bg)` pendant l'écoute, rond sinon ; l'écran privé prend `var(--private-bg)` en fond. Aucune logique ni texte modifié.
- [ ] **Step 2:** `pnpm --filter web exec vitest run test/enregistreur.test.ts && pnpm --filter web exec playwright test e2e/enregistrer.spec.ts e2e/prive.spec.ts` → vert (le repère privé reste visible dès la première image).
- [ ] **Step 3:** commit « Habille l'écran d'enregistrement ».

### Task 8: Écran Privé et mot

**Files:**
- Modify: `apps/web/src/routes/prive/+page.svelte`, `apps/web/src/lib/composants/Etiquette.svelte`
- Test: `apps/web/e2e/prive.spec.ts`

- [ ] **Step 1:** `Etiquette` : sans mot, bouton lien « Ajouter un mot » (`MESSAGES.ajouterUnMot` passe à `'Ajouter un mot'`, majuscule), 44 px, `var(--private-ink)` souligné ; avec mot, le mot s'affiche en titre (16 px / 600, `var(--text)`) et un bouton crayon de 44 px (`aria-label="Changer le mot"`, icône `crayon` à ajouter dans `icones.ts` : chemins `M12 20h9` et `M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z`) ouvre l'édition ; en édition, champ de 44 px bordé `1.5px var(--private)`, bouton « Garder » plein `var(--private)`. Exposer le mot via un slot ou une prop pour que la ligne place le titre au-dessus de « heure · durée ».
- [ ] **Step 2:** page Privé : fond `var(--private-bg)` ; bandeau garde `var(--private-soft)` / `var(--private-ink)` avec cadenas ; navigation par mois en boutons ronds de 44 px bordés ; lignes en cartes (lecteur violet à gauche, puis mot en titre ou heure seule, « heure · durée » en `var(--muted)`, crayon à droite) ; titres de jour en `.groupe`, « Aujourd'hui » en `var(--private-ink)`.
- [ ] **Step 3:** compléter `prive.spec.ts` : ajouter un mot, le voir en titre, le changer par le crayon. `pnpm --filter web exec playwright test e2e/prive.spec.ts` → vert.
- [ ] **Step 4:** commit « Habille l'écran Privé et met le mot en titre ».

### Task 9: Réglages, Connexion, À revoir

**Files:**
- Modify: `apps/web/src/routes/reglages/+page.svelte`, `apps/web/src/routes/connexion/+page.svelte`, `apps/web/src/routes/a-revoir/+page.svelte`
- Test: `apps/web/e2e/connexion.spec.ts`, `apps/web/e2e/agenda.spec.ts`, `apps/web/e2e/empreinte.spec.ts`

- [ ] **Step 1:** remplacer les styles locaux par les classes du socle (`.carte`, `.bouton`, `.bouton-principal`, `.lien`) ; champs de saisie de 52 px, rayon 12 px, bord `1px var(--line)`, focus `2px var(--accent)` ; À revoir : lignes en cartes comme `LigneAction`, pastille « À revoir ».
- [ ] **Step 2:** `pnpm --filter web exec playwright test` (toute la suite) → vert.
- [ ] **Step 3:** commit « Habille Réglages, Connexion et À revoir ».

### Task 10: Vérification complète et documentation

**Files:**
- Modify: `design/maquettes.html`, `CHANGELOG.md`, `docs/cahier-des-charges.md` (section Accessibilité : « 16 px minimum » déjà présent ; ajouter la police)
- Create: `apps/web/e2e/apparence.spec.ts`

- [ ] **Step 1:** `apparence.spec.ts` : à 360 × 780 et 390 × 844, en clair et en `colorScheme: 'dark'`, ouvrir Aujourd'hui, Semaine, un détail et Privé avec les données simulées de `simul.ts` (dont une action de 120 caractères et un mot de 80) ; vérifier qu'aucun élément ne dépasse la largeur (`document.documentElement.scrollWidth <= innerWidth`) et que chaque bouton/lien visible mesure au moins 44 px de haut.
- [ ] **Step 2:** `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web exec playwright test` → tout vert.
- [ ] **Step 3:** `design/maquettes.html` : page courte qui renvoie à la maquette Claude Design et affiche la palette des deux thèmes depuis `tokens.css`.
- [ ] **Step 4:** commit « Vérifie l'apparence à 360 px et documente la nouvelle palette ».

### Task 11: Publication et déploiement 1.5.0

- [ ] **Step 1:** fusion `--ff-only` de la branche dans `main` (après revue finale de la branche par un relecteur frais).
- [ ] **Step 2:** `CHANGELOG.md` : « Non publié » → `[1.5.0] - <date>` ; commit « Publie la version 1.5.0 » ; `git tag -a v1.5.0 -m "Version 1.5.0 : nouvelle interface"` ; `git push origin main v1.5.0`.
- [ ] **Step 3:** attendre la CI de l'étiquette (`tests`, `images`, `publication` verts).
- [ ] **Step 4:** déploiement selon `docs/exploitation.md` « Mettre à jour » : copie de la base, `ORGANIZER_VERSION=1.5.0`, `pull`, `up -d --wait`, `ps -a`, `/api/sante`.
- [ ] **Step 5:** contrôle : `curl -s https://organizer.djkix.ovh/` sert la nouvelle coquille (présence de la police dans les ressources), journaux sans erreur, et mise à jour de la mémoire de session.
