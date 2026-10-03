<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Icone from '$lib/composants/Icone.svelte';
  import { CHEMINS } from '$lib/config';
  import { chrono } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import { garderEtEnvoyer } from '$lib/prive/demarrage';
  import { creerEnregistreur } from '$lib/prive/enregistreur';
  import { envoyerCapture, EnregistrementVide, type Enregistrement } from '$lib/prive/file';

  let etat = $state<'pret' | 'ecoute' | 'rangement'>('pret');
  let secondes = $state(0);
  let message = $state<string | null>(null);
  let aGarder = $state<Enregistrement | null>(null);
  let minuterie: ReturnType<typeof setInterval> | undefined;
  const enregistreur = creerEnregistreur({ surInterruption: () => void arreter() });

  async function commencer(): Promise<void> {
    message = null;
    try {
      await enregistreur.demarrer();
    } catch {
      message = MESSAGES.microRefuse;
      return;
    }
    etat = 'ecoute';
    secondes = 0;
    minuterie = setInterval(() => (secondes += 1), 1000);
  }

  async function garder(e: Enregistrement, allerAuPrive: boolean): Promise<void> {
    etat = 'rangement';
    try {
      await garderEtEnvoyer(e);
      aGarder = null;
      if (allerAuPrive) await goto(CHEMINS.prive);
      else etat = 'pret';
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
    const r = await envoyerCapture({ id: crypto.randomUUID(), ...e });
    if (r.issue === 'livre') {
      aGarder = null;
      await goto(CHEMINS.prive);
      return;
    }
    etat = 'pret';
    message = MESSAGES.envoiRate;
  }

  async function arreter(allerAuPrive = true): Promise<void> {
    if (etat !== 'ecoute') return;
    etat = 'rangement';
    clearInterval(minuterie);
    let e: Enregistrement;
    try {
      e = await enregistreur.arreter();
    } catch {
      etat = 'pret';
      message = MESSAGES.rienEnregistre;
      return;
    }
    await garder(e, allerAuPrive);
  }

  // Fermer pendant l'enregistrement garde ce qui a été dit : rien ne se perd.
  function fermer(): void {
    if (aGarder || etat === 'rangement') return;
    if (etat === 'ecoute') void arreter();
    else void goto(CHEMINS.accueil);
  }

  onMount(() => {
    // Écran quitté (appel, verrouillage) : on range plutôt que de risquer la perte.
    const cache = (): void => {
      if (document.visibilityState === 'hidden') void arreter();
    };
    document.addEventListener('visibilitychange', cache);
    return () => document.removeEventListener('visibilitychange', cache);
  });

  onDestroy(() => {
    clearInterval(minuterie);
    if (etat === 'ecoute') void arreter(false);
    else enregistreur.liberer();
  });
</script>

<main class="enregistreur">
  <button class="bouton-icone fermer" onclick={fermer} aria-label="Fermer"><Icone nom="fermer" /></button>
  <span class="cadenas"><Icone nom="cadenas" taille={40} etiquette="Mode privé" /></span>
  <h1>{etat === 'ecoute' ? MESSAGES.ecoute : MESSAGES.enregistrementPrive}</h1>
  <p class="maison">{MESSAGES.resteALaMaison}</p>
  <p class="consigne">{etat === 'ecoute' ? MESSAGES.finirEnregistrement : MESSAGES.rienNestTrie}</p>
  {#if message}<p class="consigne" role="status">{message}</p>{/if}

  <div class="commandes">
    <p class="minuteur">{etat === 'ecoute' ? chrono(secondes) : ''}</p>
    {#if aGarder}
      <button class="bouton reessayer" onclick={() => aGarder && garder(aGarder, true)} disabled={etat === 'rangement'}>{MESSAGES.reessayer}</button>
      <button class="bouton reessayer" onclick={() => aGarder && envoyerDirect(aGarder)} disabled={etat === 'rangement'}>{MESSAGES.envoyerMaintenant}</button>
    {:else if etat === 'ecoute'}
      <button class="enreg" onclick={() => arreter()} aria-label="Arrêter et garder"><span class="carre"></span></button>
    {:else}
      <button class="enreg" onclick={commencer} disabled={etat === 'rangement'} aria-label="Commencer l'enregistrement">
        <span class="rond"></span>
      </button>
    {/if}
  </div>
</main>

<style>
  .enregistreur {
    position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; text-align: center;
    padding: 72px 24px calc(48px + env(safe-area-inset-bottom)); background: var(--private); color: var(--bg);
  }
  .fermer { position: absolute; top: 12px; left: 12px; color: var(--bg); }
  .cadenas { display: inline-flex; }
  h1 { font-size: var(--font-title); font-weight: 600; margin-top: 20px; }
  .maison { font-weight: 600; margin-top: 8px; }
  .consigne { max-width: 300px; margin-top: 8px; }
  .commandes { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .minuteur { font-size: 30px; font-variant-numeric: tabular-nums; min-height: 40px; }
  .enreg { width: 108px; height: 108px; display: grid; place-items: center; border: none; border-radius: var(--radius-pill); background: var(--bg); }
  .rond { width: 40px; height: 40px; border-radius: var(--radius-pill); background: var(--private); }
  .carre { width: 34px; height: 34px; border-radius: 6px; background: var(--private); }
  .reessayer { border-color: var(--bg); color: var(--bg); }
</style>
