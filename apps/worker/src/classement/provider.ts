import type { TriSortie } from '@organizer/shared';

export interface EntreeClassement {
  systeme: string;
  audio?: { mime: string; donnees: Buffer };
  texte?: string;
}

export interface ResultatClassement {
  sortie: TriSortie;
  modele: string;
  tokensEntree: number;
  tokensSortie: number;
}

/** Seul point de contact avec un modèle. Un modèle local doit pouvoir s'y brancher. */
export interface ClassificationProvider {
  classer(e: EntreeClassement): Promise<ResultatClassement>;
  verifierPalierPaye(): Promise<void>;
}

/** Erreur HTTP du fournisseur. Le message ne contient que le modèle et le statut, jamais le corps. */
export class ErreurFournisseur extends Error {
  override name = 'ErreurFournisseur';
  constructor(readonly statut: number, message: string) {
    super(message);
  }
}

/** Crédit, budget, quota ou clé refusés (402, 403, 429) : indisponibilité temporaire, pas une erreur de classement. */
export class FournisseurIndisponible extends ErreurFournisseur {
  override name = 'FournisseurIndisponible';
}

/** Prépaiement épuisé (HTTP 402). */
export class CreditEpuise extends FournisseurIndisponible {
  override name = 'CreditEpuise';
  constructor(message = 'HTTP 402') {
    super(402, message);
  }
}

/** Sortie hors schéma sur le modèle principal puis le repli. */
export class SortieNonConforme extends Error {
  override name = 'SortieNonConforme';
}

export class PalierNonPaye extends Error {
  override name = 'PalierNonPaye';
}
