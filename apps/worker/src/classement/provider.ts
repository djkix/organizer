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

/** Crédit ou plafond atteint : indisponibilité temporaire, pas une erreur de classement. */
export class CreditEpuise extends Error {
  override name = 'CreditEpuise';
}

/** Sortie hors schéma sur le modèle principal puis le repli. */
export class SortieNonConforme extends Error {
  override name = 'SortieNonConforme';
}

export class PalierNonPaye extends Error {
  override name = 'PalierNonPaye';
}
