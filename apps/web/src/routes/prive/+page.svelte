<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { JourPrive } from '@organizer/shared/api';
  import { jourLocal } from '@organizer/shared/dates';
  import { urlAudio } from '$lib/api';
  import { api } from '$lib/client';
  import Bandeau from '$lib/composants/Bandeau.svelte';
  import ConfirmerEffacer from '$lib/composants/ConfirmerEffacer.svelte';
  import Etiquette from '$lib/composants/Etiquette.svelte';
  import Glissable from '$lib/composants/Glissable.svelte';
  import Icone from '$lib/composants/Icone.svelte';
  import Lecteur from '$lib/composants/Lecteur.svelte';
  import { FUSEAU } from '$lib/config';
  import { duree, heureLocale, libelleJour, libelleMois, moisVoisin } from '$lib/format';
  import { creerEffaceur, effacementsEnVol } from '$lib/effacement';
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

  // Effacer en deux temps, comme les actions et les pensées : rien n'est détruit, Réglages › Éléments effacés la rend.
  let aEffacer = $state<{ id: string; texte: string } | null>(null);
  let effacees = $state<ReadonlySet<string>>(new Set(effacementsEnVol));
  let enAttenteEffacement = $state<string | null>(null);
  let annonce = $state<string | null>(null);
  const sansEffacee = (id: string): void => { effacees = new Set([...effacees].filter((x) => x !== id)); };
  const effaceur = creerEffaceur({
    effacer: (id) => api.effacerPrivee(id),
    surChangement: (e) => { enAttenteEffacement = e.enAttente; },
    surEchec: (id) => { sansEffacee(id); annonce = MESSAGES.effaceRate; },
  });
  onDestroy(() => effaceur.vider());

  function effacer(id: string): void {
    aEffacer = null;
    annonce = null;
    effacees = new Set([...effacees, id]);
    effaceur.planifier(id);
  }

  function annulerEffacement(): void {
    const id = effaceur.annuler();
    if (id) sansEffacee(id);
  }

  const visibles = $derived(
    (jours ?? []).map((j) => ({ ...j, captures: j.captures.filter((c) => !effacees.has(c.id)) })).filter((j) => j.captures.length > 0),
  );
  const libelle = (jour: string, c: { heure: string; etiquette: string | null }): string =>
    `${MESSAGES.enregistrementDe} ${libelleJour(jour, aujourdhui).toLowerCase()}, ${c.heure}${c.etiquette ? ` · ${c.etiquette}` : ''}`;

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

<main class="ecran prive" inert={aEffacer !== null}>
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
  {:else if jours && visibles.length === 0}
    <p class="vide">{MESSAGES.videPrive}</p>
  {:else if jours}
    {#each visibles as j (j.jour)}
      <h2 class="groupe" class:aujourdhui={j.jour === aujourdhui}>{libelleJour(j.jour, aujourdhui)}</h2>
      <ul class="liste">
        {#each j.captures as c (c.id)}
          <li class="cadre" data-item={c.id}>
            <Glissable classe="ligne" surEffacer={() => (aEffacer = { id: c.id, texte: libelle(j.jour, c) })}>
              {#if c.aAudio}<Lecteur src={urlAudio(c.id)} libelle="Écouter, {c.heure}" teinte="prive" />{/if}
              <div class="corps">
                <span class="quand">{c.heure}{c.dureeS !== null ? ` · ${duree(c.dureeS)}` : ''}</span>
                {#if !c.aAudio}<span class="discret">{MESSAGES.noteEcrite}</span>{/if}
                <Etiquette id={c.id} valeur={c.etiquette} />
              </div>
            </Glissable>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</main>
<Bandeau
  texte={annonce ?? (enAttenteEffacement ? MESSAGES.efface : null)}
  annulable={annonce === null && enAttenteEffacement !== null}
  surAnnuler={annulerEffacement}
/>
{#if aEffacer}
  {@const cible = aEffacer}
  <ConfirmerEffacer texte={cible.texte} surConfirmer={() => effacer(cible.id)} surAnnuler={() => (aEffacer = null)} />
{/if}

<style>
  .prive { background: var(--private-bg); }
  .garde {
    display: flex; align-items: flex-start; gap: 10px; margin: 4px 20px 16px; padding: 12px 14px; border-radius: 14px;
    background: var(--private-soft); color: var(--private-ink); font-size: var(--font-meta);
  }
  .cadenas { display: inline-flex; color: var(--private-ink); margin-top: 2px; }
  .mois { display: flex; align-items: center; justify-content: space-between; padding: 0 20px 4px; font-size: 18px; font-weight: 600; }
  .mois :global(.bouton-icone) { border: 1px solid var(--line); background: var(--surface); }
  .mois :global(.bouton-icone:disabled) { background: transparent; }
  .cadre { position: relative; overflow: hidden; border-radius: 14px; background: var(--private-soft); }
  .ligne, .cadre :global(.ligne) {
    display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 8px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
  }
  .corps { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .quand { color: var(--muted); }
  .aujourdhui { color: var(--private-ink); }
</style>
