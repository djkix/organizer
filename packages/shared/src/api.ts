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
  captures: { id: string; heure: string; dureeS: number | null; etiquette: string | null }[];
}
