import type { LigneAction } from '@organizer/shared/api';
import { ajouterJours, isoLocal, jourLocal } from '@organizer/shared/dates';

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const majuscule = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const deux = (n: number): string => String(n).padStart(2, '0');
const quantieme = (j: number): string => (j === 1 ? '1er' : String(j));
const parties = (jour: string): [number, number, number] => jour.split('-').map(Number) as [number, number, number];

/** « mardi 6 octobre ». Calculé sur le jour civil : aucun fuseau en jeu. */
export function jourEnClair(jour: string): string {
  const [a, m, j] = parties(jour);
  return `${JOURS[new Date(Date.UTC(a, m - 1, j)).getUTCDay()]} ${quantieme(j)} ${MOIS[m - 1]}`;
}

export const titreDuJour = (jour: string): string => majuscule(jourEnClair(jour));

export function libelleJour(jour: string, aujourdhui: string): string {
  if (jour === aujourdhui) return "Aujourd'hui";
  if (jour === ajouterJours(aujourdhui, 1)) return 'Demain';
  if (jour === ajouterJours(aujourdhui, -1)) return 'Hier';
  return titreDuJour(jour);
}

export const heureLocale = (iso: string, fuseau: string): string => isoLocal(new Date(iso), fuseau).slice(11, 16);

export function avantLe(iso: string, fuseau: string): string {
  const [, m, j] = parties(jourLocal(new Date(iso), fuseau));
  return `avant le ${quantieme(j)} ${MOIS[m - 1]}`;
}

/** Ce qui s'affiche sous le texte d'une action : une heure, une borne ou rien, jamais de compteur. */
export function metaLigne(l: LigneAction, fuseau: string): string {
  if (l.echeanceType === 'datee' && l.echeanceDate) return heureLocale(l.echeanceDate, fuseau);
  if (l.echeanceType === 'fenetre' && l.fenetreFin) return l.echeanceExpr ?? avantLe(l.fenetreFin, fuseau);
  return l.echeanceExpr ?? '';
}

export const libelleBorne = (fin: string, libelle: string | null, fuseau: string): string =>
  majuscule(libelle ?? avantLe(fin, fuseau));

/** L'échéance actuelle, dans le détail d'un item. */
export function echeanceEnClair(l: LigneAction, fuseau: string): string {
  if (l.echeanceType === 'fenetre' && l.fenetreFin) return libelleBorne(l.fenetreFin, l.echeanceExpr, fuseau);
  if (l.echeanceDate && l.echeanceType !== 'aucune') {
    const jour = titreDuJour(jourLocal(new Date(l.echeanceDate), fuseau));
    return l.echeanceType === 'datee' ? `${jour}, ${heureLocale(l.echeanceDate, fuseau)}` : jour;
  }
  return 'Sans date';
}

export const momentEnClair = (iso: string, fuseau: string): string =>
  `${titreDuJour(jourLocal(new Date(iso), fuseau))}, ${heureLocale(iso, fuseau)}`;

export function duree(s: number | null): string {
  if (s === null) return '';
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${deux(s % 60)}`;
}

export const chrono = (s: number): string => `${Math.floor(s / 60)}:${deux(s % 60)}`;

export function libelleMois(mois: string): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return `${majuscule(MOIS[m - 1] ?? '')} ${a}`;
}

export function moisVoisin(mois: string, delta: number): string {
  const [a, m] = mois.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
