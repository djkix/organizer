<script lang="ts">
  import type { LigneAffichee } from '$lib/vues';
  import Icone from './Icone.svelte';

  let { ligne, coche, surCocher, surDecocher, surOuvrir }: {
    ligne: LigneAffichee;
    coche: boolean;
    surCocher: () => void;
    surDecocher: () => void;
    surOuvrir: () => void;
  } = $props();
</script>

<li class="ligne" class:coche data-item={ligne.itemId}>
  <button
    class="case"
    role="checkbox"
    aria-checked={coche}
    aria-label="Cocher : {ligne.texte}"
    onclick={() => (coche ? surDecocher() : surCocher())}
  >
    <span class="boite">{#if coche}<Icone nom="coche" taille={16} />{/if}</span>
  </button>
  <button class="corps" onclick={surOuvrir}>
    <span class="texte">{ligne.texte}</span>
    {#if ligne.meta || ligne.alarme}
      <span class="meta">
        {#if ligne.alarme}<span class="cloche"><Icone nom="cloche" taille={14} etiquette="Alarme" /></span>{/if}
        {ligne.meta}
      </span>
    {/if}
  </button>
</li>

<style>
  .ligne { display: flex; align-items: stretch; background: var(--surface); border-radius: var(--radius-card); margin-bottom: 8px; }
  .case { width: var(--touch-min); min-height: var(--touch-min); flex: none; display: grid; place-items: center; padding: 0 0 0 8px; background: none; border: none; }
  .boite { width: 24px; height: 24px; display: grid; place-items: center; border: 2px solid var(--muted); border-radius: 8px; color: var(--bg); }
  .coche .boite { background: var(--accent); border-color: var(--accent); }
  .corps {
    flex: 1; min-height: var(--touch-min); display: flex; flex-direction: column; gap: 2px;
    padding: 12px 16px 12px 6px; text-align: left; background: none; border: none;
  }
  .texte { font-size: var(--font-body); line-height: 1.35; }
  .coche .texte { text-decoration: line-through; color: var(--muted); }
  .meta { display: flex; align-items: center; gap: 6px; font-size: var(--font-meta); color: var(--muted); }
  .cloche { display: inline-flex; color: var(--alarm); }
</style>
