import type { Nature } from './tri.js';

export interface LigneAction {
  itemId: string;
  captureId: string;
  texte: string;
  theme: string | null;
  echeanceType: string | null;
  echeanceExpr: string | null;
  echeanceDate: string | null;
  fenetreFin: string | null;
  alarme: boolean;
  aAudio: boolean;
}
export interface VueAujourdhui { jour: string; actions: LigneAction[]; suggestions: LigneAction[] }
export interface VueSemaine { jours: { jour: string; actions: LigneAction[] }[] }
export interface VueHorizons { bornes: { fin: string; libelle: string | null; actions: LigneAction[] }[] }
export interface ItemARevoir { itemId: string; captureId: string; texte: string; emisLe: string; aAudio: boolean }
export interface CaptureARevoir { captureId: string; texte: string | null; emisLe: string; aAudio: boolean }
export interface VueARevoir { items: ItemARevoir[]; captures: CaptureARevoir[] }

export interface JourPrive {
  jour: string;
  captures: { id: string; heure: string; dureeS: number | null; etiquette: string | null; aAudio: boolean }[];
}

export interface CorpsConnexion { nom: string; motDePasse: string }

/**
 * Correction d'un item. Dates ISO 8601 avec fuseau ; `jour` = minuit local ;
 * `fenetre` exige `fin` ; `aucune` vide toutes les dates.
 */
export interface CorpsCorrection {
  nature?: Nature;
  echeance?: { type: string; date?: string | null; debut?: string | null; fin?: string | null };
}

export interface CorpsEtiquette { etiquette: string | null }
export interface ReponseErreur { message: string }
export interface ReponseDepotPrive { id: string }

/**
 * En-têtes du dépôt d'une capture privée (corps : l'audio brut).
 * L'identifiant (UUID) rend le rejeu idempotent ; sans lui, un rejeu crée un doublon.
 * Réponses : 201 nouvelle, 200 déjà reçue, 415 format, 422 illisible, 400 vide ou identifiant refusé.
 */
export const EN_TETES_CAPTURE_PRIVEE = { id: 'X-Capture-Id', emisLe: 'X-Emis-Le', dureeS: 'X-Duree-S' } as const;
