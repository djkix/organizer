<script lang="ts">
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import { jourLocal } from '@organizer/shared/dates';
  import type { LigneAction } from '@organizer/shared/api';
  import { api } from '$lib/client';
  import { creerCocheur, type EtatCochage } from '$lib/cochage';
  import Bandeau from '$lib/composants/Bandeau.svelte';
  import DetailItem from '$lib/composants/DetailItem.svelte';
  import LigneActionVue from '$lib/composants/LigneAction.svelte';
  import { FUSEAU } from '$lib/config';
  import { titreDuJour } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import { groupes, NOMS_VUES, nomVue, TITRES, VIDES, type DonneesVue, type NomVue } from '$lib/vues';

  let aujourdhui = $state(jourLocal(new Date(), FUSEAU));
  const vue: NomVue = $derived(nomVue(page.url.searchParams.get('vue')));
  let donnees = $state<DonneesVue | null>(null);
  let erreur = $state(false);
  let selection = $state<LigneAction | null>(null);
  let annonce = $state<string | null>(null);
  let declencheur: HTMLElement | null = null;
  let cochage = $state<EtatCochage>({ retires: new Set(), enCours: null, message: null });
  let numero = 0;

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

  const liste = $derived(donnees && donnees.nom === vue ? groupes(donnees, aujourdhui, FUSEAU, cochage.retires) : []);
</script>

<main class="ecran" inert={selection !== null}>
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

  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if donnees && donnees.nom === vue && liste.length === 0}
    <p class="vide">{VIDES[vue]}</p>
  {:else}
    {#each liste as g, i (i)}
      {#if g.titre}<h2 class="groupe">{g.titre}</h2>{/if}
      <ul class="liste">
        {#each g.lignes as l (l.itemId)}
          <LigneActionVue
            ligne={l}
            coche={cochage.enCours === l.itemId}
            surCocher={() => cocheur.cocher(l.itemId)}
            surDecocher={() => void cocheur.annuler()}
            surOuvrir={() => ouvrir(l.source)}
          />
        {/each}
      </ul>
    {/each}
  {/if}
</main>

<Bandeau enCours={cochage.enCours !== null} message={cochage.message ?? annonce} surAnnuler={() => void cocheur.annuler()} />
{#if selection}
  <DetailItem ligne={selection} surFermer={fermer} surCorrige={(m) => void corrige(m)} enfiler={cocheur.enfiler} />
{/if}

<style>
  h1:focus { outline: none; }
  .onglets { display: flex; gap: 8px; padding: 4px 20px 12px; overflow-x: auto; scrollbar-width: none; }
  .puce {
    min-height: var(--touch-min); display: inline-flex; align-items: center; padding: 0 16px; white-space: nowrap;
    border: 1px solid var(--line); border-radius: var(--radius-pill); color: var(--muted); text-decoration: none; font-size: var(--font-meta);
  }
  .puce[aria-current='page'] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); font-weight: 600; }
</style>
