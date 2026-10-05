<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import BoutonPrive from '$lib/composants/BoutonPrive.svelte';
  import Navigation from '$lib/composants/Navigation.svelte';
  import { CHEMINS } from '$lib/config';
  import { demarrerPrive } from '$lib/prive/demarrage';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
  // Chaîne large : la route de l'enregistreur n'existe pas encore, les chemins typés la refuseraient.
  const chemin = $derived<string>(page.url.pathname);
  const plein = $derived(chemin === CHEMINS.connexion || chemin === CHEMINS.enregistreur || chemin === CHEMINS.enregistrer);
  // À chaque ouverture, au retour du réseau et au retour à l'écran : la file privée part.
  onMount(() => demarrerPrive());
</script>

{@render children()}
{#if !plein}<Navigation />{:else if chemin === CHEMINS.connexion}<BoutonPrive sansNavigation />{/if}
