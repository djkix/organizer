<script lang="ts">
  import type { Pastille } from '$lib/pastilles';
  import Icone from './Icone.svelte';

  let { p }: { p: Pastille } = $props();
</script>

<span class="pastille {p.type}">{#if p.icone}<Icone nom={p.icone} taille={16} />{/if}{p.libelle}</span>

<style>
  .pastille {
    display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px; border-radius: 8px;
    font-size: var(--font-meta); line-height: 24px; font-weight: 600; white-space: nowrap;
  }
  .action { background: var(--tag-action-bg); color: var(--tag-action-text); }
  .pensee { background: var(--tag-pensee-bg); color: var(--tag-pensee-text); }
  .info { background: var(--tag-info-bg); color: var(--tag-info-text); }
  .arevoir { background: var(--tag-arevoir-bg); color: var(--tag-arevoir-text); }
  /* L'alarme se dit par la cloche et un contour, jamais par une couleur chaude. */
  .alarme { background: var(--surface); color: var(--accent-ink); border: 1px solid var(--accent); padding: 1px 9px; font-weight: 500; }
  .echeance { background: var(--tag-echeance-bg); color: var(--tag-echeance-text); }
  .prive { background: var(--tag-prive-bg); color: var(--tag-prive-text); }
</style>
