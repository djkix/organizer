import { describe, expect, it } from 'vitest';
import { ajouterJours, debutJour, instantLocal, isoLocal, jourLocal, jourSemaine } from '../src/dates.js';

describe('dates', () => {
  it('isoLocal porte le décalage d\'été', () => {
    expect(isoLocal(new Date('2026-10-06T06:12:00Z'), 'Europe/Paris')).toBe('2026-10-06T08:12:00+02:00');
  });
  it('isoLocal porte le décalage d\'hiver', () => {
    expect(isoLocal(new Date('2026-12-01T09:00:00Z'), 'Europe/Paris')).toBe('2026-12-01T10:00:00+01:00');
  });
  it('isoLocal écrit +00:00 pour UTC', () => {
    expect(isoLocal(new Date('2026-12-01T09:00:00Z'), 'UTC')).toBe('2026-12-01T09:00:00+00:00');
  });
  it('jourSemaine en français, dans le fuseau', () => {
    expect(jourSemaine(new Date('2026-10-06T23:30:00Z'), 'Europe/Paris')).toBe('mercredi');
  });
});

describe('jours civils', () => {
  it('jourLocal suit le fuseau, pas UTC', () => {
    expect(jourLocal(new Date('2026-10-06T22:30:00Z'), 'Europe/Paris')).toBe('2026-10-07');
  });
  it('ajouterJours traverse les mois et les années', () => {
    expect(ajouterJours('2026-12-30', 3)).toBe('2027-01-02');
    expect(ajouterJours('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('debutJour donne minuit local, y compris les jours de changement d\'heure', () => {
    expect(debutJour('2026-10-06', 'Europe/Paris').toISOString()).toBe('2026-10-05T22:00:00.000Z');
    expect(debutJour('2026-03-29', 'Europe/Paris').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(debutJour('2026-03-30', 'Europe/Paris').toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(debutJour('2026-10-25', 'Europe/Paris').toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(debutJour('2026-10-26', 'Europe/Paris').toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });
});

describe('instantLocal', () => {
  it('donne l\'instant d\'une heure murale, en été comme en hiver', () => {
    expect(isoLocal(instantLocal('2026-10-06', '10:00', 'Europe/Paris'), 'Europe/Paris')).toBe('2026-10-06T10:00:00+02:00');
    expect(instantLocal('2026-12-01', '10:00', 'Europe/Paris').toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(instantLocal('2026-10-06', '10:00', 'UTC').toISOString()).toBe('2026-10-06T10:00:00.000Z');
  });

  it('heure inexistante au passage à l\'heure d\'été : avancée de la durée du saut', () => {
    expect(isoLocal(instantLocal('2026-03-29', '02:30', 'Europe/Paris'), 'Europe/Paris')).toBe('2026-03-29T03:30:00+02:00');
    expect(instantLocal('2026-03-29', '01:59', 'Europe/Paris').toISOString()).toBe('2026-03-29T00:59:00.000Z');
    expect(instantLocal('2026-03-29', '03:00', 'Europe/Paris').toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('heure répétée au passage à l\'heure d\'hiver : la première occurrence', () => {
    expect(isoLocal(instantLocal('2026-10-25', '02:30', 'Europe/Paris'), 'Europe/Paris')).toBe('2026-10-25T02:30:00+02:00');
    expect(instantLocal('2026-10-25', '03:00', 'Europe/Paris').toISOString()).toBe('2026-10-25T02:00:00.000Z');
  });

  it('refuse un jour ou une heure illisible', () => {
    expect(() => instantLocal('2026-02-30', '10:00', 'Europe/Paris')).toThrow('illisible');
    expect(() => instantLocal('2026-10-06', '24:00', 'Europe/Paris')).toThrow('illisible');
    expect(() => instantLocal('6/10/2026', '10:00', 'Europe/Paris')).toThrow('illisible');
  });
});
