/** Geste « glisser vers la gauche » d'une ligne : seul un geste franchement horizontal découvre « Effacer ». */
export const SEUIL_OUVERTURE = 64;
export const DISTANCE_MAX = 96;
const DEAD_ZONE = 10;

export type Issue = 'ouvrir' | 'refermer';

export interface Glisseur {
  debut(x: number, y: number): void;
  /** Décalage horizontal à afficher (0 à -DISTANCE_MAX), ou null quand le geste n'est pas un glissement. */
  deplacer(x: number, y: number): number | null;
  /** `ouvrir` seulement si le geste est horizontal, vers la gauche et assez long ; sinon rien ne se passe. */
  fin(): Issue;
  annuler(): void;
}

export function creerGlisseur(): Glisseur {
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let axe: 'h' | 'v' | null = null;
  let actif = false;
  return {
    debut(x, y) { x0 = x; y0 = y; dx = 0; axe = null; actif = true; },
    deplacer(x, y) {
      if (!actif) return null;
      const mx = x - x0;
      const my = y - y0;
      if (axe === null) {
        if (Math.abs(mx) < DEAD_ZONE && Math.abs(my) < DEAD_ZONE) return null;
        // Un défilement vertical (ou un geste plus vertical qu'horizontal) ne glisse jamais la ligne.
        axe = Math.abs(my) >= Math.abs(mx) || mx > 0 ? 'v' : 'h';
      }
      if (axe === 'v') return null;
      dx = Math.max(-DISTANCE_MAX, Math.min(0, mx));
      return dx;
    },
    fin() {
      const ok = actif && axe === 'h' && dx <= -SEUIL_OUVERTURE;
      actif = false;
      return ok ? 'ouvrir' : 'refermer';
    },
    annuler() { actif = false; axe = null; dx = 0; },
  };
}

/** Un appui qui suit un glissement ne doit pas ouvrir la ligne : il est avalé. */
export const estGlissement = (dx: number | null): boolean => dx !== null && dx < -4;
