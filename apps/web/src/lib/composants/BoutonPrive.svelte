<script lang="ts">
  import { CHEMINS } from '$lib/config';
  import Icone from './Icone.svelte';

  /** Sans barre de navigation (écran de connexion) : le bouton descend au bas de l'écran. */
  let { sansNavigation = false }: { sansNavigation?: boolean } = $props();
</script>

<a class="fab" class:bas={sansNavigation} href={CHEMINS.enregistreur} aria-label="Enregistrement privé"><Icone nom="cadenas" taille={26} /></a>

<style>
  .fab {
    position: fixed; right: 18px; bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 5;
    width: 64px; height: 64px; border-radius: var(--radius-pill);
    background: var(--private); color: var(--bg); display: grid; place-items: center;
  }
  .bas { bottom: calc(24px + env(safe-area-inset-bottom)); }
</style>
