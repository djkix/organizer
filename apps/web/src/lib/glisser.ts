/** Geste « glisser vers la gauche » d'une ligne : seul un geste franchement horizontal découvre « Effacer ». */
export const SEUIL_OUVERTURE = 64;
export const DISTANCE_MAX = 96;
const DEAD_ZONE = 10;

export type Issue = 'ouvrir' | 'refermer' | 'fermer';

export interface Glisseur {
  /** `ouvert` : la ligne montre déjà « Effacer » ; le geste utile est alors vers la droite. */
  debut(x: number, y: number, ouvert?: boolean): void;
  /** Décalage horizontal à afficher (0 à -DISTANCE_MAX), ou null quand le geste n'est pas un glissement. */
  deplacer(x: number, y: number): number | null;
  /** `ouvrir` seulement si le geste est horizontal, vers la gauche et assez long ; ligne ouverte : `fermer` si geste horizontal vers la droite assez long, sinon `ouvrir` (elle reste ouverte). */
  fin(): Issue;
  annuler(): void;
}

export function creerGlisseur(): Glisseur {
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let axe: 'h' | 'v' | null = null;
  let actif = false;
  let ouverte = false;
  return {
    debut(x, y, ouvert = false) { x0 = x; y0 = y; dx = 0; axe = null; actif = true; ouverte = ouvert; },
    deplacer(x, y) {
      if (!actif) return null;
      const mx = x - x0;
      const my = y - y0;
      if (axe === null) {
        if (Math.abs(mx) < DEAD_ZONE && Math.abs(my) < DEAD_ZONE) return null;
        // Un défilement vertical (ou un geste plus vertical qu'horizontal) ne glisse jamais la ligne.
        axe = Math.abs(my) >= Math.abs(mx) || (!ouverte && mx > 0) ? 'v' : 'h';
      }
      if (axe === 'v') return null;
      dx = ouverte ? Math.max(0, Math.min(DISTANCE_MAX, mx)) : Math.max(-DISTANCE_MAX, Math.min(0, mx));
      return dx;
    },
    fin() {
      const h = actif && axe === 'h';
      actif = false;
      if (ouverte) return h && dx >= SEUIL_OUVERTURE ? 'fermer' : 'ouvrir';
      return h && dx <= -SEUIL_OUVERTURE ? 'ouvrir' : 'refermer';
    },
    annuler() { actif = false; axe = null; dx = 0; },
  };
}

/** Un appui qui suit un glissement ne doit pas ouvrir la ligne : il est avalé. */
export const estGlissement = (dx: number | null): boolean => dx !== null && Math.abs(dx) > 4;

/** Une seule ligne ouverte à la fois : en ouvrir une referme la précédente ; un appui ailleurs referme. */
export interface Ouverture {
  ouvrir(id: string, fermer: () => void): void;
  /** La ligne `id` s'est refermée d'elle-même. */
  liberer(id: string): void;
  /** Un appui ou un défilement a eu lieu sur la ligne `id` (null : hors de toute ligne). */
  dehors(id: string | null): void;
}

export function creerOuverture(): Ouverture {
  let courante: { id: string; fermer: () => void } | null = null;
  return {
    ouvrir(id, fermer) {
      if (courante && courante.id !== id) courante.fermer();
      courante = { id, fermer };
    },
    liberer(id) { if (courante?.id === id) courante = null; },
    dehors(id) {
      if (!courante || courante.id === id) return;
      const c = courante;
      courante = null;
      c.fermer();
    },
  };
}
export const ouverture = creerOuverture();
