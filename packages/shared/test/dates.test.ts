import { describe, expect, it } from 'vitest';
import { isoLocal, jourSemaine } from '../src/dates.js';

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
