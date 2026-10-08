<script lang="ts">
  import { page } from '$app/state';
  import { etatAlertes } from '$lib/alertes.svelte';
  import { CHEMINS } from '$lib/config';
  import BoutonPrive from './BoutonPrive.svelte';
  import BoutonsEnregistrer from './BoutonsEnregistrer.svelte';
  import Icone from './Icone.svelte';

  const ONGLETS = [
    { href: CHEMINS.accueil, libelle: 'À faire', icone: 'liste' },
    { href: CHEMINS.pensees, libelle: 'Pensées', icone: 'bulle' },
    { href: CHEMINS.prive, libelle: 'Privé', icone: 'cadenas' },
    { href: CHEMINS.reglages, libelle: 'Réglages', icone: 'reglages' },
  ] as const;

  // L'Historique et À revoir s'ouvrent depuis Réglages : c'est lui qui reste allumé.
  const DANS_REGLAGES: string[] = [CHEMINS.historique, CHEMINS.aRevoir];
  const actif = (href: string): boolean =>
    href === CHEMINS.accueil ? page.url.pathname === href
      : page.url.pathname.startsWith(href) || (href === CHEMINS.reglages && DANS_REGLAGES.some((c) => page.url.pathname.startsWith(c)));
</script>

{#if page.url.pathname === CHEMINS.accueil}<BoutonsEnregistrer />{:else}<BoutonPrive />{/if}
<nav aria-label="Navigation">
  {#each ONGLETS as o (o.href)}
    {@const point = o.href === CHEMINS.reglages && etatAlertes.nonVues}
    <a href={o.href} class:prive={o.icone === 'cadenas'} aria-current={actif(o.href) ? 'page' : undefined} aria-label={point ? `${o.libelle}, alerte technique à voir` : undefined}>
      <span class="icone"><Icone nom={o.icone} />{#if point}<span class="point" aria-hidden="true"></span>{/if}</span>{o.libelle}
    </a>
  {/each}
</nav>

<style>
  nav {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
    background: var(--surface); border-top: 1px solid var(--line); padding: 6px 0 env(safe-area-inset-bottom);
  }
  nav a {
    min-height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; color: var(--muted); text-decoration: none; font-size: var(--font-meta); font-weight: 500; white-space: nowrap; letter-spacing: -0.01em;
  }
  nav a :global(svg) { box-sizing: content-box; padding: 2px 14px; border-radius: var(--radius-pill); }
  nav a[aria-current='page'] { color: var(--accent-ink); font-weight: 600; }
  nav a[aria-current='page'] :global(svg) { background: var(--accent-soft); }
  nav a.prive[aria-current='page'] { color: var(--private-ink); }
  nav a.prive[aria-current='page'] :global(svg) { background: var(--private-soft); }
  .icone { position: relative; display: inline-flex; }
  /* Alerte technique (admin seulement) : un point discret, jamais un chiffre. */
  .point {
    position: absolute; top: 0; right: 10px; width: 10px; height: 10px; border-radius: var(--radius-pill);
    background: var(--accent); border: 2px solid var(--surface);
  }
</style>
