<script lang="ts">
  import { onMount } from 'svelte';
  import type { CorpsCorrection, LigneAction } from '@organizer/shared/api';
  import { ErreurApi, urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import { FUSEAU } from '$lib/config';
  import { appliquerCorrection, choixDepuisChamp, corpsEcheance, corpsNature, type ChoixEcheance } from '$lib/correction';
  import { echeanceEnClair } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';
  import Lecteur from './Lecteur.svelte';

  let { ligne, surFermer, surCorrige, surEffacer, enfiler = (travail) => travail() }: {
    surEffacer: () => void;
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

  // Ce qui a été dit : chargé à l'ouverture ; absent ou en échec, la carte garde le lecteur seul.
  let transcription = $state<string | null>(null);
  let toutLire = $state(false);
  $effect(() => {
    const id = ligne.captureId;
    let actif = true;
    void api.transcription(id).then((t) => { if (actif) transcription = t?.trim() || null; });
    return () => { actif = false; };
  });

  async function corriger(construire: () => CorpsCorrection, apres: string | null): Promise<void> {
    if (envoi) return;
    envoi = true;
    message = null;
    let refus: string | null = null;
    try {
      const r = await appliquerCorrection(construire, (corps) => enfiler(() => api.corriger(ligne.itemId, corps)),
        (e) => { if (e instanceof ErreurApi && e.statut === 400) refus = e.message; });
      if (r === 'faite') surCorrige(apres);
      else message = refus ?? MESSAGES.correctionRatee;
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

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) surFermer(); }} />

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

  {#if ligne.aAudio || transcription}
    <section class="carte lecteur">
      <h3 class="etiquette">Ce que tu as dit</h3>
      {#if transcription}
        <blockquote class="dit" class:replie={!toutLire && transcription.length > 280}>« {transcription} »</blockquote>
        {#if !toutLire && transcription.length > 280}<button class="lien lire" onclick={() => (toutLire = true)}>Lire tout</button>{/if}
      {/if}
      {#if ligne.aAudio}<Lecteur src={urlAudio(ligne.captureId)} />{/if}
    </section>
  {/if}

  {#if ligne.theme}
    <section class="carte"><h3 class="etiquette">Rangé dans</h3><p>{ligne.theme}</p></section>
  {/if}

  <div class="bas actions">
    <button class="bouton" onclick={surEffacer}>{MESSAGES.effacerBouton}</button>
    {#if message}<p class="discret" role="status">{message}</p>{/if}
    <button class="lien" aria-disabled={envoi} onclick={() => corriger(() => corpsNature('pensee'), MESSAGES.rangeEnPensee)}>
      {MESSAGES.pasUneAction}
    </button>
  </div>
</div>

<style>
  .panneau {
    position: fixed; inset: 0; z-index: 10; overflow-y: auto; display: flex; flex-direction: column;
    background: var(--bg); padding: 12px 0 env(safe-area-inset-bottom);
  }
  header { padding: 0 12px; }
  .titre:focus { outline: none; }
  .titre { font-size: 24px; font-weight: 700; line-height: 32px; letter-spacing: -0.01em; padding: 4px 20px 16px; overflow-wrap: anywhere; }
  .etiquette { font-size: var(--font-meta); font-weight: 600; color: var(--muted); margin-bottom: 10px; }
  .quand { font-size: 18px; font-weight: 600; line-height: 26px; margin-bottom: 12px; }
  .choix { display: grid; gap: 8px; }
  .champ { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: var(--touch-min); }
  .champ input {
    min-height: var(--touch-min); padding: 0 10px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--bg); color: var(--text);
  }
  .champ input:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; }
  .interrupteur {
    display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px;
    min-height: var(--touch-min); padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-weight: 600; text-align: left;
  }
  .curseur { position: relative; flex: none; width: 52px; height: 32px; border-radius: var(--radius-pill); background: var(--check); }
  .curseur::after {
    content: ''; position: absolute; top: 4px; left: 4px; width: 24px; height: 24px;
    border-radius: var(--radius-pill); background: var(--surface); transition: transform 0.15s;
  }
  .interrupteur[aria-checked='true'] .curseur { background: var(--accent); }
  .interrupteur[aria-checked='true'] .curseur::after { transform: translateX(20px); }
  .lecteur { display: flex; flex-direction: column; gap: 12px; }
  .lecteur .etiquette { margin-bottom: 0; }
  .dit {
    margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--bg); color: var(--text);
    font-style: italic; line-height: 24px; overflow-wrap: anywhere; white-space: pre-line;
  }
  .replie { display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .lire { align-self: flex-start; padding: 0; }
  .actions { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; padding-bottom: 28px; }
  .actions .discret { flex-basis: 100%; order: -1; }
</style>
