import { ETIQUETTE_SYNC } from '../config.js';
import type { BilanVidage } from './file.js';

type Cible = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Vide la file maintenant, au retour du réseau et au retour à l'écran. Rend la fonction de démontage. */
export function installerRelances(
  vider: () => Promise<unknown>, fenetre: Cible, doc: Cible & { readonly visibilityState: DocumentVisibilityState },
): () => void {
  const lancer = (): void => {
    // Un échec attend simplement la relance suivante : jamais d'alerte.
    vider().catch(() => undefined);
  };
  const auRetour = (): void => {
    if (doc.visibilityState === 'visible') lancer();
  };
  lancer();
  fenetre.addEventListener('online', lancer);
  doc.addEventListener('visibilitychange', auRetour);
  return () => {
    fenetre.removeEventListener('online', lancer);
    doc.removeEventListener('visibilitychange', auRetour);
  };
}

/** Demande que la file survive à la pression mémoire (Contraintes PWA). */
export async function demanderPersistance(
  s: Pick<StorageManager, 'persist' | 'persisted'> | undefined = globalThis.navigator?.storage,
): Promise<boolean> {
  if (!s) return false;
  try {
    return (await s.persisted()) || (await s.persist());
  } catch {
    return false;
  }
}

type AvecSync = ServiceWorkerRegistration & { sync?: { register(etiquette: string): Promise<void> } };

/** Inscrit un Background Sync : le service worker videra la file au retour du réseau, application fermée. */
export async function demanderSynchro(
  sw: Pick<ServiceWorkerContainer, 'getRegistration'> | undefined = globalThis.navigator?.serviceWorker,
): Promise<boolean> {
  try {
    const reg = (await sw?.getRegistration()) as AvecSync | undefined;
    if (!reg?.sync) return false;
    await reg.sync.register(ETIQUETTE_SYNC);
    return true;
  } catch {
    return false;
  }
}

/** Dès qu'un bilan laisse des captures, demande un Background Sync : le navigateur réessaiera application fermée. */
export function synchroSiRestantes(
  ecouter: (f: (b: BilanVidage) => void) => () => void, demander: () => Promise<unknown>,
): () => void {
  return ecouter((b) => {
    if (b.restantes > 0) void demander();
  });
}
