<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { VueARevoir } from '@organizer/shared/api';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import Bandeau from '$lib/composants/Bandeau.svelte';
  import ConfirmerEffacer from '$lib/composants/ConfirmerEffacer.svelte';
  import { creerEffaceur } from '$lib/effacement';
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

  // Effacer en deux temps, comme dans les listes : l'item part aussitôt, la requête cinq secondes plus tard.
  let effaces = $state<ReadonlySet<string>>(new Set());
  let enAttente = $state<string | null>(null);
  const sansEfface = (id: string): void => { effaces = new Set([...effaces].filter((x) => x !== id)); };
  const effaceur = creerEffaceur({
    effacer: (id) => api.effacer(id),
    surChangement: (e) => { enAttente = e.enAttente; },
    surEchec: (id) => { sansEfface(id); message = MESSAGES.effaceRate; },
  });
  onDestroy(() => effaceur.vider());

  function effacer(itemId: string): void {
    aEffacer = null;
    message = null;
    effaces = new Set([...effaces, itemId]);
    effaceur.planifier(itemId);
  }

  function annulerEffacement(): void {
    const id = effaceur.annuler();
    if (id) sansEfface(id);
  }

  const items = $derived(vue ? vue.items.filter((i) => !effaces.has(i.itemId)) : []);
</script>

<main class="ecran" inert={aEffacer !== null}>
  <header class="entete"><h1>À revoir</h1><p class="sous">{MESSAGES.aRevoirSous}</p></header>
  {#if message}<p class="discret" role="status">{message}</p>{/if}
  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if vue && items.length + vue.captures.length === 0}
    <p class="vide">{MESSAGES.videARevoir}</p>
  {:else if vue}
    {#each items as i (i.itemId)}
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
<Bandeau texte={enAttente ? MESSAGES.efface : null} annulable={enAttente !== null} surAnnuler={annulerEffacement} />
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
