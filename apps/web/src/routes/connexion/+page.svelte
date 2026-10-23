<script lang="ts">
  import { onMount } from 'svelte';
  import { ErreurApi } from '$lib/api';
  import { api, garde } from '$lib/client';
  import { CHEMINS } from '$lib/config';
  import { connecterParEmpreinte, memoLocal } from '$lib/empreinte';
  import { ceremoniesNavigateur } from '$lib/empreinte-navigateur';
  import BoutonGoogle from '$lib/composants/BoutonGoogle.svelte';
  import { MESSAGES } from '$lib/messages';
  import { filePrivee } from '$lib/prive/demarrage';

  const memo = memoLocal();
  let nom = $state('');
  let motDePasse = $state('');
  let message = $state<string | null>(null);
  let envoi = $state(false);
  let enAttente = $state(false);
  // Bouton seulement si ce téléphone a une clé ; jamais d'invite ouverte d'elle-même.
  let empreinte = $state(false);
  // undefined : réponse en attente. null : pas de Google ici, formulaire déplié d'office.
  let clientId = $state<string | null | undefined>(undefined);
  let googleKo = $state(false);
  let deplie = $state(false);
  const formulaire = $derived(deplie || clientId === null || googleKo);
  onMount(async () => {
    api.configGoogle().then((c) => { clientId = c.clientId; }, () => { clientId = null; });
    empreinte = memo.lire() !== null && ceremoniesNavigateur.disponible();
    try {
      enAttente = (await filePrivee.lister()).some((c) => !c.refuse);
    } catch {
      enAttente = false;
    }
  });

  function entrer(): void {
    garde.oublier();
    // Vrai chargement : le script de Google ne survit jamais à cet écran (règle 6, CAP-09).
    // La coquille vient du cache ; au démarrage, la file privée part (demarrerPrive).
    location.assign(CHEMINS.accueil);
  }

  async function connecter(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    envoi = true;
    message = null;
    try {
      await api.connecter({ nom: nom.trim(), motDePasse });
      entrer();
    } catch (err) {
      if (err instanceof ErreurApi && (err.statut === 401 || err.statut === 400 || err.statut === 422)) message = MESSAGES.identifiantsInvalides;
      else if (err instanceof ErreurApi && err.statut === 429) message = MESSAGES.tropDeRequetes;
      else if (err instanceof ErreurApi) message = MESSAGES.serveurIndisponible;
      else message = MESSAGES.horsLigne;
    } finally {
      envoi = false;
    }
  }

  async function parGoogle(jeton: string): Promise<void> {
    envoi = true;
    message = null;
    try {
      await api.connecterGoogle(jeton);
      entrer();
    } catch (err) {
      if (err instanceof ErreurApi && err.statut === 401) message = MESSAGES.googleInconnu;
      else if (err instanceof ErreurApi && err.statut === 503) sansGoogle();
      else if (err instanceof ErreurApi && err.statut === 429) message = MESSAGES.tropDeRequetes;
      else if (err instanceof ErreurApi) message = MESSAGES.serveurIndisponible;
      else message = MESSAGES.horsLigne;
    } finally {
      envoi = false;
    }
  }

  function sansGoogle(): void {
    googleKo = true;
    message = MESSAGES.googleIndisponible;
  }

  async function parEmpreinte(): Promise<void> {
    envoi = true;
    message = null;
    try {
      const r = await connecterParEmpreinte(api, ceremoniesNavigateur, memo);
      if (r.ok) entrer();
      else message = r.message;
    } finally {
      envoi = false;
    }
  }
</script>

<main class="connexion">
  <h1>Organizer</h1>
  {#if clientId && !googleKo}<BoutonGoogle {clientId} onjeton={parGoogle} onindisponible={sansGoogle} />{/if}
  {#if empreinte}
    <button class="bouton-principal" type="button" onclick={parEmpreinte} disabled={envoi}>{MESSAGES.connecterEmpreinte}</button>
  {/if}
  <p aria-live="polite">{message ?? ''}</p>
  {#if enAttente}<p class="discret">{MESSAGES.partiraApresConnexion}</p>{/if}
  {#if formulaire}
    <form onsubmit={connecter}>
      <label>Nom<input bind:value={nom} name="nom" autocomplete="username" autocapitalize="none" required /></label>
      <label>Mot de passe<input bind:value={motDePasse} name="motDePasse" type="password" autocomplete="current-password" required /></label>
      <button class={empreinte ? 'bouton' : 'bouton-principal'} type="submit" disabled={envoi}>Me connecter</button>
    </form>
  {:else}
    <button class="lien" type="button" onclick={() => (deplie = true)}>{MESSAGES.connecterMotDePasse}</button>
  {/if}
</main>

<style>
  .connexion {
    min-height: 100dvh; display: flex; flex-direction: column; justify-content: flex-end; gap: 24px;
    padding: 24px 20px calc(120px + env(safe-area-inset-bottom));
  }
  h1 { font-size: var(--font-title); font-weight: 700; line-height: 36px; letter-spacing: -0.02em; }
  form { display: flex; flex-direction: column; gap: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: var(--font-meta); font-weight: 600; color: var(--muted); }
  input {
    min-height: 52px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--surface); color: var(--text); font-size: var(--font-body); font-weight: 400;
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
</style>
