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
  .voile { position: fixed; inset: 0; z-index: 20; display: grid; place-items: end center; background: color-mix(in srgb, var(--text) 45%, transparent); padding: 16px; }
  .boite { width: 100%; max-width: 420px; background: var(--surface); border-radius: var(--radius-card); padding: 20px; margin-bottom: env(safe-area-inset-bottom); }
  h2 { font-size: 20px; font-weight: 600; }
  .discret { margin: 8px 0 16px; overflow-wrap: anywhere; }
  .rangee { display: flex; gap: 12px; justify-content: flex-end; }
  .plein { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
</style>
