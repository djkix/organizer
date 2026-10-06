<script lang="ts">
  import { CHEMINS } from '$lib/config';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';
</script>

<!-- Deux entrées, deux écrans, deux routes d'API : le mode se choisit ici, jamais après coup. -->
<div class="boutons">
  <a class="ordinaire" href="{CHEMINS.enregistrer}" aria-label="Enregistrer, rangé tout seul">
    <Icone nom="micro" taille={26} />
    <span class="titre">{MESSAGES.enregistrer}</span>
    <span class="sous">{MESSAGES.rangeToutSeulSous}</span>
  </a>
  <a class="prive" href="{CHEMINS.enregistreur}" aria-label="Enregistrement privé">
    <Icone nom="cadenas" taille={26} />
    <span class="titre">{MESSAGES.priveBouton}</span>
    <span class="sous">{MESSAGES.resteSurServeur}</span>
  </a>
</div>

<style>
  .boutons {
    position: fixed; left: 16px; right: 16px; bottom: calc(88px + env(safe-area-inset-bottom)); z-index: 5;
    display: flex; gap: 12px;
  }
  /* Relief sobre : un liseré bas plus foncé (pas d'ombre). Appuyé, le bouton descend et le liseré s'amincit. */
  a {
    flex: 1; min-height: 92px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; padding: 10px 8px; border-radius: 22px; text-decoration: none; text-align: center;
    border-bottom: 5px solid transparent; transition: transform 80ms ease-out;
  }
  a:active { transform: translateY(3px); border-bottom-width: 2px; padding-bottom: 13px; }
  a:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
  .ordinaire { background: var(--cta); color: var(--cta-text); border-bottom-color: var(--cta-edge); }
  .prive { background: var(--cta-private); color: var(--cta-private-text); border-bottom-color: var(--cta-private-edge); }
  .titre { font-weight: 700; font-size: 19px; letter-spacing: 0.01em; }
  .sous { font-size: var(--font-meta); }
</style>
