<script lang="ts">
  import type { Snippet } from 'svelte';
  import { creerGlisseur, estGlissement } from '$lib/glisser';

  /** Ligne qu'on glisse vers la gauche pour demander l'effacement ; l'appui qui suit un glissement est avalé. */
  let { surEffacer, children, classe = '' }: { surEffacer: () => void; children: Snippet; classe?: string } = $props();
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
  function appui(e: MouseEvent): void {
    if (!avale) return;
    avale = false;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div
  role="presentation" class="piste {classe}" class:glisse style:transform="translateX({decalage}px)" onclickcapture={appui}
  onpointerdown={bas} onpointermove={bouge} onpointerup={lache} onpointercancel={() => { glisseur.annuler(); glisse = false; decalage = 0; }}
>
  {@render children()}
</div>

<style>
  .piste { touch-action: pan-y; transition: transform 0.18s ease-out; }
  .piste.glisse { transition: none; }
</style>
