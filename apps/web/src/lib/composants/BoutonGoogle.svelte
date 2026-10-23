<script lang="ts" module>
  const SCRIPT = 'https://accounts.google.com/gsi/client';

  interface GoogleId {
    initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
    renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  }
  type AvecGoogle = Window & { google?: { accounts?: { id?: GoogleId } } };

  let chargement: Promise<GoogleId> | null = null;

  /** Une seule balise, réutilisée ; un échec est oublié pour qu'une autre visite réessaie. */
  function chargerGis(): Promise<GoogleId> {
    chargement ??= new Promise<GoogleId>((ok, ko) => {
      const id = (): GoogleId | undefined => (window as AvecGoogle).google?.accounts?.id;
      const deja = id();
      if (deja) return ok(deja);
      let balise = document.head.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
      if (!balise) {
        balise = document.createElement('script');
        balise.src = SCRIPT;
        balise.async = true;
        document.head.appendChild(balise);
      }
      balise.addEventListener('load', () => { const g = id(); if (g) ok(g); else ko(new Error('gsi')); });
      balise.addEventListener('error', () => { balise.remove(); ko(new Error('gsi')); });
    }).catch((e: unknown) => {
      chargement = null;
      throw e;
    });
    return chargement;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  let { clientId, onjeton, onindisponible }: {
    clientId: string;
    onjeton: (jeton: string) => void;
    onindisponible: () => void;
  } = $props();

  let conteneur: HTMLDivElement;

  onMount(() => {
    let vivant = true;
    chargerGis().then((g) => {
      if (!vivant) return;
      g.initialize({ client_id: clientId, callback: (r) => onjeton(r.credential) });
      const largeur = Math.round(Math.min(400, Math.max(200, conteneur.clientWidth)));
      g.renderButton(conteneur, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'fr', width: largeur });
    }, () => { if (vivant) onindisponible(); });
    return () => { vivant = false; };
  });
</script>

<div class="google" bind:this={conteneur}></div>

<style>
  /* L'iframe de Google ne doit jamais élargir la page. */
  .google { width: 100%; max-width: 400px; min-height: 44px; overflow: hidden; display: flex; justify-content: center; }
</style>
