<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import Navigation from '$lib/composants/Navigation.svelte';
  import { CHEMINS } from '$lib/config';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
  // Chaîne large : la route de l'enregistreur n'existe pas encore, les chemins typés la refuseraient.
  const chemin = $derived<string>(page.url.pathname);
  const plein = $derived(chemin === CHEMINS.connexion || chemin === CHEMINS.enregistreur);
</script>

{@render children()}
{#if !plein}<Navigation />{/if}
