<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import type { ResumeEmpreinte } from '@organizer/shared/api';
  import { attendreIssue, lireRetour, messageRetour, vueAgenda, type VueAgenda } from '$lib/agenda';
  import { api, garde } from '$lib/client';
  import Icone from '$lib/composants/Icone.svelte';
  import { CHEMINS, FUSEAU } from '$lib/config';
  import { activerEmpreinte, CLE_INCONNUE, memoLocal, retirerEmpreinte } from '$lib/empreinte';
  import { ceremoniesNavigateur } from '$lib/empreinte-navigateur';
  import { ajouteeLe } from '$lib/format';
  import { libelleVersion } from '$lib/version';
  import { MESSAGES } from '$lib/messages';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let message = $state<string | null>(null);
  const version = $derived(data.session?.etat === 'connecte' && data.session.admin ? libelleVersion(__VERSION_PWA__, data.session.versionServeur) : null);
  const nom = $derived(data.session?.etat === 'connecte' ? data.session.nom : '');

  const memo = memoLocal();
  let cles = $state<ResumeEmpreinte[]>([]);
  let chargee = $state(false);
  let ici = $state<string | null>(null);
  let disponible = $state(false);
  let occupe = $state(false);
  let messageEmpreinte = $state<string | null>(null);
  const iciActive = $derived(ici !== null && (ici === CLE_INCONNUE || cles.some((c) => c.identifiant === ici)));
  const appareil = (c: ResumeEmpreinte): string => (c.identifiant === ici ? MESSAGES.cetAppareil : MESSAGES.autreAppareil);

  let vueAg = $state<VueAgenda | null>(null);
  let messageAgenda = $state<string | null>(null);
  let occupeAgenda = $state(false);
  const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function chargerAgenda(): Promise<void> {
    const retour = lireRetour(location.search);
    messageAgenda = retour ? messageRetour(retour) : null;
    try {
      if (retour === 'retour') vueAg = vueAgenda({ etat: 'en_cours', erreur: null });
      // L'adresse n'est nettoyée qu'après le premier rendu, une fois le routeur prêt.
      await tick();
      if (retour) history.replaceState(history.state, '', CHEMINS.reglages);
      const r = retour === 'retour' ? await attendreIssue(api, dormir) : await api.agenda();
      vueAg = vueAgenda(r);
      if (r.etat === 'en_cours') messageAgenda = MESSAGES.agendaAttente;
    } catch {
      messageAgenda = MESSAGES.serveurIndisponible;
    }
  }

  async function connecterAgenda(): Promise<void> {
    occupeAgenda = true;
    messageAgenda = null;
    try {
      const { url } = await api.connecterAgenda();
      if (!url.startsWith('https://accounts.google.com/')) throw new Error(MESSAGES.agendaEchec);
      location.assign(url);
    } catch (e) {
      messageAgenda = e instanceof Error ? e.message : MESSAGES.serveurIndisponible;
      occupeAgenda = false;
    }
  }

  async function deconnecterAgenda(): Promise<void> {
    occupeAgenda = true;
    messageAgenda = null;
    try {
      await api.deconnecterAgenda();
      vueAg = vueAgenda(await attendreIssue(api, dormir));
      messageAgenda = MESSAGES.agendaGarde;
    } catch {
      messageAgenda = MESSAGES.serveurIndisponible;
    }
    occupeAgenda = false;
  }

  onMount(async () => {
    void chargerAgenda();
    disponible = ceremoniesNavigateur.disponible();
    ici = memo.lire();
    try {
      cles = await api.empreintes();
      chargee = true;
      // La clé de ce téléphone a été retirée ailleurs : la connexion n'a plus à la proposer.
      // Mémo « clé inconnue » : gardé tant que le compte a une clé ; effacé quand il n'en a plus.
      const contredit = ici === CLE_INCONNUE ? cles.length === 0 : !cles.some((c) => c.identifiant === ici);
      if (ici !== null && contredit) {
        memo.effacer();
        ici = null;
      }
    } catch {
      cles = [];
      messageEmpreinte = MESSAGES.serveurIndisponible;
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
      ici = memo.lire();
    }
    occupe = false;
  }

  async function retirer(c: ResumeEmpreinte): Promise<void> {
    occupe = true;
    messageEmpreinte = null;
    const r = await retirerEmpreinte(api, c, memo);
    if (r.ok) {
      cles = cles.filter((x) => x.id !== c.id);
      if (ici === c.identifiant || (ici === CLE_INCONNUE && cles.length === 0)) {
        memo.effacer();
        ici = null;
      }
      messageEmpreinte = MESSAGES.empreinteRetiree;
    } else {
      messageEmpreinte = r.message;
    }
    occupe = false;
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
  <header class="entete entete-version"><h1>Réglages</h1>{#if version}<span class="discret" data-testid="version">{version}</span>{/if}</header>
  <h2 class="groupe">Compte</h2>
  <div class="carte reglage"><span>Connecté</span><span class="discret">{nom}</span></div>
  <h2 class="groupe">Empreinte</h2>
  {#each cles as c (c.id)}
    <div class="carte reglage">
      <span class="cle"><span>{appareil(c)}</span><span class="discret">{ajouteeLe(c.creeLe, FUSEAU)}</span></span>
      <button class="lien" onclick={() => retirer(c)} disabled={occupe} aria-label={`${MESSAGES.retirer}, ${appareil(c)}`}>{MESSAGES.retirer}</button>
    </div>
  {/each}
  {#if chargee && disponible && !iciActive}
    <button class="bouton activer" onclick={activer} disabled={occupe}>{MESSAGES.activerEmpreinte}</button>
  {/if}
  <p class="discret message" aria-live="polite">{messageEmpreinte ?? ''}</p>
  <h2 class="groupe">Google Agenda</h2>
  <div class="carte agenda">
    <p>{vueAg?.ligne ?? ''}</p>
    <p class="discret">{MESSAGES.agendaSansPensees}</p>
  </div>
  {#if vueAg?.bouton === 'connecter'}
    <button class="bouton activer" onclick={connecterAgenda} disabled={occupeAgenda}>{MESSAGES.connecterAgenda}</button>
  {:else if vueAg?.bouton === 'deconnecter'}
    <button class="lien activer" onclick={deconnecterAgenda} disabled={occupeAgenda}>{MESSAGES.deconnecterAgenda}</button>
  {/if}
  <p class="discret message" aria-live="polite">{messageAgenda ?? ''}</p>
  <section class="carte note">
    <h2>{MESSAGES.sortDeLaMaisonTitre}</h2>
    <p>{MESSAGES.sortDeLaMaison1} {MESSAGES.sortDeLaMaison2}</p>
    <p>{MESSAGES.sortDeLaMaison3} {MESSAGES.sortDeLaMaison4}</p>
  </section>
  <a class="carte reglage" href={CHEMINS.aRevoir}><span>À revoir</span><Icone nom="suivant" /></a>
  <div class="bas">
    <p class="discret" aria-live="polite">{message ?? ''}</p>
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
  .agenda { display: grid; gap: 4px; }
  .note { background: var(--accent-soft); font-size: var(--font-meta); line-height: 1.55; display: grid; gap: 6px; }
  .note h2 { font-size: var(--font-meta); font-weight: 600; }
</style>
