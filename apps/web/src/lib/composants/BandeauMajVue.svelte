<script lang="ts">
  import { MESSAGES } from '$lib/messages';

  /** Vue seule, sans réseau ni service worker : `version` est le numéro proposé, ou null. */
  let { visible, version, surRecharger }: { visible: boolean; version: string | null; surRecharger: () => void } = $props();
</script>

{#if visible}
  <div class="maj" role="status">
    <span>{version ? `${MESSAGES.nouvelleVersion} (v${version}).` : `${MESSAGES.nouvelleVersion}.`}</span>
    <button class="lien" onclick={surRecharger}>{MESSAGES.rechargerBouton}</button>
  </div>
{/if}

<style>
  /* En haut, à l'écart du bas de l'écran déjà pris par l'enregistrement et la navigation. */
  .maj {
    position: fixed; left: var(--cote); right: var(--cote); top: 0; z-index: 6;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: env(safe-area-inset-top) 8px 0 16px;
    min-height: 52px; background: var(--surface); border-bottom: 1px solid var(--line);
    font-size: var(--font-meta); color: var(--muted);
  }
</style>
