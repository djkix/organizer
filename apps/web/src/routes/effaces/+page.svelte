<script lang="ts">
  import { onMount } from 'svelte';
  import type { ElementEfface } from '@organizer/shared/api';
  import { api } from '$lib/client';
  import Pastille from '$lib/composants/Pastille.svelte';
  import { FUSEAU } from '$lib/config';
  import { momentEnClair } from '$lib/format';
  import { pastilleNature } from '$lib/historique';
  import { MESSAGES } from '$lib/messages';

  let elements = $state<ElementEfface[] | null>(null);
  let erreur = $state(false);
  let message = $state<string | null>(null);
  let envoi = $state<string | null>(null);

  onMount(async () => {
    try {
      elements = await api.effaces();
    } catch {
      erreur = true;
    }
  });

  // L'élément retrouve ses listes d'origine ; il quitte celle-ci.
  async function remettre(e: ElementEfface): Promise<void> {
    if (envoi) return;
    envoi = e.itemId;
    message = null;
    try {
      await api.restaurer(e.itemId);
      elements = (elements ?? []).filter((x) => x.itemId !== e.itemId);
      message = MESSAGES.remis;
    } catch {
      message = MESSAGES.remiseRatee;
    } finally {
      envoi = null;
    }
  }
</script>

<main class="ecran">
  <header class="entete"><h1>{MESSAGES.effacesTitre}</h1><p class="sous">{MESSAGES.effacesSous}</p></header>
  <p class="discret message" role="status">{message ?? ''}</p>
  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if elements && elements.length === 0}
    <p class="vide">{MESSAGES.videEffaces}</p>
  {:else if elements}
    <ul class="liste">
      {#each elements as e (e.itemId)}
        <li class="carte efface">
          <p class="texte">{e.texte}</p>
          <p class="discret meta"><Pastille p={pastilleNature(e.nature)} /> {momentEnClair(e.effaceLe, FUSEAU)}</p>
          <button class="bouton" onclick={() => void remettre(e)} disabled={envoi !== null} aria-label={`${MESSAGES.remettre} : ${e.texte}`}>{MESSAGES.remettre}</button>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .message { padding: 0 22px; min-height: 1em; }
  .efface { display: flex; flex-direction: column; gap: 10px; }
  .texte { font-weight: 500; overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .efface .bouton { align-self: flex-start; }
</style>
