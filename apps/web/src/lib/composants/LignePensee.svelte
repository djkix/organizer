<script lang="ts">
  import type { PenseeListe } from '@organizer/shared/api';
  import { creerGlisseur, estGlissement } from '$lib/glisser';
  import Pastille from './Pastille.svelte';

  let { pensee, surOuvrir, surEffacer }: {
    pensee: PenseeListe;
    surOuvrir: () => void;
    /** Demande d'effacement (la confirmation est posée par l'écran), comme pour une action. */
    surEffacer: () => void;
  } = $props();
  const glisseur = creerGlisseur();
  let decalage = $state(0);
  let glisse = $state(false);
  let avale = false;

  function bas(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    avale = false;
    glisseur.debut(e.clientX, e.clientY);
  }
  function bouge(e: PointerEvent): void {
    const dx = glisseur.deplacer(e.clientX, e.clientY);
    if (dx === null) return;
    glisse = true;
    avale = estGlissement(dx);
    decalage = dx;
  }
  function lache(): void {
    const issue = glisseur.fin();
    glisse = false;
    decalage = 0;
    if (issue === 'ouvrir') surEffacer();
  }
  function corps(): void {
    if (avale) { avale = false; return; }
    surOuvrir();
  }
</script>

<li class="ligne" data-item={pensee.itemId}>
  <button
    class="pensee" class:glisse style:transform="translateX({decalage}px)" onclick={corps}
    onpointerdown={bas} onpointermove={bouge} onpointerup={lache} onpointercancel={() => { glisseur.annuler(); glisse = false; decalage = 0; }}
  >
    <span class="texte">{pensee.texte}</span>
    <span class="meta">
      <span class="heure">{pensee.heure}</span>
      {#if pensee.theme}<Pastille p={{ type: 'pensee', libelle: pensee.theme }} />{/if}
      {#each pensee.personnes as n (n)}<Pastille p={{ type: 'info', libelle: n }} />{/each}
    </span>
  </button>
</li>

<style>
  .ligne { position: relative; overflow: hidden; background: var(--surface-alt); border-radius: 14px; }
  .pensee {
    width: 100%; min-height: 64px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 14px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px; color: var(--text); text-align: left;
    touch-action: pan-y; transition: transform 0.18s ease-out;
  }
  .pensee.glisse { transition: none; }
  .texte {
    line-height: 24px; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .heure { color: var(--muted); margin-right: 4px; }
</style>
