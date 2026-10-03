import type { CorpsCorrection } from '@organizer/shared/api';
import { debutJour, instantLocal, isoLocal } from '@organizer/shared/dates';

export type ChoixEcheance =
  | { type: 'aucune' }
  | { type: 'jour'; jour: string }
  | { type: 'datee'; jour: string; heure: string }
  | { type: 'avant'; jour: string };

/** Dates ISO 8601 avec le décalage du fuseau, comme l'exige l'API. */
export function corpsEcheance(c: ChoixEcheance, fuseau: string): CorpsCorrection {
  const minuit = (jour: string): string => isoLocal(debutJour(jour, fuseau), fuseau);
  switch (c.type) {
    case 'aucune':
      return { echeance: { type: 'aucune' } };
    case 'jour':
      return { echeance: { type: 'jour', date: minuit(c.jour) } };
    case 'datee':
      return { echeance: { type: 'datee', date: isoLocal(instantLocal(c.jour, c.heure, fuseau), fuseau) } };
    case 'avant':
      return { echeance: { type: 'fenetre', debut: null, fin: minuit(c.jour) } };
  }
}

export const corpsNature = (nature: 'action' | 'pensee'): CorpsCorrection => ({ nature });

/** Valeur d'un champ date (AAAA-MM-JJ) ou date-heure (AAAA-MM-JJTHH:MM) ; null si vide ou illisible. */
export function choixDepuisChamp(type: 'jour' | 'avant' | 'datee', valeur: string): ChoixEcheance | null {
  if (type === 'datee') {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(valeur);
    return m ? { type, jour: m[1]!, heure: m[2]! } : null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(valeur) ? { type, jour: valeur } : null;
}
