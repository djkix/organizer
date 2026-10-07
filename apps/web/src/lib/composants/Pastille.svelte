<script lang="ts">
  import type { Pastille } from '$lib/pastilles';
  import Icone from './Icone.svelte';

  let { p }: { p: Pastille } = $props();
</script>

<span class="pastille {p.type}">{#if p.icone}<Icone nom={p.icone} taille={12} />{/if}{p.libelle}</span>

<style>
  .pastille {
    display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: var(--radius-pill);
    font-size: 12px; line-height: 1.5; font-weight: 600; white-space: nowrap;
  }
  .action { background: var(--tag-action-bg); color: var(--tag-action-text); }
  .pensee { background: var(--tag-pensee-bg); color: var(--tag-pensee-text); }
  .info { background: var(--tag-info-bg); color: var(--tag-info-text); }
  .arevoir { background: var(--tag-arevoir-bg); color: var(--tag-arevoir-text); }
  .alarme { background: var(--tag-alarme-bg); color: var(--tag-alarme-text); }
  .echeance { background: var(--tag-echeance-bg); color: var(--tag-echeance-text); }
  .prive { background: var(--tag-prive-bg); color: var(--tag-prive-text); }
</style>
