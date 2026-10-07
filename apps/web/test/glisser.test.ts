import { describe, expect, it } from 'vitest';
import { creerGlisseur, creerOuverture, DISTANCE_MAX, SEUIL_OUVERTURE } from '../src/lib/glisser';

function geste(points: [number, number][]): { dx: (number | null)[]; issue: string } {
  const g = creerGlisseur();
  g.debut(points[0]![0], points[0]![1]);
  const dx = points.slice(1).map(([x, y]) => g.deplacer(x, y));
  return { dx, issue: g.fin() };
}

describe('glisser vers la gauche', () => {
  it('un glissement horizontal assez long découvre « Effacer »', () => {
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

describe('une seule ligne ouverte', () => {
  it('un appui ailleurs referme la ligne ouverte, pas un appui sur elle', () => {
    const o = creerOuverture();
    let fermee = 0;
    o.ouvrir('a', () => fermee++);
    o.dehors('a');
    expect(fermee).toBe(0);
    o.dehors('b');
    expect(fermee).toBe(1);
    o.dehors(null);
    expect(fermee).toBe(1);
  });
  it('ouvrir B referme A', () => {
    const o = creerOuverture();
    const f: string[] = [];
    o.ouvrir('a', () => f.push('a'));
    o.ouvrir('b', () => f.push('b'));
    expect(f).toEqual(['a']);
  });
});
