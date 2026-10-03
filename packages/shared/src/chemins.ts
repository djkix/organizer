import { isAbsolute, resolve } from 'node:path';

/** Racine du dépôt : l'API et le worker partent de dossiers différents, ils s'accordent sur celle-ci. */
export const RACINE_DEPOT = resolve(import.meta.dirname, '../../..');

/** Un chemin relatif de la configuration se lit depuis la racine du dépôt ; un absolu est gardé tel quel. */
export function cheminDepuisRacine(chemin: string, racine: string = RACINE_DEPOT): string {
  return isAbsolute(chemin) ? chemin : resolve(racine, chemin);
}
