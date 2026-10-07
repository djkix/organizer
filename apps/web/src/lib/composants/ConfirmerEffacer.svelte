<script lang="ts">
  import { onMount } from 'svelte';
  import { MESSAGES } from '$lib/messages';

  let { texte, surConfirmer, surAnnuler }: { texte: string; surConfirmer: () => void; surAnnuler: () => void } = $props();
  let annuler = $state<HTMLButtonElement>();
  // Le focus part sur « Annuler » : le geste le plus sûr est aussi le plus simple.
  onMount(() => annuler?.focus());
</script>

<svelte:window onkeydowncapture={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); surAnnuler(); } }} />

<div class="voile" role="presentation">
  <div class="boite" role="alertdialog" aria-modal="true" aria-labelledby="effacer-titre" aria-describedby="effacer-texte">
    <h2 id="effacer-titre">{MESSAGES.effacerQuestion}</h2>
    <p id="effacer-texte" class="discret">« {texte} »</p>
    <div class="rangee">
      <button class="bouton" bind:this={annuler} onclick={surAnnuler}>{MESSAGES.annulerBouton}</button>
      <button class="bouton plein" onclick={surConfirmer}>{MESSAGES.effacerBouton}</button>
    </div>
  </div>
</div>

<style>
  /* Feuille basse : la question monte du bas de l'écran, à portée du pouce. */
  .voile { position: fixed; inset: 0; z-index: 20; display: flex; align-items: flex-end; background: color-mix(in srgb, var(--text) 35%, transparent); }
  .boite {
    width: 100%; background: var(--surface); border-radius: 24px 24px 0 0;
    padding: 24px 20px calc(24px + env(safe-area-inset-bottom));
  }
  h2 { font-size: 20px; font-weight: 700; }
  .discret { margin: 8px 0 20px; overflow-wrap: anywhere; }
  .rangee { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .plein { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
</style>
