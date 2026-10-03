<script lang="ts">
  import { page } from '$app/state';
  import { CHEMINS } from '$lib/config';
  import Icone from './Icone.svelte';

  const ONGLETS = [
    { href: CHEMINS.accueil, libelle: 'À faire', icone: 'liste' },
    { href: CHEMINS.prive, libelle: 'Privé', icone: 'cadenas' },
    { href: CHEMINS.reglages, libelle: 'Réglages', icone: 'reglages' },
  ] as const;

  const actif = (href: string): boolean =>
    href === CHEMINS.accueil ? page.url.pathname === href : page.url.pathname.startsWith(href);
</script>

<a class="fab" href={CHEMINS.enregistreur} aria-label="Enregistrement privé"><Icone nom="cadenas" taille={26} /></a>
<nav aria-label="Navigation">
  {#each ONGLETS as o (o.href)}
    <a href={o.href} aria-current={actif(o.href) ? 'page' : undefined}><Icone nom={o.icone} />{o.libelle}</a>
  {/each}
</nav>

<style>
  nav {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5; display: flex;
    background: var(--surface); border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom);
  }
  nav a {
    flex: 1; min-height: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; color: var(--muted); text-decoration: none; font-size: var(--font-meta);
  }
  nav a[aria-current='page'] { color: var(--accent); font-weight: 600; }
  .fab {
    position: fixed; right: 18px; bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 5;
    width: 64px; height: 64px; border-radius: var(--radius-pill);
    background: var(--private); color: var(--bg); display: grid; place-items: center;
  }
</style>
