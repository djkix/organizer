<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
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
    <span class="cadenas"><Icone nom="cadenas" taille={40} etiquette="Mode privé" /></span>
    <h1>{etat === 'ecoute' ? MESSAGES.ecoute : MESSAGES.enregistrementPrive}</h1>
    <p class="maison">{MESSAGES.resteALaMaison}</p>
    <p class="consigne">{etat === 'ecoute' ? MESSAGES.finirEnregistrement : MESSAGES.rienNestTrie}</p>
  {:else}
    <span class="cadenas"><Icone nom="micro" taille={40} etiquette="Enregistrement ordinaire" /></span>
    <h1>{etat === 'ecoute' ? MESSAGES.ecoute : MESSAGES.enregistrementOrdinaire}</h1>
    <p class="maison">{MESSAGES.envoyeAuTri}</p>
    <p class="consigne">{etat === 'ecoute' ? MESSAGES.finirEnregistrement : MESSAGES.rangeToutSeul}</p>
  {/if}
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
  .enregistreur {
    position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; text-align: center;
    padding: 72px 24px calc(48px + env(safe-area-inset-bottom)); background: var(--private); color: var(--bg);
  }
  .ordinaire { background: var(--accent); }
  .fermer { position: absolute; top: 12px; left: 12px; color: var(--bg); }
  .cadenas { display: inline-flex; }
  h1 { font-size: var(--font-title); font-weight: 600; margin-top: 20px; }
  .maison { font-weight: 600; margin-top: 8px; }
  .consigne { max-width: 300px; margin-top: 8px; }
  .commandes { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .minuteur { font-size: 30px; font-variant-numeric: tabular-nums; min-height: 40px; }
  .enreg { width: 108px; height: 108px; display: grid; place-items: center; border: none; border-radius: var(--radius-pill); background: var(--bg); }
  .rond { width: 40px; height: 40px; border-radius: var(--radius-pill); background: var(--private); }
  .ordinaire .rond, .ordinaire .carre { background: var(--accent); }
  .carre { width: 34px; height: 34px; border-radius: 6px; background: var(--private); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .reessayer { border-color: var(--bg); color: var(--bg); }
</style>
