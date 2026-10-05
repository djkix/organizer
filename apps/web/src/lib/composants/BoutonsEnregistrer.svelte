<script lang="ts">
  import { CHEMINS } from '$lib/config';
  import { MESSAGES } from '$lib/messages';
  import Icone from './Icone.svelte';
</script>

<!-- Deux entrées, deux écrans, deux routes d'API : le mode se choisit ici, jamais après coup. -->
<div class="boutons">
  <a class="ordinaire" href={CHEMINS.enregistrer} aria-label="Enregistrer, rangé tout seul">
    <Icone nom="micro" taille={26} />
    <span class="titre">{MESSAGES.enregistrer}</span>
    <span class="sous">{MESSAGES.rangeToutSeulSous}</span>
  </a>
  <a class="prive" href={CHEMINS.enregistreur} aria-label="Enregistrement privé">
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
  a {
    flex: 1; min-height: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; padding: 8px; border-radius: 20px; color: var(--bg); text-decoration: none; text-align: center;
  }
  .ordinaire { background: var(--accent); }
  .prive { background: var(--private); }
  .titre { font-weight: 600; font-size: var(--font-body, 16px); }
  .sous { font-size: var(--font-meta); }
</style>
