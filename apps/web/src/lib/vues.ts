import type { LigneAction, VueAujourdhui, VueHorizons, VueSemaine } from '@organizer/shared/api';
import { libelleBorne, libelleJour, metaLigne } from './format.js';
import { MESSAGES } from './messages.js';
import { pastillesAction, type Pastille } from './pastilles.js';

export const NOMS_VUES = ['aujourdhui', 'semaine', 'horizons'] as const;
export type NomVue = (typeof NOMS_VUES)[number];

export const nomVue = (v: string | null): NomVue =>
  (NOMS_VUES as readonly string[]).includes(v ?? '') ? (v as NomVue) : 'aujourdhui';

export const TITRES: Record<NomVue, { onglet: string; titre: string; sous: string | null }> = {
  aujourdhui: { onglet: "Aujourd'hui", titre: "Aujourd'hui", sous: null },
  semaine: { onglet: 'Semaine', titre: 'Cette semaine', sous: 'Les 7 prochains jours' },
  horizons: { onglet: 'Horizons', titre: 'Horizons', sous: 'Sans date précise' },
};

export const VIDES: Record<NomVue, string> = {
  aujourdhui: MESSAGES.videAujourdhui,
  semaine: MESSAGES.videSemaine,
  horizons: MESSAGES.videHorizons,
};

export interface LigneAffichee { itemId: string; texte: string; meta: string; alarme: boolean; pastilles: Pastille[]; source: LigneAction }
export interface Groupe { titre: string | null; lignes: LigneAffichee[] }
export type DonneesVue =
  | { nom: 'aujourdhui'; vue: VueAujourdhui }
  | { nom: 'semaine'; vue: VueSemaine }
  | { nom: 'horizons'; vue: VueHorizons };

/** Ce que l'écran affiche, dans l'ordre de l'API, sans les lignes cochées dont l'annulation est close. */
export function groupes(d: DonneesVue, aujourdhui: string, fuseau: string, retires: ReadonlySet<string>): Groupe[] {
  const lignes = (ls: LigneAction[], avecMeta = true): LigneAffichee[] =>
    ls.filter((x) => !retires.has(x.itemId)).map((x) => ({
      itemId: x.itemId, texte: x.texte, meta: avecMeta ? metaLigne(x, fuseau) : '', alarme: x.alarme, pastilles: pastillesAction(x, fuseau), source: x,
    }));
  const tous: Groupe[] =
    d.nom === 'aujourdhui'
      ? [{ titre: null, lignes: lignes(d.vue.actions) }, { titre: MESSAGES.bientot, lignes: lignes(d.vue.suggestions) }]
      : d.nom === 'semaine'
        ? d.vue.jours.map((j) => ({ titre: libelleJour(j.jour, aujourdhui), lignes: lignes(j.actions) }))
        : d.vue.bornes.map((b) => ({ titre: libelleBorne(b.fin, b.libelle, fuseau), lignes: lignes(b.actions, false) }));
  return tous.filter((g) => g.lignes.length > 0);
}
