import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, type Plugin } from 'vite';
import { manifeste } from './src/lib/pwa/manifeste';
import { entetesPreview } from './scripts/entetes.mjs';

// vite preview sert la construction avec les en-têtes de production : les e2e tournent sous la vraie CSP.
// `preview.headers` ne suffit pas : le serveur de prévisualisation de SvelteKit répond avant lui.
const entetesProduction: Plugin = {
  name: 'organizer:entetes-production',
  configurePreviewServer(serveur) {
    const entetes = entetesPreview();
    serveur.middlewares.use((_req, res, suite) => {
      for (const [nom, valeur] of Object.entries(entetes)) res.setHeader(nom, valeur);
      suite();
    });
  },
};

// L'annonceur de navigation de SvelteKit (accessibilité) porte un attribut style que la CSP bloque :
// on le retire à la compilation, sa règle vit dans app.css (#svelte-announcer).
const annonceurSansStyleEnLigne: Plugin = {
  name: 'organizer:annonceur-sans-style',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('root.svelte') || !code.includes('id="svelte-announcer"')) return null;
    return code.replace(/(id="svelte-announcer"[^>]*?)\s+style="[^"]*"/, '$1');
  },
};

export default defineConfig({
  // Version de la PWA figée à la construction (Docker : ORGANIZER_VERSION ; en local : « dev »).
  define: { __VERSION_PWA__: JSON.stringify(process.env.ORGANIZER_VERSION || 'dev') },
  plugins: [
    entetesProduction,
    annonceurSansStyleEnLigne,
    sveltekit(),
    SvelteKitPWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // SvelteKit compile src/service-worker.ts ; le plugin l'expose sous build/sw.js.
      // Pas de rechargement automatique : une mise à jour s'applique à la prochaine ouverture.
      registerType: 'prompt',
      injectRegister: false,
      manifest: manifeste,
      // SvelteKit construit en chemins relatifs (base ./) : sans cela le worker serait cherché sous /prive/.
      base: '/',
      scope: '/',
      // « / » : la coquille est servie à la racine ; « /index.html » n'existe pas sous vite preview.
      kit: { adapterFallback: 'index.html', spa: { fallbackMapping: '/' } },
      devOptions: { enabled: false },
    }),
  ],
  // En dev, l'API NestJS écoute sur 3000 : même origine pour le cookie de session.
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
