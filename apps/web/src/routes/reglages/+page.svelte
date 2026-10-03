<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, garde } from '$lib/client';
  import Icone from '$lib/composants/Icone.svelte';
  import { CHEMINS } from '$lib/config';
  import { MESSAGES } from '$lib/messages';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let message = $state<string | null>(null);
  const nom = $derived(data.session?.etat === 'connecte' ? data.session.nom : '');

  async function deconnecter(): Promise<void> {
    try {
      await api.deconnecter();
      garde.oublier();
      await goto(CHEMINS.connexion);
    } catch {
      message = MESSAGES.horsLigne;
    }
  }
</script>

<main class="ecran">
  <header class="entete"><h1>Réglages</h1></header>
  <h2 class="groupe">Compte</h2>
  <div class="carte reglage"><span>Connecté</span><span class="discret">{nom}</span></div>
  <section class="carte note">
    <h2>{MESSAGES.sortDeLaMaisonTitre}</h2>
    <p>{MESSAGES.sortDeLaMaison1} {MESSAGES.sortDeLaMaison2}</p>
    <p>{MESSAGES.sortDeLaMaison3} {MESSAGES.sortDeLaMaison4}</p>
  </section>
  <a class="carte reglage" href={CHEMINS.aRevoir}><span>À revoir</span><Icone nom="suivant" /></a>
  <div class="bas">
    {#if message}<p class="discret" role="status">{message}</p>{/if}
    <button class="bouton" onclick={deconnecter}>Me déconnecter</button>
  </div>
</main>

<style>
  .reglage {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    min-height: var(--touch-min); color: var(--text); text-decoration: none;
  }
  .note { background: var(--accent-soft); font-size: var(--font-meta); line-height: 1.55; display: grid; gap: 6px; }
  .note h2 { font-size: var(--font-meta); font-weight: 600; }
</style>
