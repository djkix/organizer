import type { LigneAction } from '@organizer/shared/api';
import { describe, expect, it } from 'vitest';
import {
  avantLe, chrono, duree, echeanceEnClair, heureLocale, jourEnClair, libelleBorne, libelleJour,
  libelleMois, metaLigne, moisVoisin, momentEnClair, titreDuJour,
} from '../src/lib/format.js';

const F = 'Europe/Paris';
const ligne = (plus: Partial<LigneAction>): LigneAction => ({
  itemId: 'i', captureId: 'c', texte: 'Rappeler le garage', theme: null, echeanceType: null, echeanceExpr: null,
  echeanceDate: null, fenetreFin: null, alarme: false, aAudio: false, ...plus,
});

describe('jours', () => {
  it('jourEnClair et titreDuJour, avec le 1er du mois', () => {
    expect(jourEnClair('2026-10-06')).toBe('mardi 6 octobre');
    expect(jourEnClair('2026-11-01')).toBe('dimanche 1er novembre');
    expect(titreDuJour('2026-10-06')).toBe('Mardi 6 octobre');
  });

  it('libelleJour : Aujourd\'hui, Demain, Hier, sinon le jour en clair', () => {
    expect(libelleJour('2026-10-06', '2026-10-06')).toBe("Aujourd'hui");
    expect(libelleJour('2026-10-07', '2026-10-06')).toBe('Demain');
    expect(libelleJour('2026-10-05', '2026-10-06')).toBe('Hier');
    expect(libelleJour('2026-10-08', '2026-10-06')).toBe('Jeudi 8 octobre');
  });

  it('heureLocale suit le fuseau et l\'heure d\'hiver', () => {
    expect(heureLocale('2026-10-06T08:00:00.000Z', F)).toBe('10:00');
    expect(heureLocale('2026-12-01T09:00:00.000Z', F)).toBe('10:00');
  });

  it('momentEnClair', () => {
    expect(momentEnClair('2026-10-06T06:12:00.000Z', F)).toBe('Mardi 6 octobre, 08:12');
  });
});

describe('échéances', () => {
  it('avantLe lit le jour civil de la borne', () => {
    expect(avantLe('2026-10-24T22:00:00.000Z', F)).toBe('avant le 25 octobre');
  });

  it('metaLigne : l\'heure d\'une action datée, la borne d\'une fenêtre, sinon l\'expression', () => {
    expect(metaLigne(ligne({ echeanceType: 'datee', echeanceDate: '2026-10-06T08:00:00.000Z' }), F)).toBe('10:00');
    expect(metaLigne(ligne({ echeanceType: 'fenetre', fenetreFin: '2026-10-24T22:00:00.000Z' }), F)).toBe('avant le 25 octobre');
    expect(metaLigne(ligne({ echeanceType: 'fenetre', fenetreFin: '2026-12-24T23:00:00.000Z', echeanceExpr: 'avant Noël' }), F)).toBe('avant Noël');
    expect(metaLigne(ligne({ echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' }), F)).toBe('');
  });

  it('metaLigne ne parle jamais de retard, même pour une heure passée', () => {
    expect(metaLigne(ligne({ echeanceType: 'datee', echeanceDate: '2020-01-01T08:00:00.000Z' }), F)).toBe('09:00');
  });

  it('libelleBorne : l\'expression du modèle, sinon la date, avec une majuscule', () => {
    expect(libelleBorne('2026-12-24T23:00:00.000Z', 'avant Noël', F)).toBe('Avant Noël');
    expect(libelleBorne('2026-10-24T22:00:00.000Z', null, F)).toBe('Avant le 25 octobre');
  });

  it('echeanceEnClair pour chaque type', () => {
    expect(echeanceEnClair(ligne({ echeanceType: 'datee', echeanceDate: '2026-10-06T08:00:00.000Z' }), F)).toBe('Mardi 6 octobre, 10:00');
    expect(echeanceEnClair(ligne({ echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' }), F)).toBe('Mardi 6 octobre');
    expect(echeanceEnClair(ligne({ echeanceType: 'fenetre', fenetreFin: '2026-10-24T22:00:00.000Z' }), F)).toBe('Avant le 25 octobre');
    expect(echeanceEnClair(ligne({ echeanceType: 'aucune' }), F)).toBe('Sans date');
    expect(echeanceEnClair(ligne({}), F)).toBe('Sans date');
  });
});

describe('durées et mois', () => {
  it('duree', () => {
    expect(duree(null)).toBe('');
    expect(duree(0)).toBe('0 s');
    expect(duree(26)).toBe('26 s');
    expect(duree(64)).toBe('1 min 04');
    expect(duree(138)).toBe('2 min 18');
  });

  it('chrono', () => {
    expect(chrono(0)).toBe('0:00');
    expect(chrono(65)).toBe('1:05');
  });

  it('libelleMois et moisVoisin traversent les années', () => {
    expect(libelleMois('2026-10')).toBe('Octobre 2026');
    expect(moisVoisin('2026-01', -1)).toBe('2025-12');
    expect(moisVoisin('2026-12', 1)).toBe('2027-01');
  });
});
