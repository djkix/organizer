<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import BoutonPrive from '$lib/composants/BoutonPrive.svelte';
  import Navigation from '$lib/composants/Navigation.svelte';
  import { CHEMINS } from '$lib/config';
  import { etatAlertes, rafraichirAlertes } from '$lib/alertes.svelte';
  import { demarrerPrive } from '$lib/prive/demarrage';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
  // Chaîne large : la route de l'enregistreur n'existe pas encore, les chemins typés la refuseraient.
  const chemin = $derived<string>(page.url.pathname);
  const plein = $derived(chemin === CHEMINS.connexion || chemin === CHEMINS.enregistreur || chemin === CHEMINS.enregistrer);
  // À chaque ouverture, au retour du réseau et au retour à l'écran : la file privée part.
  onMount(() => demarrerPrive());
  // Alertes techniques (admin seulement) : vues à l'ouverture et au retour sur l'application.
  // Et à chaque changement de session (déconnexion, autre compte) : le point de l'admin ne reste jamais pour L.
  // Pas de session lue (raccourci privé) : rien, aucun appel réseau.
  $effect(() => {
    const s = page.data.session;
    if (!s) return;
    if (s.etat !== 'connecte' || !s.admin) { etatAlertes.nonVues = false; return; }
    void rafraichirAlertes();
  });
  onMount(() => {
    const retour = (): void => { if (document.visibilityState === 'visible') void rafraichirAlertes(); };
    document.addEventListener('visibilitychange', retour);
    return () => document.removeEventListener('visibilitychange', retour);
  });
</script>

{@render children()}
{#if !plein}<Navigation />{:else if chemin === CHEMINS.connexion}<BoutonPrive sansNavigation />{/if}
