<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { ResumeEmpreinte } from '@organizer/shared/api';
  import { api, garde } from '$lib/client';
  import Icone from '$lib/composants/Icone.svelte';
  import { CHEMINS, FUSEAU } from '$lib/config';
  import { activerEmpreinte, memoLocal, retirerEmpreinte } from '$lib/empreinte';
  import { ceremoniesNavigateur } from '$lib/empreinte-navigateur';
  import { ajouteeLe } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let message = $state<string | null>(null);
  const nom = $derived(data.session?.etat === 'connecte' ? data.session.nom : '');

  const memo = memoLocal();
  let cles = $state<ResumeEmpreinte[]>([]);
  let chargee = $state(false);
  let ici = $state<string | null>(null);
  let disponible = $state(false);
  let occupe = $state(false);
  let messageEmpreinte = $state<string | null>(null);
  const iciActive = $derived(ici !== null && cles.some((c) => c.identifiant === ici));
  const appareil = (c: ResumeEmpreinte): string => (c.identifiant === ici ? MESSAGES.cetAppareil : MESSAGES.autreAppareil);

  onMount(async () => {
    disponible = ceremoniesNavigateur.disponible();
    ici = memo.lire();
    try {
      cles = await api.empreintes();
      chargee = true;
      // La clé de ce téléphone a été retirée ailleurs : la connexion n'a plus à la proposer.
      if (ici !== null && !cles.some((c) => c.identifiant === ici)) {
        memo.effacer();
        ici = null;
      }
    } catch {
      cles = [];
    }
  });

  async function activer(): Promise<void> {
    occupe = true;
    messageEmpreinte = null;
    const r = await activerEmpreinte(api, ceremoniesNavigateur, memo);
    if (r.ok) {
      cles = [...cles, r.cle];
      ici = r.cle.identifiant;
      messageEmpreinte = MESSAGES.empreinteActivee;
    } else {
      messageEmpreinte = r.message;
    }
    occupe = false;
  }

  async function retirer(c: ResumeEmpreinte): Promise<void> {
    messageEmpreinte = null;
    const r = await retirerEmpreinte(api, c, memo);
    if (r.ok) {
      cles = cles.filter((x) => x.id !== c.id);
      if (ici === c.identifiant) ici = null;
      messageEmpreinte = MESSAGES.empreinteRetiree;
    } else {
      messageEmpreinte = r.message;
    }
  }

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
  <h2 class="groupe">Empreinte</h2>
  {#each cles as c (c.id)}
    <div class="carte reglage">
      <span class="cle"><span>{appareil(c)}</span><span class="discret">{ajouteeLe(c.creeLe, FUSEAU)}</span></span>
      <button class="lien" onclick={() => retirer(c)} aria-label={`${MESSAGES.retirer}, ${appareil(c)}`}>{MESSAGES.retirer}</button>
    </div>
  {/each}
  {#if chargee && disponible && !iciActive}
    <button class="bouton activer" onclick={activer} disabled={occupe}>{MESSAGES.activerEmpreinte}</button>
  {/if}
  {#if messageEmpreinte}<p class="discret message" role="status">{messageEmpreinte}</p>{/if}
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
  .cle { display: grid; gap: 2px; }
  .activer { margin: 0 16px 10px; }
  .message { padding: 0 22px 10px; }
  .note { background: var(--accent-soft); font-size: var(--font-meta); line-height: 1.55; display: grid; gap: 6px; }
  .note h2 { font-size: var(--font-meta); font-weight: 600; }
</style>
