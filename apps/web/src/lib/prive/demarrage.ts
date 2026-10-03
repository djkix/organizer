import { creerVideur, garderPuisEnvoyer, ouvrirFilePrivee, type Enregistrement } from './file.js';
import { demanderPersistance, demanderSynchro, installerRelances } from './relances.js';

/** Instances de la fenêtre. Le service worker ouvre les siennes sur la même base. */
export const filePrivee = ouvrirFilePrivee();
export const videur = creerVideur(filePrivee);

export function demarrerPrive(): () => void {
  return installerRelances(() => videur.vider(), window, document);
}

export async function garderEtEnvoyer(e: Enregistrement): Promise<void> {
  await garderPuisEnvoyer(filePrivee, videur, e);
  void demanderPersistance();
  void demanderSynchro();
}
