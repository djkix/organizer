<script lang="ts">
  import type { LigneAffichee } from '$lib/vues';
  import { creerGlisseur, estGlissement, ouverture } from '$lib/glisser';
  import { MESSAGES } from '$lib/messages';
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
  let decouvert = $state(false);
  let glisse = $state(false);
  let avale = false;

  function refermer(): void { decouvert = false; decalage = 0; ouverture.liberer(ligne.itemId); }
  function ouvrir(): void { decouvert = true; ouverture.ouvrir(ligne.itemId, () => { decouvert = false; decalage = 0; }); }
  // Ligne ouverte : un appui ailleurs ou un défilement la referme.
  $effect(() => {
    if (!decouvert) return;
    const appui = (e: Event): void => {
      const id = (e.target as Element | null)?.closest?.('[data-item]')?.getAttribute('data-item') ?? null;
      if (id === ligne.itemId || (e.target as Element | null)?.closest?.('[role="alertdialog"], [role="dialog"]')) return;
      ouverture.dehors(id);
      // Le premier appui ailleurs ne fait que refermer : le clic qui suit est avalé (une fois, 500 ms au plus).
      const avaler = (c: Event): void => { c.preventDefault(); c.stopPropagation(); fin(); };
      const fin = (): void => { clearTimeout(t); window.removeEventListener('click', avaler, true); };
      const t = setTimeout(fin, 500);
      window.addEventListener('click', avaler, true);
    };
    const defile = (): void => ouverture.dehors(null);
    window.addEventListener('pointerdown', appui, true);
    window.addEventListener('scroll', defile, true);
    return () => { window.removeEventListener('pointerdown', appui, true); window.removeEventListener('scroll', defile, true); };
  });
  function bas(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    avale = false;
    glisseur.debut(e.clientX, e.clientY, decouvert);
  }
  function bouge(e: PointerEvent): void {
    const dx = glisseur.deplacer(e.clientX, e.clientY);
    if (dx === null) return;
    glisse = true;
    avale = estGlissement(dx);
    decalage = decouvert ? Math.min(0, dx - 88) : dx;
  }
  function lache(): void {
    const issue = glisseur.fin();
    if (issue === 'ouvrir') ouvrir();
    else if (issue === 'fermer' || (glisse && decouvert)) refermer();
    glisse = false;
    decalage = decouvert ? -88 : 0;
  }
  function corps(): void {
    if (avale) { avale = false; return; }
    if (decouvert) { refermer(); return; }
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
  /* Sans rouge, même pour effacer : le bouton reste neutre, lisible par son libellé. */
  .effacer {
    position: absolute; inset: 0 0 0 auto; width: 88px; border: none; background: var(--surface-alt); color: var(--text);
    font-weight: 600; font-size: var(--font-meta);
  }

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
