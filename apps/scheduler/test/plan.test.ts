import { describe, expect, it } from 'vitest';
import { contenuEvenement, empreinteContenu } from '../src/agenda/contenu.js';
import { planifier } from '../src/agenda/plan.js';

const MAINTENANT = new Date('2026-10-10T08:00:00Z');
const contenu = contenuEvenement({
  itemId: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', texte: 'dentiste', nature: 'action', prive: false, archiveLe: null,
  echeanceType: 'datee', echeanceDate: new Date('2026-10-14T08:00:00Z'), faitLe: null, alarme: false, fuseau: 'Europe/Paris',
})!;
const AG = 'agenda-1@group.calendar.google.com';
const synchro = { evenementId: 'ev', calendrierId: AG, empreinte: empreinteContenu(contenu) };
const vide = { evenementId: null, calendrierId: null, empreinte: null };

describe('planifier', () => {
  it('à jour : rien', () => {
    expect(planifier({ contenu, ...synchro }, AG, MAINTENANT)).toEqual({ type: 'rien' });
  });
  it('jamais écrit : créer', () => {
    expect(planifier({ contenu, ...vide }, AG, MAINTENANT)).toEqual({ type: 'creer' });
  });
  it('contenu changé : remplacer', () => {
    expect(planifier({ contenu, ...synchro, empreinte: 'autre' }, AG, MAINTENANT)).toEqual({ type: 'remplacer' });
  });
  it('plus éligible avec un événement : supprimer ; sans événement : rien', () => {
    expect(planifier({ contenu: null, ...synchro }, AG, MAINTENANT)).toEqual({ type: 'supprimer' });
    expect(planifier({ contenu: null, ...vide }, AG, MAINTENANT)).toEqual({ type: 'rien' });
  });
  it('événement dans un ancien agenda (reconnexion) : créer dans le nouveau', () => {
    expect(planifier({ contenu, ...synchro, calendrierId: 'ancien@group.calendar.google.com' }, AG, MAINTENANT)).toEqual({ type: 'creer' });
  });
  it('rendez-vous commencé depuis plus de 24 h et jamais écrit : rien ; depuis moins : créer', () => {
    expect(planifier({ contenu, ...vide }, AG, new Date('2026-10-15T08:01:00Z'))).toEqual({ type: 'rien' });
    expect(planifier({ contenu, ...vide }, AG, new Date('2026-10-15T07:59:00Z'))).toEqual({ type: 'creer' });
  });
  it('un événement existant suit son action même passée', () => {
    expect(planifier({ contenu, ...synchro, empreinte: 'autre' }, AG, new Date('2027-01-01T00:00:00Z'))).toEqual({ type: 'remplacer' });
  });
});
