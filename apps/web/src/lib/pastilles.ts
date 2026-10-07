import type { LigneAction } from '@organizer/shared/api';
import { heureLocale } from './format.js';
import type { NomIcone } from './composants/icones.js';

export type TypePastille = 'action' | 'pensee' | 'info' | 'arevoir' | 'alarme' | 'echeance' | 'prive';
export interface Pastille { type: TypePastille; libelle: string; icone?: NomIcone }

export const NATURES: Record<'action' | 'pensee' | 'info', Pastille> = {
  action: { type: 'action', libelle: 'Action' },
  pensee: { type: 'pensee', libelle: 'Pensée' },
  info: { type: 'info', libelle: 'Info' },
};
export const A_REVOIR: Pastille = { type: 'arevoir', libelle: 'À revoir' };
export const PRIVE: Pastille = { type: 'prive', libelle: 'Privé', icone: 'cadenas' };

/**
 * Pastilles d'une ligne d'action : au plus deux (l'échéance, puis l'alarme). La nature n'y figure pas :
 * ces listes ne contiennent que des actions.
 */
export function pastillesAction(l: LigneAction, fuseau: string): Pastille[] {
  const p: Pastille[] = [];
  if (l.echeanceType === 'datee' && l.echeanceDate) p.push({ type: 'echeance', libelle: heureLocale(l.echeanceDate, fuseau) });
  else if (l.echeanceType === 'fenetre') p.push({ type: 'echeance', libelle: 'Fenêtre' });
  else if (l.echeanceType === 'jour') p.push({ type: 'echeance', libelle: 'Jour' });
  if (l.alarme) p.push({ type: 'alarme', libelle: 'Alarme', icone: 'cloche' });
  return p;
}
