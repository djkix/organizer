<script lang="ts">
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, tick } from 'svelte';
  import { jourLocal } from '@organizer/shared/dates';
  import type { LigneAction } from '@organizer/shared/api';
  import { api } from '$lib/client';
  import { creerCocheur, type EtatCochage } from '$lib/cochage';
  import { creerEffaceur } from '$lib/effacement';
  import Bandeau from '$lib/composants/Bandeau.svelte';
  import BandeJours from '$lib/composants/BandeJours.svelte';
  import ConfirmerEffacer from '$lib/composants/ConfirmerEffacer.svelte';
  import DetailItem from '$lib/composants/DetailItem.svelte';
  import LigneActionVue from '$lib/composants/LigneAction.svelte';
  import { FUSEAU } from '$lib/config';
  import { titreDuJour } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import { bandeJours, groupes, NOMS_VUES, nomVue, TITRES, VIDES, type DonneesVue, type NomVue } from '$lib/vues';

  let aujourdhui = $state(jourLocal(new Date(), FUSEAU));
  const vue: NomVue = $derived(nomVue(page.url.searchParams.get('vue')));
  let donnees = $state<DonneesVue | null>(null);
  let erreur = $state(false);
  let selection = $state<LigneAction | null>(null);
  let annonce = $state<string | null>(null);
  let declencheur: HTMLElement | null = null;
  let cochage = $state<EtatCochage>({ retires: new Set(), enCours: null, message: null });
  let numero = 0;
  let aEffacer = $state<LigneAction | null>(null);
  let effaces = $state<ReadonlySet<string>>(new Set());

  const cocheur = creerCocheur({
    cocher: (id) => api.cocher(id),
    decocher: (id) => api.decocher(id),
    surChangement: (e) => { cochage = e; },
  });

  async function charger(nom: NomVue): Promise<void> {
    const demande = ++numero;
    erreur = false;
    try {
      const d: DonneesVue = nom === 'aujourdhui'
        ? { nom, vue: await api.aujourdhui() }
        : nom === 'semaine' ? { nom, vue: await api.semaine() } : { nom, vue: await api.horizons() };
      if (demande === numero) donnees = d;
    } catch {
      if (demande === numero) { donnees = null; erreur = true; }
    }
  }

  $effect(() => { void charger(vue); });

  // Une PWA laissée ouverte une nuit : au retour, le bon jour et la liste à jour.
  $effect(() => {
    const retour = (): void => {
      if (document.visibilityState !== 'visible') return;
      aujourdhui = jourLocal(new Date(), FUSEAU);
      void charger(vue);
    };
    document.addEventListener('visibilitychange', retour);
    return () => document.removeEventListener('visibilitychange', retour);
  });

  function ouvrir(l: LigneAction): void {
    declencheur = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pushState('', { detail: l.itemId });
    selection = l;
  }

  /** Le focus revient à la ligne d'origine si elle existe encore, sinon au titre de la page. */
  async function rendreFocus(): Promise<void> {
    const cible = declencheur;
    declencheur = null;
    await tick();
    (cible?.isConnected ? cible : document.querySelector<HTMLElement>('main h1'))?.focus();
  }

  /** Ferme le détail ; l'entrée d'historique du détail est retirée. */
  function fermer(): void {
    if (!selection) return;
    selection = null;
    if (page.state.detail) history.back();
    void rendreFocus();
  }

  // Retour d'un enregistrement ordinaire : « Reçu. », puis le bandeau se tait.
  $effect(() => {
    if (!page.state.recu) return;
    annonce = MESSAGES.recu;
    const m = setTimeout(() => { if (annonce === MESSAGES.recu) annonce = null; }, 6000);
    return () => clearTimeout(m);
  });

  // Le geste retour d'Android retire l'entrée du détail : le détail se ferme.
  $effect(() => {
    if (selection && !page.state.detail) {
      selection = null;
      void rendreFocus();
    }
  });

  // Le fond (liste et navigation du layout) est inerte tant que le détail est ouvert ; le bandeau d'annulation reste actif.
  $effect(() => {
    const ouvert = selection !== null;
    const fond = document.querySelectorAll('nav[aria-label="Navigation"], .fab');
    fond.forEach((e) => e.toggleAttribute('inert', ouvert));
    return () => fond.forEach((e) => e.removeAttribute('inert'));
  });

  async function corrige(message: string | null): Promise<void> {
    selection = null;
    if (page.state.detail) history.back();
    annonce = message;
    if (message) setTimeout(() => { if (annonce === message) annonce = null; }, 10_000);
    // Focus après le rechargement : la ligne corrigée a pu quitter la liste.
    await charger(vue);
    await rendreFocus();
  }

  const retires = $derived(new Set([...cochage.retires, ...effaces]));
  const liste = $derived(donnees && donnees.nom === vue ? groupes(donnees, aujourdhui, FUSEAU, retires) : []);

  // Effacer en deux temps : la ligne part aussitôt, la requête cinq secondes plus tard, sauf « Annuler ».
  let enAttente = $state<string | null>(null);
  /** Le bandeau suit le geste le plus récent : cochage ou effacement. */
  let dernierGeste = $state<'cochage' | 'effacement'>('cochage');
  const sansEfface = (id: string): void => { effaces = new Set([...effaces].filter((x) => x !== id)); };
  const effaceur = creerEffaceur({
    effacer: (id) => cocheur.enfiler(() => api.effacer(id)),
    surChangement: (e) => { enAttente = e.enAttente; },
    surEchec: (id) => {
      sansEfface(id);
      annonce = MESSAGES.effaceRate;
      setTimeout(() => { if (annonce === MESSAGES.effaceRate) annonce = null; }, 6000);
    },
  });
  // Quitter l'écran pendant le délai : l'intention était claire, l'effacement part.
  onDestroy(() => effaceur.vider());

  async function effacer(l: LigneAction): Promise<void> {
    aEffacer = null;
    if (selection) { selection = null; if (page.state.detail) history.back(); }
    effaces = new Set([...effaces, l.itemId]);
    dernierGeste = 'effacement';
    effaceur.planifier(l.itemId);
    await rendreFocus();
  }

  function annulerEffacement(): void {
    const id = effaceur.annuler();
    if (id) sansEfface(id);
  }

  const bandeau = $derived(
    enAttente && (dernierGeste === 'effacement' || cochage.enCours === null)
      ? { texte: MESSAGES.efface, annulable: true, annuler: annulerEffacement }
      : cochage.enCours !== null
        ? { texte: MESSAGES.fait, annulable: true, annuler: () => void cocheur.annuler() }
        : { texte: cochage.message ?? annonce, annulable: false, annuler: () => {} },
  );

  // Une ligne cochée quitte la liste à la fin du délai d'annulation : si le focus s'y trouvait,
  // il passe à la ligne suivante, sinon au titre. Jamais volé à qui est déjà ailleurs.
  let ordreAvant: string[] = [];
  let nbRetires = 0;
  $effect(() => {
    const ordre = liste.flatMap((g) => g.lignes.map((l) => l.itemId));
    const retires = cochage.retires.size;
    const avant = ordreAvant;
    const grandi = retires > nbRetires;
    ordreAvant = ordre;
    nbRetires = retires;
    if (!grandi) return;
    const actif = document.activeElement;
    if (actif && actif !== document.body && actif.isConnected) return;
    const parti = avant.findIndex((id) => !ordre.includes(id));
    const suivant = parti < 0 ? undefined : avant.slice(parti + 1).find((id) => ordre.includes(id));
    const ligne = suivant ? document.querySelector<HTMLElement>(`[data-item="${CSS.escape(suivant)}"] .case`) : null;
    (ligne ?? document.querySelector<HTMLElement>('main h1'))?.focus();
  });
