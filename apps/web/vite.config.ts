import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // En dev, l'API NestJS écoute sur 3000 : même origine pour le cookie de session.
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
