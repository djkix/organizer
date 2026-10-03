import { registerSW } from 'virtual:pwa-register';
import { creerVideur, garderPuisEnvoyer, ouvrirFilePrivee, type Enregistrement } from './file.js';
import { enregistrerSW } from '../pwa/enregistrement.js';
import { demanderPersistance, demanderSynchro, installerRelances, synchroSiRestantes } from './relances.js';

/** Instances de la fenêtre. Le service worker ouvre les siennes sur la même base. */
export const filePrivee = ouvrirFilePrivee();
export const videur = creerVideur(filePrivee);

export function demarrerPrive(): () => void {
  enregistrerSW(registerSW);
  // Écouteur avant le premier vidage : un bilan avec des restes demande aussi la synchro d'arrière-plan.
  const arreterSynchro = synchroSiRestantes((f) => videur.ecouter(f), demanderSynchro);
  const arreterRelances = installerRelances(() => videur.vider(), window, document);
  return () => {
    arreterSynchro();
    arreterRelances();
  };
}

/** id : fixé une fois pour cet enregistrement, repris par chaque essai (file ou envoi direct). */
export async function garderEtEnvoyer(e: Enregistrement, id: string): Promise<void> {
  await garderPuisEnvoyer(filePrivee, videur, e, id);
  void demanderPersistance();
  void demanderSynchro();
}
