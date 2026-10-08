<script lang="ts">
  import { onMount } from 'svelte';
  import type { PenseeListe } from '@organizer/shared/api';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';
  import Lecteur from './Lecteur.svelte';
  import Pastille from './Pastille.svelte';

  /** Détail d'une pensée : jamais cochable ; on peut la ranger en action ou l'effacer. */
  let { pensee, quand, envoi, surFermer, surAction, surEffacer }: {
    pensee: PenseeListe;
    quand: string;
    envoi: boolean;
    surFermer: () => void;
    surAction: () => void;
    surEffacer: () => void;
  } = $props();
  let titre = $state<HTMLElement>();
  let transcription = $state<string | null>(null);

  onMount(() => titre?.focus());

  $effect(() => {
    const id = pensee.captureId;
    let actif = true;
    void api.transcription(id).then((t) => { if (actif) transcription = t?.trim() || null; });
    return () => { actif = false; };
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) surFermer(); }} />
<div class="panneau" role="dialog" aria-modal="true" aria-labelledby="titre-pensee">
  <header><button class="bouton-icone" onclick={surFermer} aria-label="Retour"><Icone nom="retour" /></button></header>
  <h2 id="titre-pensee" class="titre" tabindex="-1" bind:this={titre}>{pensee.texte}</h2>
  <p class="quand">{quand}</p>
  {#if pensee.theme || pensee.personnes.length}
    <p class="pastilles">
      {#if pensee.theme}<Pastille p={{ type: 'pensee', libelle: pensee.theme }} />{/if}
      {#each pensee.personnes as n (n)}<Pastille p={{ type: 'info', libelle: n }} />{/each}
    </p>
  {/if}
  {#if pensee.aAudio || transcription}
    <section class="carte bloc">
      <h3 class="etiquette">Ce que tu as dit</h3>
      {#if transcription}<blockquote class="dit">« {transcription} »</blockquote>{/if}
      {#if pensee.aAudio}<Lecteur src={urlAudio(pensee.captureId)} />{/if}
    </section>
  {/if}
  <div class="bas actions">
    <button class="bouton" onclick={surEffacer}>{MESSAGES.effacerBouton}</button>
    <button class="lien" aria-disabled={envoi} onclick={surAction}>{MESSAGES.uneChoseAFaire}</button>
  </div>
</div>

<style>
  .panneau {
    position: fixed; inset: 0; z-index: 10; overflow-y: auto; display: flex; flex-direction: column;
    background: var(--bg); padding: 12px 0 env(safe-area-inset-bottom);
  }
  header { padding: 0 12px; }
  .titre:focus { outline: none; }
  .titre { font-size: 22px; font-weight: 600; line-height: 30px; padding: 4px 20px 6px; overflow-wrap: anywhere; }
  .quand { color: var(--muted); padding: 0 20px 10px; }
  .pastilles { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 20px 16px; }
  .bloc { display: flex; flex-direction: column; gap: 12px; }
  .etiquette { font-size: var(--font-meta); font-weight: 600; color: var(--muted); }
  .dit {
    margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--bg); color: var(--text);
    font-style: italic; line-height: 24px; overflow-wrap: anywhere; white-space: pre-line;
  }
  .actions { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; padding-bottom: 28px; }
</style>
