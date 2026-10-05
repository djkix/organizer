import { UnrecoverableError } from 'bullmq';
import { ErreurGoogle, GoogleIndisponible } from '../google/erreurs.js';
import { AutorisationRetiree } from './jetons.js';
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

export type AlerteAgenda =
  | { type: 'autorisation_retiree'; utilisateurId: string }
  | { type: 'agenda_supprime'; utilisateurId: string };

export interface OptionsTravail {
  /** Point d'accroche de l'alerte à l'administrateur (câblé à la tâche 9). Appelé une fois : l'état de la connexion change. */
  alerter: (a: AlerteAgenda) => Promise<void>;
}

/**
 * Travail de la file de synchronisation. Les échecs définitifs deviennent des UnrecoverableError (BullMQ ne les rejoue
 * pas) ; les pannes passagères repartent telles quelles. Ni titre ni jeton dans les messages.
 */
export function travailSynchro(d: DepsSynchro, o: OptionsTravail): (itemId: string) => Promise<IssueSynchro> {
  return async (itemId) => {
    try {
      return await synchroniserAction(itemId, d);
    } catch (e) {
      if (e instanceof AutorisationRetiree) await o.alerter({ type: 'autorisation_retiree', utilisateurId: e.utilisateurId });
      else if (e instanceof AgendaSupprime) await o.alerter({ type: 'agenda_supprime', utilisateurId: e.utilisateurId });
      if (estReessayable(e)) throw e;
      const nom = e instanceof Error ? e.name : 'erreur';
      throw new UnrecoverableError(`Synchronisation définitive en échec : ${nom}${e instanceof ErreurGoogle ? ` ${e.statut}` : ''}`);
    }
  };
}
