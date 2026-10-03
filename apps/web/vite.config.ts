import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
import { manifeste } from './src/lib/pwa/manifeste';

export default defineConfig({
  plugins: [
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
