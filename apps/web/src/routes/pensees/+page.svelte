<script lang="ts">
  import { pushState } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, tick } from 'svelte';
  import type { PenseeListe, VuePensees } from '@organizer/shared/api';
  import { jourLocal } from '@organizer/shared/dates';
  import { api } from '$lib/client';
  import Bandeau from '$lib/composants/Bandeau.svelte';
  import ConfirmerEffacer from '$lib/composants/ConfirmerEffacer.svelte';
  import DetailPensee from '$lib/composants/DetailPensee.svelte';
  import Icone from '$lib/composants/Icone.svelte';
  import Pastille from '$lib/composants/Pastille.svelte';
  import { FUSEAU } from '$lib/config';
  import { corpsEcheance, corpsNature } from '$lib/correction';
  import { creerEffaceur, effacementsEnVol } from '$lib/effacement';
  import { libelleJour, libelleMois, moisVoisin, titreDuJour } from '$lib/format';
  import { MESSAGES } from '$lib/messages';

  type Filtre = { theme?: string; personne?: string };

  let aujourdhui = $state(jourLocal(new Date(), FUSEAU));
  const moisCourant = $derived(aujourdhui.slice(0, 7));
  let mois = $state(jourLocal(new Date(), FUSEAU).slice(0, 7));
  let filtre = $state<Filtre>({});
  let vue = $state<VuePensees | null>(null);
  let erreur = $state(false);
  let selection = $state<PenseeListe | null>(null);
  let envoi = $state(false);
  let annonce = $state<string | null>(null);
  let aEffacer = $state<PenseeListe | null>(null);
  let declencheur: HTMLElement | null = null;
  let numero = 0;

  async function charger(): Promise<void> {
    const demande = ++numero;
    erreur = false;
    try {
      const r = await api.pensees(mois, filtre);
      if (demande === numero) vue = r;
    } catch {
      if (demande === numero) erreur = true;
    }
  }

  $effect(() => { void [mois, filtre]; void charger(); });

  // Laissée ouverte une nuit : au retour sur l'app, le bon jour et la liste à jour.
  $effect(() => {
    const retour = (): void => {
      if (document.visibilityState !== 'visible') return;
      aujourdhui = jourLocal(new Date(), FUSEAU);
      void charger();
    };
    document.addEventListener('visibilitychange', retour);
    return () => document.removeEventListener('visibilitychange', retour);
  });

  function changerMois(delta: number): void {
    vue = null;
    mois = moisVoisin(mois, delta);
  }

  const estActif = (f: Filtre): boolean => f.theme === filtre.theme && f.personne === filtre.personne;

  // Effacer en deux temps, comme dans les listes.
  let effaces = $state<ReadonlySet<string>>(new Set(effacementsEnVol));
  let enAttente = $state<string | null>(null);
  const sansEfface = (id: string): void => { effaces = new Set([...effaces].filter((x) => x !== id)); };
  const effaceur = creerEffaceur({
    effacer: (id) => api.effacer(id),
    surChangement: (e) => { enAttente = e.enAttente; },
    surEchec: (id) => { sansEfface(id); dire(MESSAGES.effaceRate); },
  });
  onDestroy(() => effaceur.vider());

  function dire(m: string): void {
    annonce = m;
    setTimeout(() => { if (annonce === m) annonce = null; }, 6000);
  }

  const jours = $derived(
    (vue?.jours ?? [])
      .map((j) => ({ ...j, pensees: j.pensees.filter((p) => !effaces.has(p.itemId)) }))
      .filter((j) => j.pensees.length > 0),
  );

  function ouvrir(p: PenseeListe): void {
    declencheur = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pushState('', { detail: p.itemId });
    selection = p;
  }

  async function fermer(): Promise<void> {
    if (!selection) return;
    selection = null;
    if (page.state.detail) history.back();
    const cible = declencheur;
    declencheur = null;
    await tick();
    (cible?.isConnected ? cible : document.querySelector<HTMLElement>('main h1'))?.focus();
  }

  $effect(() => {
    if (selection && !page.state.detail) void fermer();
  });

  // Détail ouvert : la barre du bas et le bouton privé, cachés sous le panneau, deviennent inertes.
  $effect(() => {
    const ouvert = selection !== null;
    const fond = document.querySelectorAll('nav[aria-label="Navigation"], .fab');
    fond.forEach((e) => e.toggleAttribute('inert', ouvert));
    return () => fond.forEach((e) => e.removeAttribute('inert'));
  });

  async function rangerEnAction(p: PenseeListe): Promise<void> {
    if (envoi) return;
    envoi = true;
    try {
      // Jamais une action sans date, qu'aucune liste d'À faire ne montrerait : elle va dans Aujourd'hui (« Dans la journée »).
      await api.corriger(p.itemId, { ...corpsNature('action'), ...corpsEcheance({ type: 'jour', jour: jourLocal(new Date(), FUSEAU) }, FUSEAU) });
      await fermer();
      dire(MESSAGES.rangeEnAction);
      await charger();
    } catch {
      dire(MESSAGES.correctionRatee);
    } finally {
      envoi = false;
    }
  }

  async function effacer(p: PenseeListe): Promise<void> {
    aEffacer = null;
    await fermer();
    effaces = new Set([...effaces, p.itemId]);
    effaceur.planifier(p.itemId);
  }

  function annulerEffacement(): void {
    const id = effaceur.annuler();
    if (id) sansEfface(id);
  }

  const bandeau = $derived(
    annonce === MESSAGES.effaceRate || !enAttente
      ? { texte: annonce, annulable: false, annuler: () => {} }
      : { texte: MESSAGES.efface, annulable: true, annuler: annulerEffacement },
  );
