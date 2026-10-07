<script lang="ts">
  import { page } from '$app/state';
  import { CHEMINS } from '$lib/config';
  import BoutonPrive from './BoutonPrive.svelte';
  import BoutonsEnregistrer from './BoutonsEnregistrer.svelte';
  import Icone from './Icone.svelte';

  const ONGLETS = [
    { href: CHEMINS.accueil, libelle: 'À faire', icone: 'liste' },
    { href: CHEMINS.prive, libelle: 'Privé', icone: 'cadenas' },
    { href: CHEMINS.reglages, libelle: 'Réglages', icone: 'reglages' },
  ] as const;

  const actif = (href: string): boolean =>
    href === CHEMINS.accueil ? page.url.pathname === href : page.url.pathname.startsWith(href);
</script>

{#if page.url.pathname === CHEMINS.accueil}<BoutonsEnregistrer />{:else}<BoutonPrive />{/if}
<nav aria-label="Navigation">
  {#each ONGLETS as o (o.href)}
    <a href={o.href} class:prive={o.icone === 'cadenas'} aria-current={actif(o.href) ? 'page' : undefined}><Icone nom={o.icone} />{o.libelle}</a>
  {/each}
</nav>

<style>
  nav {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    background: var(--surface); border-top: 1px solid var(--line); padding: 6px 8px env(safe-area-inset-bottom);
  }
  nav a {
    min-height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; color: var(--muted); text-decoration: none; font-size: var(--font-meta); font-weight: 500;
  }
  nav a :global(svg) { box-sizing: content-box; padding: 2px 18px; border-radius: var(--radius-pill); }
  nav a[aria-current='page'] { color: var(--accent-ink); font-weight: 600; }
  nav a[aria-current='page'] :global(svg) { background: var(--accent-soft); }
  nav a.prive[aria-current='page'] { color: var(--private-ink); }
  nav a.prive[aria-current='page'] :global(svg) { background: var(--private-soft); }
</style>
