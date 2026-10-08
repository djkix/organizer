<script lang="ts">
  import type { LigneAffichee } from '$lib/vues';
  import { creerGlisseur, estGlissement } from '$lib/glisser';
  import Icone from './Icone.svelte';
  import Pastille from './Pastille.svelte';

  let { ligne, coche, surCocher, surDecocher, surOuvrir, surEffacer }: {
    ligne: LigneAffichee;
    coche: boolean;
    surCocher: () => void;
    surDecocher: () => void;
    surOuvrir: () => void;
    /** Demande d'effacement (la confirmation est posée par l'écran). */
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
  /** Un glissement franc demande l'effacement : la ligne revient en place, la confirmation monte en bas. */
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

<li class="ligne" class:coche data-item={ligne.itemId}>
  <div
    role="presentation" class="piste" class:glisse style:transform="translateX({decalage}px)"
    onpointerdown={bas} onpointermove={bouge} onpointerup={lache} onpointercancel={() => { glisseur.annuler(); glisse = false; decalage = 0; }}
  >
  <button
    class="case"
    role="checkbox"
    aria-checked={coche}
    aria-label="Cocher : {ligne.texte}"
    onclick={() => (coche ? surDecocher() : surCocher())}
  >
    <span class="boite">{#if coche}<Icone nom="coche" taille={16} />{/if}</span>
  </button>
  <button class="corps" onclick={corps}>
    <span class="texte">{ligne.texte}</span>
    {#if ligne.pastilles.length || (ligne.meta && ligne.source.echeanceType !== 'datee')}
      <span class="meta">
        {#each ligne.pastilles as p (p.type)}<Pastille {p} />{/each}
        {#if ligne.meta && ligne.source.echeanceType !== 'datee'}{ligne.meta}{/if}
      </span>
    {/if}
  </button>
  </div>
</li>

<style>
  .ligne { position: relative; overflow: hidden; background: var(--surface-alt); border: 1px solid var(--line); border-radius: 14px; }
  .piste { display: flex; align-items: center; min-height: 64px; background: var(--surface); border-radius: 13px; touch-action: pan-y; transition: transform 0.18s ease-out; }
  .piste.glisse { transition: none; }

  .case { width: var(--touch-min); min-height: var(--touch-min); flex: none; align-self: stretch; display: grid; place-items: center; padding: 0 0 0 4px; background: none; border: none; }
  .boite { width: 22px; height: 22px; display: grid; place-items: center; border: 2px solid var(--check); border-radius: 7px; color: var(--bg); }
  .coche .boite { background: var(--accent); border-color: var(--accent); }
  .corps {
    flex: 1; min-width: 0; min-height: var(--touch-min); display: flex; flex-direction: column; gap: 6px;
    padding: 12px 14px 12px 4px; text-align: left; background: none; border: none;
  }
  .texte { font-size: var(--font-body); line-height: 22px; font-weight: 500; overflow-wrap: anywhere; }
  .coche .texte { text-decoration: line-through; color: var(--muted); }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--font-meta); color: var(--muted); }
</style>
