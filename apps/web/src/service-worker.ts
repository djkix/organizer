/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { creerVideur, ouvrirFilePrivee } from './lib/prive/file.js';
import { surSync } from './lib/pwa/sync.js';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | PrecacheEntry> };

interface EvenementSync extends ExtendableEvent {
  readonly tag: string;
}

// Seule la coquille est mise en cache. Aucune route /api : leurs réponses ne sont jamais gardées.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// La coquille précachée est « / » (repli SPA, voir vite.config.ts) : toute navigation, /prive/enregistrer comprise, la reçoit.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/'), { denylist: [/^\/api\//] }));

// Première installation : contrôle immédiat. Une mise à jour attend la fermeture de l'application,
// pour ne jamais recharger la page pendant un enregistrement.
clientsClaim();

// Même module que la page : un seul code d'envoi, verrou « organizer-prive » partagé.
const videur = creerVideur(ouvrirFilePrivee());
self.addEventListener('sync', ((e: EvenementSync) => {
  const travail = surSync(e.tag, () => videur.vider());
  if (travail) e.waitUntil(travail);
}) as EventListener);
