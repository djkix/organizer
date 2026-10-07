import type { LigneAction } from '@organizer/shared/api';
import { describe, expect, it } from 'vitest';
import { bandeJours, groupes, nomVue } from '../src/lib/vues.js';

const F = 'Europe/Paris';
const AUJ = '2026-10-06';
let n = 0;
const l = (texte: string, plus: Partial<LigneAction> = {}): LigneAction => ({
  itemId: `i${++n}`, captureId: `c${n}`, texte, theme: null, echeanceType: null, echeanceExpr: null,
  echeanceDate: null, fenetreFin: null, alarme: false, aAudio: false, ...plus,
});
const aucun = new Set<string>();

describe('groupes', () => {
  it('Aujourd\'hui : les actions sans titre, puis les suggestions sous « Bientôt »', () => {
    const a = l('Rappeler le garage', { echeanceType: 'datee', echeanceDate: '2026-10-06T08:00:00.000Z', alarme: true });
    const s = l('Commander les décorations', { echeanceType: 'fenetre', fenetreFin: '2026-10-24T22:00:00.000Z' });
    const g = groupes({ nom: 'aujourdhui', vue: { jour: AUJ, actions: [a], suggestions: [s] } }, AUJ, F, aucun);
    expect(g.map((x) => x.titre)).toEqual([null, 'Bientôt']);
    expect(g[0]!.lignes[0]).toMatchObject({ itemId: a.itemId, meta: '10:00', alarme: true });
    expect(g[1]!.lignes[0]!.meta).toBe('avant le 25 octobre');
  });

  it('retire les cochés et les groupes devenus vides', () => {
    const a = l('Changer les draps');
    const g = groupes({ nom: 'aujourdhui', vue: { jour: AUJ, actions: [a], suggestions: [] } }, AUJ, F, new Set([a.itemId]));
    expect(g).toEqual([]);
  });

  it('Semaine : un groupe par jour, titré Aujourd\'hui, Demain, puis le jour', () => {
    const vue = { jours: [
      { jour: '2026-10-06', actions: [l('a')] },
      { jour: '2026-10-07', actions: [l('b')] },
      { jour: '2026-10-08', actions: [l('c')] },
    ] };
    expect(groupes({ nom: 'semaine', vue }, AUJ, F, aucun).map((x) => x.titre)).toEqual(["Aujourd'hui", 'Demain', 'Jeudi 8 octobre']);
  });

  it('Horizons : titré par la borne, sans répéter la borne sous chaque ligne', () => {
    const vue = { bornes: [
      { fin: '2026-10-24T22:00:00.000Z', libelle: null, actions: [l('a', { echeanceType: 'fenetre', fenetreFin: '2026-10-24T22:00:00.000Z' })] },
      { fin: '2026-12-24T23:00:00.000Z', libelle: 'avant Noël', actions: [l('b', { echeanceType: 'fenetre', echeanceExpr: 'avant Noël', fenetreFin: '2026-12-24T23:00:00.000Z' })] },
    ] };
    const g = groupes({ nom: 'horizons', vue }, AUJ, F, aucun);
    expect(g.map((x) => x.titre)).toEqual(['Avant le 25 octobre', 'Avant Noël']);
    expect(g.flatMap((x) => x.lignes.map((y) => y.meta))).toEqual(['', '']);
  });

  it('n\'ajoute jamais de ligne à ce que rend l\'API', () => {
    const actions = Array.from({ length: 7 }, (_, i) => l(`action ${i}`));
    const g = groupes({ nom: 'aujourdhui', vue: { jour: AUJ, actions, suggestions: [] } }, AUJ, F, aucun);
    expect(g.flatMap((x) => x.lignes)).toHaveLength(7);
  });
});

describe('nomVue', () => {
  it('Aujourd\'hui par défaut ; pas de vue Rapide au lot 1', () => {
    expect(nomVue(null)).toBe('aujourdhui');
    expect(nomVue('semaine')).toBe('semaine');
    expect(nomVue('horizons')).toBe('horizons');
    expect(nomVue('rapide')).toBe('aujourdhui');
  });
});

describe('bandeJours', () => {
  it('sept jours à partir d\'aujourd\'hui, jour courant marqué, ancres sur les jours non vides', () => {
    const vue = { jours: [{ jour: '2026-10-08', actions: [l('Appeler le garage')] }, { jour: '2026-10-12', actions: [l('Réunion')] }] };
    const b = bandeJours(vue, '2026-10-07');
    expect(b.map((j) => `${j.abrege} ${j.numero}`)).toEqual(['Mer 7', 'Jeu 8', 'Ven 9', 'Sam 10', 'Dim 11', 'Lun 12', 'Mar 13']);
    expect(b[0]).toMatchObject({ jour: '2026-10-07', courant: true, ancre: null });
    expect(b[1]!.ancre).toBe('jour-2026-10-08');
    expect(b[2]!.ancre).toBeNull();
    expect(b[5]!.ancre).toBe('jour-2026-10-12');
  });

  it('jour courant avec actions : ancre et marque à la fois ; passage de mois', () => {
    const b = bandeJours({ jours: [{ jour: '2026-10-30', actions: [l('x')] }] }, '2026-10-30');
    expect(b[0]).toMatchObject({ courant: true, ancre: 'jour-2026-10-30' });
    expect(b.map((j) => j.numero)).toEqual([30, 31, 1, 2, 3, 4, 5]);
  });

  it('les groupes de la semaine portent l\'ancre de leur jour', () => {
    const g = groupes({ nom: 'semaine', vue: { jours: [{ jour: AUJ, actions: [l('a')] }] } }, AUJ, F, aucun);
    expect(g[0]!.ancre).toBe(`jour-${AUJ}`);
  });
});

describe('bandeJours après un cochage', () => {
  it('un jour dont toutes les actions sont retirées perd son ancre', () => {
    const a = l('Seule action de jeudi');
    const b = bandeJours({ jours: [{ jour: '2026-10-08', actions: [a] }] }, '2026-10-07', new Set([a.itemId]));
    expect(b[1]!.ancre).toBeNull();
  });
});
