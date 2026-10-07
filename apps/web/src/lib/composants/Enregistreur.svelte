<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { beforeNavigate, goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { demarrageAuto, sansAuto } from '$lib/prive/auto';
  import Icone from '$lib/composants/Icone.svelte';
  import { CHEMINS } from '$lib/config';
  import { chrono } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import { garderEtEnvoyer } from '$lib/prive/demarrage';
  import { creerEnregistreur } from '$lib/prive/enregistreur';
  import { envoyerCapture, EnregistrementVide, type Enregistrement, type ModeCapture } from '$lib/prive/file';

  /** Fixé par la route qui monte l'écran, jamais déduit de l'enregistrement (règle n° 6). Aucun repli : il est obligatoire. */
  let { mode }: { mode: ModeCapture } = $props();
  const prive = $derived(mode === 'prive');
  const apres = async (): Promise<void> => {
    if (prive) await goto(CHEMINS.prive);
    else await goto(CHEMINS.accueil, { state: { recu: true } });
  };

  let etat = $state<'pret' | 'demarrage' | 'ecoute' | 'rangement'>('pret');
  let secondes = $state(0);
  let message = $state<string | null>(null);
  let aGarder = $state<Enregistrement | null>(null);
  /** Fixé avec l'enregistrement : la file et l'envoi direct le reprennent, le serveur ne voit jamais de doublon. */
  let idDirect = '';
  let reessai = $state<HTMLButtonElement>();
  let minuterie: ReturnType<typeof setInterval> | undefined;
  let detruit = false;
  const enregistreur = creerEnregistreur({
    surInterruption: () => void arreter(),
    surLimite: () => void arreter(false, MESSAGES.heureAtteinte),
  });
  const statut = $derived(etat === 'ecoute' ? MESSAGES.ecoute : '');

  function messageMicro(err: unknown): string {
    const nom = err instanceof DOMException ? err.name : '';
    if (nom === 'NotReadableError' || nom === 'AbortError') return MESSAGES.microOccupe;
    if (nom === 'NotFoundError' || nom === 'OverconstrainedError') return MESSAGES.microAbsent;
    return MESSAGES.microRefuse;
  }

  async function commencer(): Promise<void> {
    if (etat !== 'pret' || aGarder) return;
    message = null;
    etat = 'demarrage';
    try {
      await enregistreur.demarrer();
    } catch (err) {
      etat = 'pret';
      message = messageMicro(err);
      return;
    }
    if (detruit) {
      // L'écran a été quitté pendant l'autorisation : le micro est rendu aussitôt.
      enregistreur.liberer();
      return;
    }
    etat = 'ecoute';
    secondes = 0;
    minuterie = setInterval(() => (secondes += 1), 1000);
    // Écran verrouillé pendant l'ouverture du micro (décision R9) : rien n'enregistre écran éteint.
    if (document.visibilityState === 'hidden') void arreter(false);
  }

  async function garder(e: Enregistrement, apresEnvoi: boolean): Promise<void> {
    etat = 'rangement';
    try {
      await garderEtEnvoyer(e, mode, idDirect);
      aGarder = null;
      etat = 'pret';
      if (apresEnvoi) await apres();
    } catch (err) {
      etat = 'pret';
      if (err instanceof EnregistrementVide) {
        message = MESSAGES.rienEnregistre;
      } else {
        // Échec d'écriture locale : l'audio reste en mémoire, un nouvel essai est proposé.
        aGarder = e;
        message = MESSAGES.gardeRatee;
      }
    }
  }

  // Dernier recours quand le téléphone ne sait pas garder : l'audio en mémoire part directement.
  async function envoyerDirect(e: Enregistrement): Promise<void> {
    etat = 'rangement';
    message = null;
    const r = await envoyerCapture({ id: idDirect, mode, ...e });
    if (r.issue === 'livre') {
      aGarder = null;
      etat = 'pret';
      await apres();
      return;
    }
    etat = 'pret';
    message = MESSAGES.envoiRate;
  }

  async function arreter(apresEnvoi = true, avis: string | null = null): Promise<void> {
    if (etat !== 'ecoute') return;
    etat = 'rangement';
    clearInterval(minuterie);
    let e: Enregistrement;
    try {
      e = await enregistreur.arreter();
      idDirect = crypto.randomUUID();
    } catch {
      etat = 'pret';
      message = MESSAGES.rienEnregistre;
      return;
    }
    await garder(e, apresEnvoi);
    if (!aGarder && !message) message = avis ?? (apresEnvoi ? null : MESSAGES.garde);
  }

  // Fermer pendant l'enregistrement garde ce qui a été dit : rien ne se perd.
  function fermer(): void {
    if (aGarder || etat === 'rangement') return;
    if (etat === 'ecoute') void arreter();
    else void goto(CHEMINS.accueil);
  }

  // L'audio en mémoire n'a pas d'autre copie : ni retour, ni lien, ni fermeture ne le jettent.
  beforeNavigate(({ cancel }) => {
    if (aGarder || etat === 'rangement') cancel();
  });

  $effect(() => {
    if (!aGarder) return;
    const garde = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', garde);
    return () => window.removeEventListener('beforeunload', garde);
  });

  $effect(() => {
    if (aGarder) reessai?.focus();
  });

  onMount(() => {
    // Entrée explicite (bouton, raccourci) : on démarre sans second appui. Le paramètre est retiré
    // d'abord, pour qu'un retour ou un rechargement n'enregistre pas de nouveau. Refus du micro : message calme et bouton manuel.
    const auto = demarrageAuto(page.url);
    if (auto) {
      void tick().then(() => {
        replaceState(sansAuto(page.url), page.state);
        if (!detruit) void commencer();
      });
    }
    // Écran quitté (appel, verrouillage) : on range plutôt que de risquer la perte.
    const cache = (): void => {
      if (document.visibilityState === 'hidden') void arreter();
    };
    document.addEventListener('visibilitychange', cache);
    return () => document.removeEventListener('visibilitychange', cache);
  });

  onDestroy(() => {
    detruit = true;
    clearInterval(minuterie);
    if (etat === 'ecoute') void arreter(false);
    else enregistreur.liberer();
  });
</script>

<main class="enregistreur" class:ordinaire={!prive}>
  <button class="bouton-icone fermer" onclick={fermer} aria-label="Fermer"><Icone nom="fermer" /></button>
  {#if prive}
    <span class="pastille-mode"><Icone nom="cadenas" taille={40} etiquette="Mode privé" /></span>
    <h1>{etat === 'ecoute' ? MESSAGES.ecoute : MESSAGES.enregistrementPrive}</h1>
    <p class="maison">{MESSAGES.resteALaMaison}</p>
    <p class="consigne">{etat === 'ecoute' ? MESSAGES.finirEnregistrement : MESSAGES.rienNestTrie}</p>
  {:else}
    <span class="pastille-mode"><Icone nom="micro" taille={40} etiquette="Enregistrement ordinaire" /></span>
    <h1>{etat === 'ecoute' ? MESSAGES.ecoute : MESSAGES.enregistrementOrdinaire}</h1>
    <p class="maison">{MESSAGES.envoyeAuTri}</p>
    <p class="consigne">{etat === 'ecoute' ? MESSAGES.finirEnregistrement : MESSAGES.rangeToutSeul}</p>
  {/if}
  <!-- Onde décorative : elle bouge pendant l'écoute, jamais sous « réduire les animations ». -->
  <div class="onde" class:active={etat === 'ecoute'} aria-hidden="true">
    {#each { length: 16 } as _, i (i)}<span></span>{/each}
  </div>
  <div role="status" aria-live="polite">
    <span class="sr">{statut}</span>
    {#if message}<p class="consigne">{message}</p>{/if}
  </div>

  <div class="commandes">
    <p class="minuteur">{etat === 'ecoute' ? chrono(secondes) : ''}</p>
    {#if aGarder}
      <button class="bouton reessayer" bind:this={reessai} onclick={() => aGarder && garder(aGarder, true)} disabled={etat === 'rangement'}>{MESSAGES.reessayer}</button>
      <button class="bouton reessayer" onclick={() => aGarder && envoyerDirect(aGarder)} disabled={etat === 'rangement'}>{MESSAGES.envoyerMaintenant}</button>
    {:else}
      <!-- Un seul bouton, jamais recréé : le focus reste en place quand son rôle change. -->
      <button
        class="enreg"
        onclick={() => (etat === 'ecoute' ? arreter() : commencer())}
        aria-disabled={etat === 'demarrage' || etat === 'rangement'}
        aria-label={etat === 'ecoute' ? 'Arrêter et garder' : "Commencer l'enregistrement"}
      >
        <span class={etat === 'ecoute' ? 'carre' : 'rond'}></span>
      </button>
    {/if}
  </div>
</main>

<style>
  /* Écran clair et calme ; le mode se lit à la teinte (violet privé, bleu-vert ordinaire), au pictogramme et aux mots. */
  .enregistreur {
    position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; text-align: center;
    padding: 96px 32px calc(48px + env(safe-area-inset-bottom)); background: var(--private-bg); color: var(--text);
    --teinte: var(--private); --teinte-douce: var(--private-soft); --encre: var(--private-ink);
  }
  .ordinaire { background: var(--bg); --teinte: var(--accent); --teinte-douce: var(--accent-soft); --encre: var(--accent-ink); }
  .fermer { position: absolute; top: 12px; left: 12px; color: var(--text); }
  .pastille-mode {
    width: 88px; height: 88px; display: grid; place-items: center; border-radius: var(--radius-pill);
    background: var(--teinte-douce); color: var(--teinte);
  }
  h1 { font-size: var(--font-title); font-weight: 700; line-height: 36px; margin-top: 16px; }
  .maison { font-size: 18px; font-weight: 600; color: var(--encre); margin-top: 12px; }
  .consigne { max-width: 300px; margin-top: 8px; color: var(--muted); }
  .onde { height: 72px; margin-top: 48px; display: flex; align-items: center; gap: 4px; }
  .onde span { width: 4px; border-radius: 3px; background: var(--teinte); opacity: 0.85; transform-origin: center; transform: scaleY(0.35); }
  .onde.active span { animation: onde 900ms ease-in-out infinite alternate; }
  .onde span:nth-child(1) { height: 20%; animation-delay: -0ms; }
  .onde span:nth-child(2) { height: 36%; animation-delay: -137ms; }
  .onde span:nth-child(3) { height: 56%; animation-delay: -274ms; }
  .onde span:nth-child(4) { height: 80%; animation-delay: -411ms; }
  .onde span:nth-child(5) { height: 48%; animation-delay: -548ms; }
  .onde span:nth-child(6) { height: 92%; animation-delay: -685ms; }
  .onde span:nth-child(7) { height: 66%; animation-delay: -822ms; }
  .onde span:nth-child(8) { height: 40%; animation-delay: -59ms; }
  .onde span:nth-child(9) { height: 76%; animation-delay: -196ms; }
  .onde span:nth-child(10) { height: 100%; animation-delay: -333ms; }
  .onde span:nth-child(11) { height: 58%; animation-delay: -470ms; }
  .onde span:nth-child(12) { height: 34%; animation-delay: -607ms; }
  .onde span:nth-child(13) { height: 70%; animation-delay: -744ms; }
  .onde span:nth-child(14) { height: 50%; animation-delay: -881ms; }
  .onde span:nth-child(15) { height: 28%; animation-delay: -118ms; }
  .onde span:nth-child(16) { height: 18%; animation-delay: -255ms; }
  @keyframes onde { from { transform: scaleY(0.3); } to { transform: scaleY(1); } }
  @media (prefers-reduced-motion: reduce) { .onde.active span { animation: none; transform: scaleY(0.7); } }
  .commandes { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 20px; }
  .minuteur { font-size: 32px; font-weight: 600; line-height: 40px; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; min-height: 40px; }
  .enreg {
    width: 96px; height: 96px; display: grid; place-items: center; border: none; border-radius: var(--radius-pill);
    background: var(--teinte); outline: 10px solid var(--teinte-douce);
  }
  .enreg:focus-visible { outline: 3px solid var(--text); outline-offset: 12px; }
  .rond { width: 36px; height: 36px; border-radius: var(--radius-pill); background: var(--bg); }
  .carre { width: 32px; height: 32px; border-radius: 8px; background: var(--bg); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .reessayer { border-color: var(--teinte); color: var(--encre); }
</style>
