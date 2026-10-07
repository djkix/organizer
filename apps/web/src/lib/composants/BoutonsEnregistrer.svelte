<script lang="ts">
  import { CHEMINS } from '$lib/config';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';
</script>

<!-- Deux entrées, deux écrans, deux routes d'API : le mode se choisit ici, jamais après coup. -->
<div class="boutons">
  <a class="ordinaire" href="{CHEMINS.enregistrer}?auto=1" aria-label="Enregistrer, rangé tout seul">
    <Icone nom="micro" taille={24} />
    <span class="titre">{MESSAGES.enregistrer}</span>
  </a>
  <a class="prive" href="{CHEMINS.enregistreur}?auto=1" aria-label="Enregistrement privé">
    <Icone nom="cadenas" taille={24} />
    <span class="titre">{MESSAGES.priveBouton}</span>
  </a>
</div>

<style>
  .boutons {
    position: fixed; left: 20px; right: 20px; bottom: calc(84px + env(safe-area-inset-bottom)); z-index: 5;
    display: grid; grid-template-columns: 2fr 1fr; gap: 10px;
  }
  /* Relief sobre : un liseré bas plus foncé (pas d'ombre). Appuyé, le bouton descend et le liseré s'amincit. */
  a {
    min-height: 64px; display: flex; align-items: center; justify-content: center; gap: 10px;
    padding: 0 12px; border-radius: 18px; text-decoration: none; text-align: center;
    border-bottom: 3px solid transparent; transition: transform 80ms ease-out;
  }
  a:active { transform: translateY(2px); border-bottom-width: 1px; }
  a:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
  .ordinaire { background: var(--cta); color: var(--cta-text); border-bottom-color: var(--cta-edge); }
  .prive { background: var(--cta-private); color: var(--cta-private-text); border-bottom-color: var(--cta-private-edge); }
  .titre { font-weight: 600; font-size: 18px; }
</style>
