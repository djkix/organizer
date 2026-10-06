<script lang="ts">
  import type { LigneAffichee } from '$lib/vues';
  import { creerGlisseur, estGlissement } from '$lib/glisser';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';

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
  let decouvert = $state(false);
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
    decalage = decouvert ? Math.min(0, dx - 88) : dx;
  }
  function lache(): void {
    if (glisseur.fin() === 'ouvrir') decouvert = true;
    else if (glisse) decouvert = decouvert && decalage <= -44;
    glisse = false;
    decalage = decouvert ? -88 : 0;
  }
  function corps(): void {
    if (avale) { avale = false; return; }
    if (decouvert) { decouvert = false; decalage = 0; return; }
    surOuvrir();
  }
</script>

<li class="ligne" class:coche data-item={ligne.itemId}>
  {#if decouvert}<button class="effacer" aria-label="{MESSAGES.effacerBouton} : {ligne.texte}" onclick={surEffacer}>{MESSAGES.effacerBouton}</button>{/if}
  <div
    role="presentation" class="piste" class:glisse style:transform="translateX({decalage}px)"
    onpointerdown={bas} onpointermove={bouge} onpointerup={lache} onpointercancel={() => { glisseur.annuler(); glisse = false; decalage = decouvert ? -88 : 0; }}
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
    {#if ligne.meta || ligne.alarme}
      <span class="meta">
        {#if ligne.alarme}<span class="cloche"><Icone nom="cloche" taille={14} etiquette="Alarme" /></span>{/if}
        {ligne.meta}
      </span>
    {/if}
  </button>
  </div>
</li>

<style>
  .ligne { position: relative; overflow: hidden; background: var(--surface-alt); border-radius: var(--radius-card); margin-bottom: 8px; }
  .piste { display: flex; align-items: stretch; background: var(--surface); border-radius: var(--radius-card); touch-action: pan-y; transition: transform 0.18s ease-out; }
  .piste.glisse { transition: none; }
  /* Sans rouge, même pour effacer : le bouton reste neutre, lisible par son libellé. */
  .effacer {
    position: absolute; inset: 0 0 0 auto; width: 88px; border: none; background: var(--surface-alt); color: var(--text);
    font-weight: 600; font-size: var(--font-meta);
  }

  .case { width: var(--touch-min); min-height: var(--touch-min); flex: none; display: grid; place-items: center; padding: 0 0 0 8px; background: none; border: none; }
  .boite { width: 24px; height: 24px; display: grid; place-items: center; border: 2px solid var(--muted); border-radius: 8px; color: var(--bg); }
  .coche .boite { background: var(--accent); border-color: var(--accent); }
  .corps {
    flex: 1; min-height: var(--touch-min); display: flex; flex-direction: column; gap: 2px;
    padding: 12px 16px 12px 6px; text-align: left; background: none; border: none;
  }
  .texte { font-size: var(--font-body); line-height: 1.35; }
  .coche .texte { text-decoration: line-through; color: var(--muted); }
  .meta { display: flex; align-items: center; gap: 6px; font-size: var(--font-meta); color: var(--muted); }
  .cloche { display: inline-flex; color: var(--alarm); }
</style>
