import { describe, expect, it } from 'vitest';
import type { LigneAction } from '@organizer/shared/api';
import { A_REVOIR, NATURES, PRIVE, pastillesAction } from '../src/lib/pastilles';

const F = 'Europe/Paris';
const ligne = (o: Partial<LigneAction>): LigneAction => ({
  itemId: 'i', captureId: 'c', texte: 't', theme: null, echeanceType: null, echeanceExpr: null, echeanceDate: null, fenetreFin: null, alarme: false, aAudio: false, ...o,
});
const libelles = (l: LigneAction): string[] => pastillesAction(l, F).map((p) => p.libelle);

describe('pastilles d\'une action', () => {
  it('datée avec alarme : l\'heure puis « Alarme » avec la cloche', () => {
    const p = pastillesAction(ligne({ echeanceType: 'datee', echeanceDate: '2026-10-06T08:00:00.000Z', alarme: true }), F);
    expect(p.map((x) => x.libelle)).toEqual(['10:00', 'Alarme']);
    expect(p[1]!.icone).toBe('cloche');
  });
  it('jour, fenêtre, sans date', () => {
    expect(libelles(ligne({ echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' }))).toEqual(['Dans la journée']);
    expect(libelles(ligne({ echeanceType: 'fenetre', fenetreFin: '2026-10-24T22:00:00.000Z' }))).toEqual(['Fenêtre']);
    expect(libelles(ligne({ echeanceType: 'aucune' }))).toEqual([]);
  });
  it('jamais plus de deux pastilles, jamais de retard', () => {
    const l = pastillesAction(ligne({ echeanceType: 'datee', echeanceDate: '2020-01-01T08:00:00.000Z', alarme: true }), F);
    expect(l.length).toBeLessThanOrEqual(2);
    expect(l.map((x) => x.libelle).join(' ')).not.toMatch(/retard/i);
  });
  it('natures, à revoir, privé', () => {
    expect([NATURES.action, NATURES.pensee, NATURES.info, A_REVOIR].map((p) => p.libelle)).toEqual(['Action', 'Pensée', 'Info', 'À revoir']);
    expect(PRIVE).toMatchObject({ libelle: 'Privé', icone: 'cadenas' });
  });
});
