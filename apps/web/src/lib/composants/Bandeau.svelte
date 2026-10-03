<script lang="ts">
  import { MESSAGES } from '$lib/messages';

  let { enCours, message, surAnnuler }: { enCours: boolean; message: string | null; surAnnuler: () => void } = $props();
</script>

{#if enCours || message}
  <div class="bandeau" role="status">
    <span>{enCours ? MESSAGES.fait : message}</span>
    {#if enCours}<button onclick={surAnnuler}>{MESSAGES.annuler}</button>{/if}
  </div>
{/if}

<style>
  .bandeau {
    position: fixed; left: 16px; right: 96px; bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 6;
    min-height: 56px; display: flex; align-items: center; justify-content: space-between;
    padding-left: 16px; border-radius: 14px; background: var(--text); color: var(--bg);
  }
  button {
    min-height: var(--touch-min); min-width: var(--touch-min); padding: 0 16px;
    background: none; border: none; color: var(--bg); font-weight: 600; text-decoration: underline;
  }
</style>
