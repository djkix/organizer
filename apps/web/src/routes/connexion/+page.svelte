<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ErreurApi } from '$lib/api';
  import { api, garde } from '$lib/client';
  import { CHEMINS } from '$lib/config';
  import { connecterParEmpreinte, memoLocal } from '$lib/empreinte';
  import { ceremoniesNavigateur } from '$lib/empreinte-navigateur';
  import { MESSAGES } from '$lib/messages';
  import { filePrivee, videur } from '$lib/prive/demarrage';

  const memo = memoLocal();
  let nom = $state('');
  let motDePasse = $state('');
  let message = $state<string | null>(null);
  let envoi = $state(false);
  let enAttente = $state(false);
  // Bouton seulement si ce téléphone a une clé ; jamais d'invite ouverte d'elle-même.
  let empreinte = $state(false);
  onMount(async () => {
    empreinte = memo.lire() !== null && ceremoniesNavigateur.disponible();
    try {
      enAttente = (await filePrivee.lister()).some((c) => !c.refuse);
    } catch {
      enAttente = false;
    }
  });

  async function entrer(): Promise<void> {
    garde.oublier();
    // Des enregistrements ont pu attendre la session : ils partent maintenant.
    void videur.vider().catch(() => undefined);
    await goto(CHEMINS.accueil);
  }

  async function connecter(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    envoi = true;
    message = null;
    try {
      await api.connecter({ nom: nom.trim(), motDePasse });
      await entrer();
    } catch (err) {
      if (err instanceof ErreurApi && (err.statut === 401 || err.statut === 400 || err.statut === 422)) message = MESSAGES.identifiantsInvalides;
      else if (err instanceof ErreurApi && err.statut === 429) message = MESSAGES.tropDeRequetes;
      else if (err instanceof ErreurApi) message = MESSAGES.serveurIndisponible;
      else message = MESSAGES.horsLigne;
    } finally {
      envoi = false;
    }
  }

  async function parEmpreinte(): Promise<void> {
    envoi = true;
    message = null;
    try {
      const r = await connecterParEmpreinte(api, ceremoniesNavigateur, memo);
      if (r.ok) await entrer();
      else message = r.message;
    } finally {
      envoi = false;
    }
  }
</script>

<main class="connexion">
  <h1>Organizer</h1>
  <form onsubmit={connecter}>
    <label>Nom<input bind:value={nom} name="nom" autocomplete="username" autocapitalize="none" required /></label>
    <label>Mot de passe<input bind:value={motDePasse} name="motDePasse" type="password" autocomplete="current-password" required /></label>
    <p aria-live="polite">{message ?? ''}</p>
    {#if enAttente}<p class="discret">{MESSAGES.partiraApresConnexion}</p>{/if}
    {#if empreinte}
      <button class="bouton-principal" type="button" onclick={parEmpreinte} disabled={envoi}>{MESSAGES.connecterEmpreinte}</button>
      <button class="bouton" type="submit" disabled={envoi}>Me connecter</button>
    {:else}
      <button class="bouton-principal" type="submit" disabled={envoi}>Me connecter</button>
    {/if}
  </form>
</main>

<style>
  .connexion {
    min-height: 100dvh; display: flex; flex-direction: column; justify-content: flex-end; gap: 24px;
    padding: 24px 20px calc(120px + env(safe-area-inset-bottom));
  }
  h1 { font-size: var(--font-title); font-weight: 600; }
  form { display: flex; flex-direction: column; gap: 16px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: var(--font-meta); color: var(--muted); }
  input {
    min-height: var(--touch-min); padding: 0 14px; border: 1px solid var(--muted); border-radius: 12px;
    background: var(--surface); color: var(--text); font-size: var(--font-body);
  }
</style>
