import type { CorpsEvenement } from '../google/calendrier.js';
import { empreinteContenu } from './contenu.js';

export type Plan = { type: 'rien' } | { type: 'creer' } | { type: 'remplacer' } | { type: 'supprimer' };

export interface EtatSynchro {
  contenu: CorpsEvenement | null;
  evenementId: string | null;
  calendrierId: string | null;
  empreinte: string | null;
}

/** Jamais de création pour un rendez-vous commencé depuis plus longtemps : la première connexion n'importe pas le passé. */
export const PASSE_MAX_MS = 24 * 3600_000;

/** L'écart entre l'action et son événement, sans aucun appel à Google. */
export function planifier(e: EtatSynchro, agendaCourant: string, maintenant: Date): Plan {
  if (!e.contenu) return e.evenementId ? { type: 'supprimer' } : { type: 'rien' };
  if (e.evenementId && e.calendrierId === agendaCourant) {
    return e.empreinte === empreinteContenu(e.contenu) ? { type: 'rien' } : { type: 'remplacer' };
  }
  if (Date.parse(e.contenu.start.dateTime) < maintenant.getTime() - PASSE_MAX_MS) return { type: 'rien' };
  return { type: 'creer' };
}
