<script lang="ts">
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import type { JourHistorique } from '@organizer/shared/api';
  import { jourLocal } from '@organizer/shared/dates';
  import { api } from '$lib/client';
  import DetailEnvoi from '$lib/composants/DetailEnvoi.svelte';
  import Icone from '$lib/composants/Icone.svelte';
  import Pastille from '$lib/composants/Pastille.svelte';
  import { FUSEAU } from '$lib/config';
  import { libelleJour, libelleMois, moisVoisin } from '$lib/format';
  import { libelleSource, pastillesEnvoi } from '$lib/historique';
  import { MESSAGES } from '$lib/messages';

  let aujourdhui = $state(jourLocal(new Date(), FUSEAU));
  const moisCourant = $derived(aujourdhui.slice(0, 7));
  let mois = $state(jourLocal(new Date(), FUSEAU).slice(0, 7));
  let jours = $state<JourHistorique[] | null>(null);
  let erreur = $state(false);
  let selection = $state<string | null>(null);
  let declencheur: HTMLElement | null = null;

  async function charger(m: string): Promise<void> {
    erreur = false;
    try {
      const r = await api.historique(m);
      if (m === mois) jours = r;
    } catch {
      if (m === mois) erreur = true;
    }
  }

  function changerMois(delta: number): void {
    jours = null;
    mois = moisVoisin(mois, delta);
  }

  $effect(() => { void charger(mois); });

  // Laissé ouvert une nuit : au retour sur l'app, le bon jour et la liste à jour.
  $effect(() => {
    const retour = (): void => {
      if (document.visibilityState !== 'visible') return;
      aujourdhui = jourLocal(new Date(), FUSEAU);
      void charger(mois);
    };
    document.addEventListener('visibilitychange', retour);
    return () => document.removeEventListener('visibilitychange', retour);
  });

  function ouvrir(id: string): void {
    declencheur = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pushState('', { envoi: id });
    selection = id;
  }

  /** Le focus revient à la ligne d'origine. */
  async function fermer(): Promise<void> {
    if (!selection) return;
    selection = null;
    if (page.state.envoi) history.back();
    const cible = declencheur;
    declencheur = null;
    await tick();
    (cible?.isConnected ? cible : document.querySelector<HTMLElement>('main h1'))?.focus();
  }

  // Détail ouvert : la barre du bas et le bouton privé, cachés sous le panneau, deviennent inertes.
  $effect(() => {
    const ouvert = selection !== null;
    const fond = document.querySelectorAll('nav[aria-label="Navigation"], .fab');
    fond.forEach((e) => e.toggleAttribute('inert', ouvert));
    return () => fond.forEach((e) => e.removeAttribute('inert'));
  });

  // Le retour Android referme le détail.
  $effect(() => {
    if (selection && !page.state.envoi) void fermer();
  });
</script>

<main class="ecran" inert={selection !== null}>
  <header class="entete"><h1 tabindex="-1">Historique</h1><p class="sous">{MESSAGES.historiqueSous}</p></header>
  <nav class="mois" aria-label="Mois">
    <button class="bouton-icone" onclick={() => changerMois(-1)} aria-label="Mois précédent"><Icone nom="retour" /></button>
    <span>{libelleMois(mois)}</span>
    <button class="bouton-icone" onclick={() => changerMois(1)} disabled={mois >= moisCourant} aria-label="Mois suivant">
      <Icone nom="suivant" />
    </button>
  </nav>
  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if jours && jours.length === 0}
    <p class="vide">{MESSAGES.videPrive}</p>
  {:else if jours}
    {#each jours as j (j.jour)}
      <h2 class="groupe">{libelleJour(j.jour, aujourdhui)}</h2>
      <ul class="liste">
        {#each j.envois as e (e.id)}
          <li>
            <button class="envoi" onclick={() => ouvrir(e.id)}>
              <span class="quand">{e.heure} · {libelleSource(e)}</span>
              <span class="debut" class:absent={!e.debut}>{e.debut ?? MESSAGES.pasEncoreTranscrit}</span>
              {#if pastillesEnvoi(e).length}
                <span class="pastilles">{#each pastillesEnvoi(e) as p (p.libelle)}<Pastille {p} />{/each}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</main>

{#if selection}
  <DetailEnvoi id={selection} surFermer={() => void fermer()} />
{/if}

<style>
  h1:focus { outline: none; }
  .mois { display: flex; align-items: center; justify-content: space-between; padding: 0 20px 4px; font-size: 18px; font-weight: 600; }
  .mois :global(.bouton-icone) { border: 1px solid var(--line); background: var(--surface); }
  .mois :global(.bouton-icone:disabled) { background: transparent; }
  .envoi {
    width: 100%; min-height: 64px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 14px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px; color: var(--text); text-align: left;
  }
  .quand { color: var(--muted); font-weight: 500; }
  .debut {
    font-weight: 500; line-height: 22px; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .debut.absent { color: var(--muted); font-weight: 400; font-style: italic; }
  .pastilles { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
