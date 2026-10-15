<script lang="ts">
  import { onMount } from 'svelte';
  import type { ElementEfface, PriveeEffacee } from '@organizer/shared/api';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import Lecteur from '$lib/composants/Lecteur.svelte';
  import Pastille from '$lib/composants/Pastille.svelte';
  import { FUSEAU } from '$lib/config';
  import { duree, momentEnClair } from '$lib/format';
  import { pastilleNature } from '$lib/historique';
  import { MESSAGES } from '$lib/messages';

  let elements = $state<ElementEfface[] | null>(null);
  let privees = $state<PriveeEffacee[] | null>(null);
  let erreur = $state(false);
  let message = $state<string | null>(null);
  let envoi = $state<string | null>(null);

  onMount(async () => {
    try {
      [elements, privees] = await Promise.all([api.effaces(), api.priveesEffacees()]);
    } catch {
      erreur = true;
    }
  });

  // L'élément retrouve ses listes d'origine (ou la vue Privé) ; il quitte celle-ci.
  async function remettre(id: string, prive: boolean): Promise<void> {
    if (envoi) return;
    envoi = id;
    message = null;
    try {
      await (prive ? api.restaurerPrivee(id) : api.restaurer(id));
      if (prive) privees = (privees ?? []).filter((x) => x.id !== id);
      else elements = (elements ?? []).filter((x) => x.itemId !== id);
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
  {:else if elements && privees && elements.length + privees.length === 0}
    <p class="vide">{MESSAGES.videEffaces}</p>
  {:else if elements && privees}
    <ul class="liste">
      {#each elements as e (e.itemId)}
        <li class="carte efface">
          <p class="texte">{e.texte}</p>
          <p class="discret meta"><Pastille p={pastilleNature(e.nature)} /> {momentEnClair(e.effaceLe, FUSEAU)}</p>
          <button class="bouton" onclick={() => void remettre(e.itemId, false)} disabled={envoi !== null} aria-label={`${MESSAGES.remettre} : ${e.texte}`}>{MESSAGES.remettre}</button>
        </li>
      {/each}
    </ul>
    {#if privees.length > 0}
      <h2 class="groupe">{MESSAGES.enregistrementsPrives}</h2>
      <ul class="liste">
        {#each privees as c (c.id)}
          <li class="carte efface prive">
            <p class="texte">{momentEnClair(c.emisLe, FUSEAU)}{c.dureeS !== null ? ` · ${duree(c.dureeS)}` : ''}</p>
            {#if c.etiquette}<p>{c.etiquette}</p>{/if}
            {#if c.aAudio}<Lecteur src={urlAudio(c.id)} libelle="Écouter, {momentEnClair(c.emisLe, FUSEAU)}" teinte="prive" />{/if}
            <p class="discret">{MESSAGES.efface} {momentEnClair(c.effaceLe, FUSEAU)}</p>
            <button class="bouton" onclick={() => void remettre(c.id, true)} disabled={envoi !== null} aria-label={`${MESSAGES.remettre} : ${MESSAGES.enregistrementDe} ${momentEnClair(c.emisLe, FUSEAU)}`}>{MESSAGES.remettre}</button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</main>

<style>
  .message { padding: 0 22px; min-height: 1em; }
  .efface { display: flex; flex-direction: column; gap: 10px; }
  .texte { font-weight: 500; overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .efface .bouton { align-self: flex-start; }
  .prive { background: var(--private-bg); border-color: var(--private-soft); }
</style>
