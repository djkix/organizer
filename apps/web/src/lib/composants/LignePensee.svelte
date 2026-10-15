<script lang="ts">
  import type { PenseeListe } from '@organizer/shared/api';
  import Glissable from './Glissable.svelte';
  import Pastille from './Pastille.svelte';

  let { pensee, surOuvrir, surEffacer }: {
    pensee: PenseeListe;
    surOuvrir: () => void;
    /** Demande d'effacement (la confirmation est posée par l'écran), comme pour une action. */
    surEffacer: () => void;
  } = $props();
</script>

<li class="ligne" data-item={pensee.itemId}>
  <Glissable {surEffacer}>
    <button class="pensee" onclick={surOuvrir}>
      <span class="texte">{pensee.texte}</span>
      <span class="meta">
        <span class="heure">{pensee.heure}</span>
        {#if pensee.theme}<Pastille p={{ type: 'pensee', libelle: pensee.theme }} />{/if}
        {#each pensee.personnes as n (n)}<Pastille p={{ type: 'info', libelle: n }} />{/each}
      </span>
    </button>
  </Glissable>
</li>

<style>
  .ligne { position: relative; overflow: hidden; background: var(--surface-alt); border-radius: 14px; }
  .pensee {
    width: 100%; min-height: 64px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 14px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px; color: var(--text); text-align: left;
  }
  .texte {
    line-height: 24px; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .heure { color: var(--muted); margin-right: 4px; }
</style>
