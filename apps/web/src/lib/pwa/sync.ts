import { ETIQUETTE_SYNC } from '../config.js';
import type { BilanVidage } from '../prive/file.js';

/**
 * Travail d'un événement Background Sync, ou null s'il ne concerne pas la file privée.
 * Rejeter demande au navigateur un nouvel essai plus tard : seulement faute de réseau
 * (ou si le vidage lui-même échoue). Sans session ou avec des refus durables, la prochaine
 * ouverture s'en charge : pas de boucle d'essais.
 */
export function surSync(etiquette: string, vider: () => Promise<BilanVidage>): Promise<void> | null {
  if (etiquette !== ETIQUETTE_SYNC) return null;
  return vider().then((b) => {
    if (b.horsLigne) throw new Error('Réseau absent : nouvel essai par le navigateur');
  });
}
