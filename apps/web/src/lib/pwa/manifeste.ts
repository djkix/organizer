import type { ManifestOptions } from 'vite-plugin-pwa';
import tokens from '../../../../../design/tokens.json';
import { CHEMINS } from '../config.js';

export const manifeste = {
  id: '/',
  name: 'Organizer',
  short_name: 'Organizer',
  description: 'Tes vocaux, rangés pour toi.',
  lang: 'fr',
  dir: 'ltr',
  start_url: CHEMINS.accueil,
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  theme_color: tokens.color.light.bg,
  background_color: tokens.color.light.bg,
  icons: [
    { src: '/icones/pwa-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icones/pwa-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icones/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  shortcuts: [
    {
      name: 'Enregistrer',
      short_name: 'Enregistrer',
      url: CHEMINS.enregistrer,
      icons: [{ src: '/icones/raccourci-enregistrer-96.png', sizes: '96x96', type: 'image/png' }],
    },
    {
      name: 'Enregistrement privé',
      short_name: 'Privé',
      url: CHEMINS.enregistreur,
      icons: [{ src: '/icones/raccourci-prive-96.png', sizes: '96x96', type: 'image/png' }],
    },
    {
      name: "Aujourd'hui",
      short_name: "Aujourd'hui",
      url: `${CHEMINS.accueil}?vue=aujourdhui`,
      icons: [{ src: '/icones/raccourci-aujourdhui-96.png', sizes: '96x96', type: 'image/png' }],
    },
  ],
} satisfies Partial<ManifestOptions>;
