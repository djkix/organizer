import { describe, expect, it } from 'vitest';
import { creerGlisseur, DISTANCE_MAX, SEUIL_OUVERTURE } from '../src/lib/glisser';

function geste(points: [number, number][]): { dx: (number | null)[]; issue: string } {
  const g = creerGlisseur();
  g.debut(points[0]![0], points[0]![1]);
  const dx = points.slice(1).map(([x, y]) => g.deplacer(x, y));
  return { dx, issue: g.fin() };
}

describe('glisser vers la gauche', () => {
  it('un glissement horizontal assez long demande l'effacement', () => {
    expect(geste([[300, 100], [260, 102], [200, 104]]).issue).toBe('ouvrir');
  });
  it('trop court : la ligne se referme', () => {
    expect(geste([[300, 100], [300 - SEUIL_OUVERTURE + 10, 100]]).issue).toBe('refermer');
  });
  it('un défilement vertical n\'ouvre jamais, même s\'il dérive à gauche', () => {
    const r = geste([[300, 100], [296, 130], [200, 200]]);
    expect(r.issue).toBe('refermer');
    expect(r.dx.every((d) => d === null)).toBe(true);
  });
  it('vers la droite : rien', () => {
    expect(geste([[100, 100], [220, 100]]).issue).toBe('refermer');
  });
  it('un appui sans mouvement : rien', () => {
    expect(geste([[100, 100], [101, 101]]).issue).toBe('refermer');
  });
  it('le décalage est borné', () => {
    expect(geste([[400, 100], [200, 100]]).dx.at(-1)).toBe(-DISTANCE_MAX);
  });
  it('un geste annulé (pointercancel) ne laisse rien ouvrir', () => {
    const g = creerGlisseur();
    g.debut(300, 100);
    g.deplacer(150, 100);
    g.annuler();
    expect(g.fin()).toBe('refermer');
  });
});

describe('ligne ouverte', () => {
  it('ouverte, un glissement vers la droite assez long la referme', () => {
    const g = creerGlisseur();
    g.debut(100, 100, true);
    g.deplacer(150, 102);
    g.deplacer(190, 102);
    expect(g.fin()).toBe('fermer');
  });
  it('ouverte, un geste trop court ou vertical la laisse ouverte', () => {
    const g = creerGlisseur();
    g.debut(100, 100, true);
    g.deplacer(120, 100);
    expect(g.fin()).toBe('ouvrir');
    g.debut(100, 100, true);
    expect(g.deplacer(110, 160)).toBeNull();
    expect(g.fin()).toBe('ouvrir');
  });
});

describe('seuils : un geste franc, pas un effleurement', () => {
  it('96 px pour demander l\'effacement, décalage borné à 160 px', () => {
    expect(SEUIL_OUVERTURE).toBe(96);
    expect(DISTANCE_MAX).toBe(160);
    expect(geste([[300, 100], [200, 102]]).issue).toBe('ouvrir');
    expect(geste([[300, 100], [220, 102]]).issue).toBe('refermer');
  });
});
