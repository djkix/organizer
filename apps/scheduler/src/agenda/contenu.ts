import { createHash } from 'node:crypto';
import { isoLocal, MINUTES_ALARME, titreCourt } from '@organizer/shared';
import type { CorpsEvenement } from '../google/calendrier.js';

export const DUREE_EVENEMENT_MS = 30 * 60_000;

export interface ActionPourAgenda {
  itemId: string;
  texte: string;
  nature: string;
  prive: boolean;
  archiveLe: Date | null;
  echeanceType: string | null;
  echeanceDate: Date | null;
  faitLe: Date | null;
  alarme: boolean;
  fuseau: string;
}

/**
 * L'événement que l'agenda doit montrer pour cette action, ou null. Seulement un rendez-vous daté du flux Actions,
 * jamais une pensée ni une capture privée ; titre court, jamais de description ; rappel seulement si L l'a demandé.
 */
export function contenuEvenement(a: ActionPourAgenda): CorpsEvenement | null {
  if (a.nature !== 'action' || a.prive || a.archiveLe || a.faitLe || a.echeanceType !== 'datee' || !a.echeanceDate) return null;
  const fin = new Date(a.echeanceDate.getTime() + DUREE_EVENEMENT_MS);
  return {
    summary: titreCourt(a.texte),
    start: { dateTime: isoLocal(a.echeanceDate, a.fuseau), timeZone: a.fuseau },
    end: { dateTime: isoLocal(fin, a.fuseau), timeZone: a.fuseau },
    reminders: { useDefault: false, overrides: a.alarme ? [{ method: 'popup', minutes: MINUTES_ALARME }] : [] },
  };
}

/** Empreinte de ce qui est écrit dans Google : la comparer évite tout appel quand rien n'a changé. */
export function empreinteContenu(c: CorpsEvenement): string {
  return createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 32);
}

/**
 * Identifiant déterministe : l'UUID de l'item sans tirets (hexadécimal, admis par Google : 0-9 et a-v),
 * puis « g<n> » après une suppression, car Google garde l'identifiant d'un événement supprimé.
 */
export function idEvenement(itemId: string, generation: number): string {
  const base = itemId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(base)) throw new Error("Identifiant d'item inattendu");
  return generation === 0 ? base : `${base}g${generation}`;
}
