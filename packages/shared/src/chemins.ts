import { isAbsolute, resolve } from 'node:path';

/** Racine du dépôt : l'API et le worker partent de dossiers différents, ils s'accordent sur celle-ci. */
export const RACINE_DEPOT = resolve(import.meta.dirname, '../../..');

/** Un chemin relatif de la configuration se lit depuis la racine du dépôt ; un absolu est gardé tel quel. */
export function cheminDepuisRacine(chemin: string, racine: string = RACINE_DEPOT): string {
  return isAbsolute(chemin) ? chemin : resolve(racine, chemin);
}

/**
 * Chemin lu dans la configuration. En production, il doit être absolu : RACINE_DEPOT n'a de sens
 * que depuis les sources ; dans un paquet construit (dist), il désignerait la racine du système.
 */
export function cheminConfigure(nom: string, valeur: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.NODE_ENV === 'production' && !isAbsolute(valeur)) {
    throw new Error(`${nom} doit être un chemin absolu en production : ${valeur}`);
  }
  return cheminDepuisRacine(valeur);
}
