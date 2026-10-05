import { UnrecoverableError } from 'bullmq';
import { ErreurGoogle, GoogleIndisponible } from '../google/erreurs.js';
import { AutorisationRetiree, NonConnecte } from './jetons.js';
import { AgendaSupprime, synchroniserAction, type DepsSynchro, type IssueSynchro } from './synchroniser.js';

/**
 * Une panne passagère se réessaie : GoogleIndisponible (429, 403 de débit), ErreurGoogle simple (5xx), erreurs réseau
 * et délais dépassés. Tout autre erreur Google (JetonRefuse après un nouvel essai, Introuvable, DejaPresent,
 * OctroiInvalide, ClientRefuse, GoogleRefuse, RequeteInvalide) est définitive, comme AutorisationRetiree et AgendaSupprime.
 */
export function estReessayable(e: unknown): boolean {
  if (e instanceof GoogleIndisponible) return true;
  if (e instanceof ErreurGoogle) return e.constructor === ErreurGoogle;
  if (e instanceof AutorisationRetiree || e instanceof AgendaSupprime) return false;
  return e instanceof TypeError || (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError'));
}

/** Échec définitif : refus Google non réessayable, ou agenda supprimé. Tout le reste (base, réseau, inconnu) se réessaie. */
function estDefinitif(e: unknown): boolean {
  return e instanceof AgendaSupprime || (e instanceof ErreurGoogle && !estReessayable(e));
}

/**
 * Travail de la file de synchronisation (alertes : jetons.ts et synchroniser.ts, une fois par changement d'état).
 * AutorisationRetiree finit normalement en 'revoque', NonConnecte en 'sans_agenda'. Les refus Google définitifs
 * deviennent des UnrecoverableError. Tout autre échec (GoogleIndisponible, panne base, réseau, inconnu) repart tel quel,
 * réessayable. Tâche 9 : sur GoogleIndisponible, mettre la file en pause 15 min et alerter une fois par épisode.
 * Ni titre ni jeton dans les messages.
 */
export function travailSynchro(d: DepsSynchro): (itemId: string) => Promise<IssueSynchro | 'revoque'> {
  return async (itemId) => {
    try {
      return await synchroniserAction(itemId, d);
    } catch (e) {
      if (e instanceof AutorisationRetiree) return 'revoque';
      if (e instanceof NonConnecte) return 'sans_agenda';
      if (!estDefinitif(e)) throw e;
      const nom = (e as Error).name;
      throw new UnrecoverableError(`Synchronisation définitive en échec : ${nom}${e instanceof ErreurGoogle ? ` ${e.statut}` : ''}`);
    }
  };
}