</script>

<main class="ecran" inert={selection !== null || aEffacer !== null}>
  <header class="entete"><h1 tabindex="-1">Pensées</h1><p class="sous">{MESSAGES.penseesSous}</p></header>
  <nav class="mois" aria-label="Mois">
    <button class="bouton-icone" onclick={() => changerMois(-1)} aria-label="Mois précédent"><Icone nom="retour" /></button>
    <span>{libelleMois(mois)}</span>
    <button class="bouton-icone" onclick={() => changerMois(1)} disabled={mois >= moisCourant} aria-label="Mois suivant">
      <Icone nom="suivant" />
    </button>
  </nav>
  {#if vue && (vue.themes.length || vue.personnes.length)}
    <div class="filtres" role="group" aria-label="Filtrer">
      <button class="puce" aria-pressed={estActif({})} onclick={() => (filtre = {})}>{MESSAGES.toutes}</button>
      {#each vue.themes as t (t)}
        <button class="puce" aria-pressed={estActif({ theme: t })} onclick={() => (filtre = { theme: t })}>{t}</button>
      {/each}
      {#each vue.personnes as n (n)}
        <button class="puce personne" aria-pressed={estActif({ personne: n })} onclick={() => (filtre = { personne: n })}>{n}</button>
      {/each}
    </div>
  {/if}
  {#if erreur}
    <p class="vide">{MESSAGES.listeIndisponible}</p>
  {:else if vue && jours.length === 0}
    <p class="vide">{MESSAGES.videPrive}</p>
  {:else}
    {#each jours as j (j.jour)}
      <h2 class="groupe">{libelleJour(j.jour, aujourdhui)}</h2>
      <ul class="liste">
        {#each j.pensees as p (p.itemId)}
          <li>
            <button class="pensee" onclick={() => ouvrir(p)}>
              <span class="texte">{p.texte}</span>
              <span class="meta">
                <span class="heure">{p.heure}</span>
                {#if p.theme}<Pastille p={{ type: 'pensee', libelle: p.theme }} />{/if}
                {#each p.personnes as n (n)}<Pastille p={{ type: 'info', libelle: n }} />{/each}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  {/if}
</main>

<Bandeau texte={bandeau.texte} annulable={bandeau.annulable} surAnnuler={bandeau.annuler} />
{#if selection}
  {@const p = selection}
  <DetailPensee
    pensee={p} {envoi}
    quand={`${titreDuJour(vue?.jours.find((j) => j.pensees.some((x) => x.itemId === p.itemId))?.jour ?? aujourdhui)}, ${p.heure}`}
    surFermer={() => void fermer()} surAction={() => void rangerEnAction(p)} surEffacer={() => (aEffacer = p)}
  />
{/if}
{#if aEffacer}
  {@const cible = aEffacer}
  <ConfirmerEffacer texte={cible.texte} surConfirmer={() => void effacer(cible)} surAnnuler={() => (aEffacer = null)} />
{/if}

<style>
  h1:focus { outline: none; }
  .mois { display: flex; align-items: center; justify-content: space-between; padding: 0 20px 8px; font-size: 18px; font-weight: 600; }
  .mois :global(.bouton-icone) { border: 1px solid var(--line); background: var(--surface); }
  .mois :global(.bouton-icone:disabled) { background: transparent; }
  .filtres { display: flex; gap: 8px; padding: 4px 20px 8px; overflow-x: auto; scrollbar-width: none; }
  .puce {
    flex: none; min-height: var(--touch-min); padding: 0 16px; border-radius: var(--radius-pill);
    border: 1px solid var(--line); background: var(--surface); color: var(--text); font-weight: 500; white-space: nowrap;
  }
  .puce[aria-pressed='true'] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .pensee {
    width: 100%; min-height: 64px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 14px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 14px; color: var(--text); text-align: left;
  }
  .texte {
    line-height: 24px; overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .heure { color: var(--muted); margin-right: 4px; }
</style>
