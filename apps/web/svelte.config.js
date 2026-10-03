import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // SPA : une seule page, servie pour toute route inconnue.
    adapter: adapter({ fallback: 'index.html', strict: true }),
    // Le service worker est enregistré par vite-plugin-pwa (tâche 8), pas par SvelteKit.
    serviceWorker: { register: false },
    // Chemins absolus : la même coquille sert « / » et « /prive/enregistrer » depuis le cache du service worker.
    paths: { relative: false },
  },
};
