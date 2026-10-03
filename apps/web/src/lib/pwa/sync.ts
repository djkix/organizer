import { ETIQUETTE_SYNC } from '../config.js';
import type { BilanVidage } from '../prive/file.js';

/**
 * Travail d'un événement Background Sync, ou null s'il ne concerne pas la file privée.
 * Rejeter demande au navigateur un nouvel essai plus tard : tant qu'il reste des captures à
 * envoyer (coupure, 429, 5xx) ou si le vidage lui-même échoue. Sans session ou avec des refus
 * durables, la prochaine ouverture s'en charge : pas de boucle d'essais.
 */
export function surSync(etiquette: string, vider: () => Promise<BilanVidage>): Promise<void> | null {
  if (etiquette !== ETIQUETTE_SYNC) return null;
  return vider().then((b) => {
    if (b.restantes > 0 && !b.nonConnecte) throw new Error('Il reste des captures : nouvel essai par le navigateur');
  });
}
