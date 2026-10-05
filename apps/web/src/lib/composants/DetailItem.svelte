<script lang="ts">
  import { onMount } from 'svelte';
  import type { CorpsCorrection, LigneAction } from '@organizer/shared/api';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import { FUSEAU } from '$lib/config';
  import { appliquerCorrection, choixDepuisChamp, corpsEcheance, corpsNature, type ChoixEcheance } from '$lib/correction';
  import { echeanceEnClair } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';
  import Lecteur from './Lecteur.svelte';

  let { ligne, surFermer, surCorrige, enfiler = (travail) => travail() }: {
    ligne: LigneAction;
    surFermer: () => void;
    surCorrige: (message: string | null) => void;
    /** File des écritures de l'écran : la correction part après les cochages en cours. */
    enfiler?: <T>(travail: () => Promise<T>) => Promise<T>;
  } = $props();
  let message = $state<string | null>(null);
  let envoi = $state(false);
  let titre = $state<HTMLElement>();

  onMount(() => titre?.focus());

  async function corriger(construire: () => CorpsCorrection, apres: string | null): Promise<void> {
    if (envoi) return;
    envoi = true;
    message = null;
    try {
      const r = await appliquerCorrection(construire, (corps) => enfiler(() => api.corriger(ligne.itemId, corps)));
      if (r === 'faite') surCorrige(apres);
      else message = MESSAGES.correctionRatee;
    } finally {
      envoi = false;
    }
  }

  function echeance(c: ChoixEcheance | null): void {
    if (c) void corriger(() => corpsEcheance(c, FUSEAU), MESSAGES.cestNote);
  }

  const depuisChamp = (type: 'jour' | 'avant' | 'datee') => (e: Event): void =>
    echeance(choixDepuisChamp(type, (e.currentTarget as HTMLInputElement).value));
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') surFermer(); }} />

<div class="panneau" role="dialog" aria-labelledby="titre-detail">
  <header><button class="bouton-icone" onclick={surFermer} aria-label="Retour"><Icone nom="retour" /></button></header>
  <h2 id="titre-detail" class="titre" tabindex="-1" bind:this={titre}>{ligne.texte}</h2>

  <section class="carte">
    <h3 class="etiquette">Quand</h3>
    <p class="quand">{echeanceEnClair(ligne, FUSEAU)}</p>
    <div class="choix">
      <button class="bouton" aria-disabled={envoi} onclick={() => echeance({ type: 'aucune' })}>Sans date</button>
      <label class="champ">Un jour<input type="date" aria-disabled={envoi} onchange={depuisChamp('jour')} /></label>
      <label class="champ">Jour et heure<input type="datetime-local" aria-disabled={envoi} onchange={depuisChamp('datee')} /></label>
      <label class="champ">Avant le<input type="date" aria-disabled={envoi} onchange={depuisChamp('avant')} /></label>
    </div>
  </section>

  {#if ligne.echeanceType === 'datee'}
    <section class="carte">
      <button
        class="interrupteur" role="switch" aria-checked={ligne.alarme} aria-disabled={envoi}
        onclick={() => corriger(() => ({ alarme: !ligne.alarme }), ligne.alarme ? MESSAGES.alarmeRetiree : MESSAGES.alarmeActivee)}
      >
        <span>{MESSAGES.alarme}</span><span class="curseur" aria-hidden="true"></span>
      </button>
      <p class="discret">{MESSAGES.alarmeAide}</p>
    </section>
  {/if}

  {#if ligne.aAudio}
    <section class="carte lecteur">
      <h3 class="etiquette">Ce que tu as dit</h3>
      <Lecteur src={urlAudio(ligne.captureId)} />
    </section>
  {/if}

  {#if ligne.theme}
    <section class="carte"><h3 class="etiquette">Rangé dans</h3><p>{ligne.theme}</p></section>
  {/if}

  <div class="bas">
    {#if message}<p class="discret" role="status">{message}</p>{/if}
    <button class="lien" aria-disabled={envoi} onclick={() => corriger(() => corpsNature('pensee'), MESSAGES.rangeEnPensee)}>
      {MESSAGES.pasUneAction}
    </button>
  </div>
</div>

<style>
  .panneau {
    position: fixed; inset: 0; z-index: 10; overflow-y: auto; display: flex; flex-direction: column;
    background: var(--bg); padding: 8px 0 env(safe-area-inset-bottom);
  }
  header { padding: 0 8px; }
  .titre:focus { outline: none; }
  .titre { font-size: 22px; font-weight: 400; line-height: 1.3; padding: 4px 20px 14px; }
  .etiquette { font-size: var(--font-meta); font-weight: 400; color: var(--muted); margin-bottom: 8px; }
  .quand { margin-bottom: 12px; }
  .choix { display: grid; gap: 8px; }
  .champ { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: var(--touch-min); }
  .champ input {
    min-height: var(--touch-min); padding: 0 10px; border: 1px solid var(--muted); border-radius: 12px;
    background: var(--surface); color: var(--text);
  }
  .interrupteur {
    display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px;
    min-height: var(--touch-min); padding: 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left;
  }
  .curseur { position: relative; flex: none; width: 44px; height: 26px; border-radius: var(--radius-pill); background: var(--muted); }
  .curseur::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px;
    border-radius: var(--radius-pill); background: var(--surface); transition: transform 0.15s;
  }
  .interrupteur[aria-checked='true'] .curseur { background: var(--accent); }
  .interrupteur[aria-checked='true'] .curseur::after { transform: translateX(18px); }
</style>
