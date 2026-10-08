<script lang="ts">
  import { tick } from 'svelte';
  import { api } from '$lib/client';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';

  let { id, valeur }: { id: string; valeur: string | null } = $props();
  let modifiee = $state<string | null | undefined>(undefined);
  const actuelle = $derived(modifiee === undefined ? valeur : modifiee);
  let edition = $state(false);
  let brouillon = $state('');
  let message = $state<string | null>(null);
  let champ = $state<HTMLInputElement>();

  /** Ouvre l'édition, le curseur déjà dans le champ. */
  async function editer(): Promise<void> {
    brouillon = actuelle ?? '';
    edition = true;
    await tick();
    champ?.focus();
  }

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
    <input class="champ-texte" bind:this={champ} bind:value={brouillon} maxlength="80" aria-label="Un mot pour t'y retrouver" />
    <button class="garder" type="submit">Garder</button>
  </form>
  {#if message}<span class="discret" role="status">{message}</span>{/if}
{:else if actuelle}
  <!-- Le mot sert de titre à la ligne ; le crayon le change. -->
  <span class="titre-mot">
    <span class="texte-mot">{actuelle}</span>
    <button class="crayon" aria-label="Changer le mot : {actuelle}" onclick={editer}><Icone nom="crayon" taille={18} /></button>
  </span>
{:else}
  <button class="ajouter" onclick={editer}>{MESSAGES.ajouterUnMot}</button>
{/if}

<style>
  .mot { display: flex; gap: 8px; margin-top: 8px; }
  .mot input { flex: 1; min-width: 0; min-height: var(--touch-min); border: 1.5px solid var(--private); }
  .garder {
    min-height: var(--touch-min); padding: 0 16px; border: none; border-radius: 12px;
    background: var(--private); color: var(--bg); font-weight: 600;
  }
  .titre-mot { order: -1; display: flex; align-items: center; gap: 4px; }
  .texte-mot { flex: 1; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
  .crayon {
    width: var(--touch-min); height: var(--touch-min); flex: none; display: grid; place-items: center;
    border: none; border-radius: var(--radius-pill); background: none; color: var(--private);
  }
  .ajouter {
    min-height: var(--touch-min); padding: 0; background: none; border: none; text-align: left; align-self: flex-start;
    color: var(--private-ink); font-size: var(--font-meta); font-weight: 500; text-decoration: underline; text-underline-offset: 3px;
  }
</style>
