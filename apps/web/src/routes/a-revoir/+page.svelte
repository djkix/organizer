<script lang="ts">
  import { onMount } from 'svelte';
  import type { VueARevoir } from '@organizer/shared/api';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import ConfirmerEffacer from '$lib/composants/ConfirmerEffacer.svelte';
  import Lecteur from '$lib/composants/Lecteur.svelte';
  import { FUSEAU } from '$lib/config';
  import { corpsNature } from '$lib/correction';
  import { momentEnClair } from '$lib/format';
  import Pastille from '$lib/composants/Pastille.svelte';
  import { A_REVOIR } from '$lib/pastilles';
  import { MESSAGES } from '$lib/messages';

  let vue = $state<VueARevoir | null>(null);
  let erreur = $state(false);
  let message = $state<string | null>(null);
  let aEffacer = $state<{ itemId: string; texte: string } | null>(null);

  onMount(async () => {
    try {
      vue = await api.aRevoir();
    } catch {
      erreur = true;
    }
  });

  async function trancher(itemId: string, nature: 'action' | 'pensee'): Promise<void> {
    message = null;
    try {
      await api.corriger(itemId, corpsNature(nature));
      if (vue) vue = { ...vue, items: vue.items.filter((i) => i.itemId !== itemId) };
    } catch {
      message = MESSAGES.correctionRatee;
    }
  }

  async function effacer(itemId: string): Promise<void> {
    aEffacer = null;
    message = null;
    try {
      await api.effacer(itemId);
      if (vue) vue = { ...vue, items: vue.items.filter((i) => i.itemId !== itemId) };
      message = MESSAGES.efface;
    } catch {
      message = MESSAGES.effaceRate;
    }
  }
</script>

<main class="ecran" inert={aEffacer !== null}>
  <header class="entete"><h1>À revoir</h1><p class="sous">{MESSAGES.aRevoirSous}</p></header>
  {#if message}<p class="discret" role="status">{message}</p>{/if}
  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if vue && vue.items.length + vue.captures.length === 0}
    <p class="vide">{MESSAGES.videARevoir}</p>
  {:else if vue}
    {#each vue.items as i (i.itemId)}
      <article class="carte">
        <p>« {i.texte} »</p>
        <p class="discret"><Pastille p={A_REVOIR} /> {momentEnClair(i.emisLe, FUSEAU)}</p>
        {#if i.aAudio}<Lecteur src={urlAudio(i.captureId)} />{/if}
        <div class="rangee">
          <button class="bouton" onclick={() => trancher(i.itemId, 'action')}>{MESSAGES.cestAFaire}</button>
          <button class="bouton" onclick={() => trancher(i.itemId, 'pensee')}>{MESSAGES.cestUnePensee}</button>
          <button class="bouton" onclick={() => (aEffacer = { itemId: i.itemId, texte: i.texte })}>{MESSAGES.effacerBouton}</button>
        </div>
      </article>
    {/each}
    {#each vue.captures as c (c.captureId)}
      <article class="carte">
        <p>{c.texte ? `« ${c.texte} »` : MESSAGES.vocalSansTexte}</p>
        <p class="discret"><Pastille p={A_REVOIR} /> {momentEnClair(c.emisLe, FUSEAU)}</p>
        {#if c.aAudio}<Lecteur src={urlAudio(c.captureId)} />{/if}
      </article>
    {/each}
  {/if}
</main>
{#if aEffacer}
  {@const cible = aEffacer}
  <ConfirmerEffacer texte={cible.texte} surConfirmer={() => void effacer(cible.itemId)} surAnnuler={() => (aEffacer = null)} />
{/if}

<style>
  .carte { display: flex; flex-direction: column; gap: 10px; }
  .carte > p:first-child { font-weight: 500; overflow-wrap: anywhere; }
  .carte .discret { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .rangee { margin-top: 2px; }
</style>
