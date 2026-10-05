import type { Nature } from './tri.js';

/** Plafond de clés d'empreinte par compte (API et PWA). */
export const MAX_CLES_PAR_COMPTE = 10;

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

/** Une clé d'accès (empreinte) d'un compte, telle que Réglages la liste. `identifiant` est public. */
export interface ResumeEmpreinte { id: string; identifiant: string; creeLe: string; utiliseeLe: string | null }

/**
 * En-têtes du dépôt d'une capture privée (corps : l'audio brut).
 * L'identifiant (UUID) rend le rejeu idempotent ; sans lui, un rejeu crée un doublon.
 * Réponses : 201 nouvelle, 200 déjà reçue, 415 format, 422 illisible, 400 vide ou identifiant refusé.
 */
export const EN_TETES_CAPTURE_PRIVEE = { id: 'X-Capture-Id', emisLe: 'X-Emis-Le', dureeS: 'X-Duree-S' } as const;

/** Taille maximale d'une capture privée envoyée par la PWA : 30 Mio (une heure à 48 kbit/s en fait environ 22). */
export const TAILLE_MAX_CAPTURE_PRIVEE = 30 * 1024 * 1024;

/** Délai d'un envoi de la PWA : 60 s de base, puis 20 Ko/s au plancher. Proxy et API attendent au moins autant. */
export const delaiEnvoiPriveMs = (octets: number): number => 60_000 + Math.ceil(octets / 20);

/** Délai de la plus grosse capture admise (environ 27 min). */
export const DELAI_ENVOI_PRIVE_MAX_MS = delaiEnvoiPriveMs(TAILLE_MAX_CAPTURE_PRIVEE);
