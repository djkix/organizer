<script lang="ts">
  import { MESSAGES } from '$lib/messages';

  let { enCours, message, surAnnuler }: { enCours: boolean; message: string | null; surAnnuler: () => void } = $props();
</script>

<div class="bandeau" class:vide={!enCours && !message}>
  <!-- Zone vocale toujours montée : seul son texte change, pour que TalkBack l'annonce. -->
  <span role="status" aria-live="polite">{enCours ? MESSAGES.fait : (message ?? '')}</span>
  {#if enCours}<button onclick={surAnnuler}>{MESSAGES.annuler}</button>{/if}
</div>

<style>
  .bandeau {
    position: fixed; left: 16px; right: 16px; bottom: calc(176px + env(safe-area-inset-bottom)); z-index: 11;
    min-height: 56px; display: flex; align-items: center; justify-content: space-between;
    padding-left: 16px; border-radius: 14px; background: var(--text); color: var(--bg);
  }
  .bandeau.vide { height: 0; min-height: 0; padding: 0; overflow: hidden; pointer-events: none; }
  button {
    min-height: var(--touch-min); min-width: var(--touch-min); padding: 0 16px;
    background: none; border: none; color: var(--bg); font-weight: 600; text-decoration: underline;
  }
</style>
