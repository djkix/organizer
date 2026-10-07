<script lang="ts">
  import { CHEMINS } from '$lib/config';
  import Icone from './Icone.svelte';

  /** Sans barre de navigation (écran de connexion) : le bouton descend au bas de l'écran. */
  let { sansNavigation = false }: { sansNavigation?: boolean } = $props();
</script>

<a class="fab" class:bas={sansNavigation} href={CHEMINS.enregistreur} aria-label="Enregistrement privé"><Icone nom="cadenas" taille={26} /></a>

<style>
  .fab {
    position: fixed; right: 20px; bottom: calc(84px + env(safe-area-inset-bottom)); z-index: 5;
    width: 64px; height: 64px; border-radius: 18px; border-bottom: 3px solid var(--cta-private-edge);
    background: var(--cta-private); color: var(--cta-private-text); display: grid; place-items: center;
  }
  .fab:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
  .bas { bottom: calc(24px + env(safe-area-inset-bottom)); }
</style>
