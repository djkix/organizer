<script lang="ts">
  import { api } from '$lib/client';
  import { MESSAGES } from '$lib/messages';

  let { id, valeur }: { id: string; valeur: string | null } = $props();
  let modifiee = $state<string | null | undefined>(undefined);
  const actuelle = $derived(modifiee === undefined ? valeur : modifiee);
  let edition = $state(false);
  let brouillon = $state('');
  let message = $state<string | null>(null);

  async function garder(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const nouvelle = brouillon.trim() || null;
    try {
      await api.etiqueter(id, nouvelle);
      modifiee = nouvelle;
      edition = false;
      message = null;
    } catch {
      message = MESSAGES.motRate;
    }
  }
</script>

{#if edition}
  <form class="mot" onsubmit={garder}>
    <input bind:value={brouillon} maxlength="80" aria-label="Un mot pour t'y retrouver" />
    <button class="bouton" type="submit">Garder</button>
  </form>
  {#if message}<span class="discret" role="status">{message}</span>{/if}
{:else}
  <button class="ajouter" onclick={() => { brouillon = actuelle ?? ''; edition = true; }}>{actuelle ?? MESSAGES.ajouterUnMot}</button>
{/if}

<style>
  .mot { display: flex; gap: 8px; margin-top: 6px; }
  .mot input {
    flex: 1; min-height: var(--touch-min); padding: 0 12px; border: 1px solid var(--muted); border-radius: 12px;
    background: var(--surface); color: var(--text);
  }
  .ajouter {
    min-height: var(--touch-min); padding: 0; background: none; border: none; text-align: left;
    color: var(--muted); font-size: var(--font-meta); text-decoration: underline;
  }
</style>
