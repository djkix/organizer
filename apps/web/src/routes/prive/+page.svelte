<script lang="ts">
  import { onMount } from 'svelte';
  import type { JourPrive } from '@organizer/shared/api';
  import { jourLocal } from '@organizer/shared/dates';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import Etiquette from '$lib/composants/Etiquette.svelte';
  import Icone from '$lib/composants/Icone.svelte';
  import Lecteur from '$lib/composants/Lecteur.svelte';
  import { FUSEAU } from '$lib/config';
  import { duree, heureLocale, libelleJour, libelleMois, moisVoisin } from '$lib/format';
  import { MESSAGES } from '$lib/messages';
  import { filePrivee, videur } from '$lib/prive/demarrage';
  import { plusRecentesDAbord, type BilanVidage, type CapturePrivee } from '$lib/prive/file';

  const aujourdhui = jourLocal(new Date(), FUSEAU);
  const moisCourant = aujourdhui.slice(0, 7);
  let mois = $state(moisCourant);
  let jours = $state<JourPrive[] | null>(null);
  let erreur = $state(false);
  let attente = $state<CapturePrivee[]>([]);
  let bilan = $state<BilanVidage | null>(null);

  async function charger(m: string): Promise<void> {
    erreur = false;
    try {
      const r = await api.privees(m);
      if (m === mois) jours = r;
    } catch {
      if (m === mois) erreur = true;
    }
  }

  async function lireAttente(): Promise<void> {
    try {
      attente = plusRecentesDAbord((await filePrivee.lister()).filter((c) => c.mode !== 'ordinaire'));
    } catch {
      attente = [];
    }
  }

  const refusees = $derived((bilan?.refusees ?? 0) > 0 || attente.some((c) => c.refuse));

  async function reessayer(): Promise<void> {
    try {
      await videur.reessayerRefusees();
    } catch {
      // Les copies restent sur le téléphone : un prochain passage les reprendra.
    }
  }

  function changerMois(delta: number): void {
    jours = null;
    mois = moisVoisin(mois, delta);
  }

  $effect(() => { void charger(mois); });

  onMount(() => {
    void lireAttente();
    const arret = videur.ecouter((b) => {
      bilan = b;
      void lireAttente();
      if (b.livrees > 0) void charger(mois);
    });
    void videur.vider();
    return arret;
  });
</script>

<main class="ecran prive">
  <header class="entete"><h1>Privé</h1><p class="sous">{MESSAGES.priveSous}</p></header>
  <p class="garde"><span class="cadenas"><Icone nom="cadenas" taille={16} /></span>{MESSAGES.priveEnTete}</p>

  {#if refusees}
    <p class="garde" role="status">
      <span>{MESSAGES.enregistrementRefuse}</span>
      <button class="bouton" onclick={reessayer}>{MESSAGES.reessayer}</button>
    </p>
  {/if}
  {#if attente.length > 0}
    <h2 class="groupe">{MESSAGES.enAttente}</h2>
    <ul class="liste">
      {#each attente as c (c.id)}
        <li class="ligne">
          <div class="corps">
            <span>{libelleJour(jourLocal(new Date(c.emisLe), FUSEAU), aujourdhui)}, {heureLocale(c.emisLe, FUSEAU)} · {duree(c.dureeS)}</span>
            {#if !c.refuse}<span class="discret">{bilan?.nonConnecte ? MESSAGES.partiraApresConnexion : MESSAGES.partiraAuRetour}</span>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <nav class="mois" aria-label="Mois">
    <button class="bouton-icone" onclick={() => changerMois(-1)} aria-label="Mois précédent"><Icone nom="retour" /></button>
    <span>{libelleMois(mois)}</span>
    <button class="bouton-icone" onclick={() => changerMois(1)} disabled={mois >= moisCourant} aria-label="Mois suivant">
      <Icone nom="suivant" />
    </button>
  </nav>

  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if jours && jours.length === 0}
    <p class="vide">{MESSAGES.videPrive}</p>
  {:else if jours}
    {#each jours as j (j.jour)}
      <h2 class="groupe">{libelleJour(j.jour, aujourdhui)}</h2>
      <ul class="liste">
        {#each j.captures as c (c.id)}
          <li class="ligne">
            {#if c.aAudio}<Lecteur src={urlAudio(c.id)} libelle="Écouter, {c.heure}" />{/if}
            <div class="corps">
              <span>{c.heure}{c.dureeS !== null ? ` · ${duree(c.dureeS)}` : ''}</span>
              {#if !c.aAudio}<span class="discret">{MESSAGES.noteEcrite}</span>{/if}
              <Etiquette id={c.id} valeur={c.etiquette} />
            </div>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</main>

<style>
  .prive { background: var(--private-soft); }
  .garde { display: flex; align-items: center; gap: 8px; padding: 0 20px 10px; font-size: var(--font-meta); color: var(--text); }
  .cadenas { display: inline-flex; color: var(--private); }
  .mois { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; }
  .ligne {
    display: flex; align-items: center; gap: 12px; margin-bottom: 8px; padding: 8px 12px;
    background: var(--surface); border-radius: var(--radius-card);
  }
  .corps { flex: 1; display: flex; flex-direction: column; }
</style>
