import type { EnvoiHistorique, StatutElement } from '@organizer/shared/api';
import type { Nature } from '@organizer/shared';
import { duree } from './format.js';
import { A_REVOIR, NATURES, type Pastille } from './pastilles.js';

/** « Vocal », « Vocal, Telegram » ou « Écrit », suivi de la durée pour un vocal. */
export function libelleSource(e: Pick<EnvoiHistorique, 'source' | 'vocal' | 'dureeS'>): string {
  if (!e.vocal) return 'Écrit';
  const base = e.source === 'telegram' ? 'Vocal, Telegram' : 'Vocal';
  return e.dureeS === null ? base : `${base} · ${duree(e.dureeS)}`;
}

const PASTILLE_NATURE: Record<Nature, Pastille> = {
  action: NATURES.action, pensee: NATURES.pensee, information: NATURES.info, ambigu: A_REVOIR,
};
export const EN_COURS: Pastille = { type: 'echeance', libelle: 'En cours de tri' };

/** Ce que l'envoi est devenu, une pastille par nature, sans aucun nombre (règle n° 3). */
export function pastillesEnvoi(e: Pick<EnvoiHistorique, 'etat' | 'natures'>): Pastille[] {
  if (e.etat === 'en_cours') return [EN_COURS];
  const p = e.natures.map((n) => PASTILLE_NATURE[n]);
  if (e.etat === 'a_revoir' && !e.natures.includes('ambigu')) p.push(A_REVOIR);
  return p;
}

export const pastilleNature = (n: Nature): Pastille => PASTILLE_NATURE[n];

/** État d'un élément en mots ; une pensée ou une information n'en a pas. */
export function libelleStatut(s: StatutElement): string | null {
  return s === 'a_faire' ? 'À faire' : s === 'fait' ? 'Fait' : s === 'efface' ? 'Effacé' : null;
}