</script>

<main class="ecran" inert={selection !== null || aEffacer !== null}>
  <header class="entete">
    <h1 tabindex="-1">{TITRES[vue].titre}</h1>
    <p class="sous">{TITRES[vue].sous ?? titreDuJour(aujourdhui)}</p>
  </header>
  <nav class="onglets" aria-label="Listes">
    {#each NOMS_VUES as n (n)}
      <a href="?vue={n}" class="puce" aria-current={n === vue ? 'page' : undefined} data-sveltekit-replacestate data-sveltekit-noscroll>
        {TITRES[n].onglet}
      </a>
    {/each}
  </nav>
  {#if donnees && donnees.nom === 'semaine' && vue === 'semaine'}<BandeJours jours={bandeJours(donnees.vue, aujourdhui, retires)} />{/if}

  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if donnees && donnees.nom === vue && liste.length === 0}
    <p class="vide">{VIDES[vue]}</p>
  {:else}
    {#each liste as g, i (i)}
      {#if g.titre}<h2 class="groupe" id={g.ancre}>{g.titre}</h2>{/if}
      <ul class="liste">
        {#each g.lignes as l (l.itemId)}
          <LigneActionVue
            ligne={l}
            coche={cochage.enCours === l.itemId}
            surCocher={() => { dernierGeste = 'cochage'; cocheur.cocher(l.itemId); }}
            surDecocher={() => void cocheur.annuler()}
            surOuvrir={() => ouvrir(l.source)}
            surEffacer={() => { declencheur = document.activeElement instanceof HTMLElement ? document.activeElement : null; aEffacer = l.source; }}
          />
        {/each}
      </ul>
    {/each}
  {/if}
</main>

<Bandeau texte={bandeau.texte} annulable={bandeau.annulable} surAnnuler={bandeau.annuler} />
{#if selection}
  <DetailItem ligne={selection} surFermer={fermer} surCorrige={(m) => void corrige(m)} enfiler={cocheur.enfiler} surEffacer={() => (aEffacer = selection)} />
{/if}
{#if aEffacer}
  {@const cible = aEffacer}
  <ConfirmerEffacer texte={cible.texte} surConfirmer={() => void effacer(cible)} surAnnuler={() => (aEffacer = null)} />
{/if}

<style>
  h1:focus { outline: none; }
  .onglets {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; margin: 4px 20px 16px;
    background: var(--surface-alt); border-radius: 12px;
  }
  .puce {
    min-height: var(--touch-min); display: flex; align-items: center; justify-content: center; padding: 0 6px; white-space: nowrap;
    border-radius: 9px; color: var(--muted); text-decoration: none; font-size: var(--font-meta); font-weight: 500;
  }
  .puce[aria-current='page'] { background: var(--surface); color: var(--accent-ink); font-weight: 600; outline: 1px solid var(--line); }
  /* Le filet de l'onglet actif ne doit jamais masquer l'anneau de focus. */
  .puce:focus-visible, .puce[aria-current='page']:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .groupe { scroll-margin-top: 16px; }
</style>
