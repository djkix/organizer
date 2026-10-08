<script lang="ts">
  import { onMount } from 'svelte';
  import type { DetailEnvoi } from '@organizer/shared/api';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import { FUSEAU } from '$lib/config';
  import { momentEnClair } from '$lib/format';
  import { libelleSource, libelleStatut, pastilleNature } from '$lib/historique';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';
  import Lecteur from './Lecteur.svelte';
  import Pastille from './Pastille.svelte';

  /** Détail d'un envoi, en lecture seule : on corrige toujours depuis les listes. */
  let { id, surFermer }: { id: string; surFermer: () => void } = $props();
  let envoi = $state<DetailEnvoi | null>(null);
  let erreur = $state(false);
  let titre = $state<HTMLElement>();

  onMount(() => titre?.focus());

  $effect(() => {
    const demande = id;
    let actif = true;
    envoi = null;
    erreur = false;
    api.envoi(demande).then((d) => { if (actif) envoi = d; }, () => { if (actif) erreur = true; });
    return () => { actif = false; };
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) surFermer(); }} />
<div class="panneau" role="dialog" aria-modal="true" aria-labelledby="titre-envoi">
  <header><button class="bouton-icone" onclick={surFermer} aria-label="Retour"><Icone nom="retour" /></button></header>
  <h2 id="titre-envoi" class="titre" tabindex="-1" bind:this={titre}>{envoi ? momentEnClair(envoi.emisLe, FUSEAU) : 'Envoi'}</h2>
  {#if erreur}
    <p class="discret marge">{MESSAGES.envoiIndisponible}</p>
  {:else if envoi}
    <p class="source">{libelleSource(envoi)}</p>
    <section class="carte bloc">
      <h3 class="etiquette">Ce que tu as dit</h3>
      {#if envoi.texte}<blockquote class="dit">« {envoi.texte} »</blockquote>{:else}<p class="discret">{MESSAGES.pasEncoreTranscrit}</p>{/if}
      {#if envoi.aAudio}<Lecteur src={urlAudio(envoi.id)} />{/if}
    </section>
    <section class="carte bloc">
      <h3 class="etiquette">{MESSAGES.ceQuiEnEstSorti}</h3>
      {#if envoi.elements.length === 0}
        <p class="discret">{MESSAGES.rienDeSorti}</p>
      {:else}
        <ul class="elements">
          {#each envoi.elements as el (el.itemId)}
            <li class:efface={el.statut === 'efface'}>
              <span class="texte">{el.texte}</span>
              <span class="infos">
                <Pastille p={pastilleNature(el.nature)} />
                {#if libelleStatut(el.statut)}<span class="statut">{libelleStatut(el.statut)}</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .panneau {
    position: fixed; inset: 0; z-index: 10; overflow-y: auto; display: flex; flex-direction: column;
    background: var(--bg); padding: 12px 0 calc(24px + env(safe-area-inset-bottom));
  }
  header { padding: 0 12px; }
  .titre:focus { outline: none; }
  .titre { font-size: 24px; font-weight: 700; line-height: 32px; letter-spacing: -0.01em; padding: 4px 20px 4px; }
  .source { color: var(--muted); padding: 0 20px 16px; }
  .marge { padding: 0 20px; }
  .bloc { display: flex; flex-direction: column; gap: 12px; }
  .etiquette { font-size: var(--font-meta); font-weight: 600; color: var(--muted); }
  .dit {
    margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--bg); color: var(--text);
    font-style: italic; line-height: 24px; overflow-wrap: anywhere; white-space: pre-line;
  }
  .elements { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .elements li { display: flex; flex-direction: column; gap: 6px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .elements li:last-child { padding-bottom: 0; border-bottom: none; }
  .texte { font-weight: 500; overflow-wrap: anywhere; }
  .efface .texte { color: var(--muted); text-decoration: line-through; }
  .infos { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .statut { color: var(--muted); font-weight: 500; }
</style>
