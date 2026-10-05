import { describe, expect, it } from 'vitest';
import { contenuEvenement, empreinteContenu, idEvenement, type ActionPourAgenda } from '../src/agenda/contenu.js';

const action = (plus: Partial<ActionPourAgenda> = {}): ActionPourAgenda => ({
  itemId: '0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', texte: 'dentiste pour la petite', nature: 'action', prive: false,
  archiveLe: null, echeanceType: 'datee', echeanceDate: new Date('2026-10-14T08:00:00Z'), faitLe: null, alarme: false,
  fuseau: 'Europe/Paris', ...plus,
});

describe('contenuEvenement', () => {
  it('rendez-vous daté : titre court, 30 minutes, fuseau de Paris, aucun rappel, aucune description', () => {
    const c = contenuEvenement(action())!;
    expect(c).toEqual({
      summary: 'dentiste pour la petite',
      start: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-10-14T10:30:00+02:00', timeZone: 'Europe/Paris' },
      reminders: { useDefault: false, overrides: [] },
    });
    expect(Object.keys(c)).not.toContain('description');
  });

  it('alarme demandée : un rappel 10 minutes avant, rien d\'autre', () => {
    expect(contenuEvenement(action({ alarme: true }))!.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
  });

  it('changements d\'heure : décalage d\'hiver le 25 octobre, d\'été le 28 mars', () => {
    expect(contenuEvenement(action({ echeanceDate: new Date('2026-10-25T09:00:00Z') }))!.start.dateTime).toBe('2026-10-25T10:00:00+01:00');
    expect(contenuEvenement(action({ echeanceDate: new Date('2027-03-28T08:00:00Z') }))!.start.dateTime).toBe('2027-03-28T10:00:00+02:00');
  });

  it('passage à l\'heure d\'été : 01:45+01:00, fin à 03:15+02:00', () => {
    const c = contenuEvenement(action({ echeanceDate: new Date('2027-03-28T00:45:00Z') }))!;
    expect(c.start.dateTime).toBe('2027-03-28T01:45:00+01:00');
    expect(c.end.dateTime).toBe('2027-03-28T03:15:00+02:00');
  });

  it('02:45 la nuit du passage à l\'heure d\'hiver : 30 minutes réelles, fin à 02:15 en heure d\'hiver', () => {
    const c = contenuEvenement(action({ echeanceDate: new Date('2026-10-25T00:45:00Z') }))!;
    expect(c.start.dateTime).toBe('2026-10-25T02:45:00+02:00');
    expect(c.end.dateTime).toBe('2026-10-25T02:15:00+01:00');
    expect(Date.parse(c.end.dateTime) - Date.parse(c.start.dateTime)).toBe(30 * 60_000);
  });

  it.each([
    ['une pensée', { nature: 'pensee' }],
    ['une capture privée', { prive: true }],
    ['une action faite', { faitLe: new Date() }],
    ['un item archivé', { archiveLe: new Date() }],
    ['un jour sans heure', { echeanceType: 'jour' }],
    ['une fenêtre', { echeanceType: 'fenetre' }],
    ['un daté sans date', { echeanceDate: null }],
  ])('rien pour %s', (_cas, plus) => {
    expect(contenuEvenement(action(plus as Partial<ActionPourAgenda>))).toBeNull();
  });
});

describe('empreinteContenu et idEvenement', () => {
  it('l\'empreinte change avec l\'alarme, l\'heure ou le texte, pas sans raison', () => {
    const e = empreinteContenu(contenuEvenement(action())!);
    expect(e).toMatch(/^[0-9a-f]{32}$/);
    expect(empreinteContenu(contenuEvenement(action())!)).toBe(e);
    expect(empreinteContenu(contenuEvenement(action({ alarme: true }))!)).not.toBe(e);
    expect(empreinteContenu(contenuEvenement(action({ texte: 'dentiste' }))!)).not.toBe(e);
  });

  it('identifiant tiré de l\'item, caractères admis par Google, génération en suffixe', () => {
    expect(idEvenement('0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', 0)).toBe('0f8e2c1a1b2c4d5e8f90a1b2c3d4e5f6');
    expect(idEvenement('0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', 2)).toBe('0f8e2c1a1b2c4d5e8f90a1b2c3d4e5f6g2');
    expect(idEvenement('0f8e2c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6', 12)).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(() => idEvenement('pas-un-uuid', 0)).toThrow();
  });
});
