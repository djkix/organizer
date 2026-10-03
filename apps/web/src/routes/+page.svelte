<script lang="ts">
  import { page } from '$app/state';
  import { jourLocal } from '@organizer/shared/dates';
  import type { LigneAction } from '@organizer/shared/api';
  import { api } from '$lib/client';
  import { creerCocheur, type EtatCochage } from '$lib/cochage';
  import Bandeau from '$lib/composants/Bandeau.svelte';
  import LigneActionVue from '$lib/composants/LigneAction.svelte';
  import { FUSEAU } from '$lib/config';
  import { titreDuJour } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import { groupes, NOMS_VUES, nomVue, TITRES, VIDES, type DonneesVue, type NomVue } from '$lib/vues';

  const aujourdhui = jourLocal(new Date(), FUSEAU);
  const vue: NomVue = $derived(nomVue(page.url.searchParams.get('vue')));
  let donnees = $state<DonneesVue | null>(null);
  let erreur = $state(false);
  let selection = $state<LigneAction | null>(null);
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

  const liste = $derived(donnees && donnees.nom === vue ? groupes(donnees, aujourdhui, FUSEAU, cochage.retires) : []);
</script>

<main class="ecran">
  <header class="entete">
    <h1>{TITRES[vue].titre}</h1>
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
    {#each liste as g, i (g.titre ?? i)}
      {#if g.titre}<h2 class="groupe">{g.titre}</h2>{/if}
      <ul class="liste">
        {#each g.lignes as l (l.itemId)}
          <LigneActionVue
            ligne={l}
            coche={cochage.enCours === l.itemId}
            surCocher={() => cocheur.cocher(l.itemId)}
            surDecocher={() => void cocheur.annuler()}
            surOuvrir={() => (selection = l.source)}
          />
        {/each}
      </ul>
    {/each}
  {/if}
</main>

<Bandeau enCours={cochage.enCours !== null} message={cochage.message} surAnnuler={() => void cocheur.annuler()} />

<style>
  .onglets { display: flex; gap: 8px; padding: 4px 20px 12px; overflow-x: auto; scrollbar-width: none; }
  .puce {
    min-height: var(--touch-min); display: inline-flex; align-items: center; padding: 0 16px; white-space: nowrap;
    border: 1px solid var(--line); border-radius: var(--radius-pill); color: var(--muted); text-decoration: none; font-size: var(--font-meta);
  }
  .puce[aria-current='page'] { background: var(--accent-soft); border-color: var(--accent); color: var(--text); font-weight: 600; }
</style>
