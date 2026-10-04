import { describe, expect, it } from 'vitest';
import { analyserStatutsIndisponibles } from '../src/configuration.js';

describe('analyserStatutsIndisponibles', () => {
  it('défaut 402,403,429 quand absent', () => {
    expect(analyserStatutsIndisponibles(undefined, () => {})).toEqual([402, 403, 429]);
  });

  it('lit une liste séparée par des virgules, avec espaces', () => {
    expect(analyserStatutsIndisponibles('402, 403,429 ,503', () => {})).toEqual([402, 403, 429, 503]);
  });

  it.each(['abc', '402,,429', '99', '600', '4.5', '402;429'])('valeur invalide %j : défaut et erreur claire', (brut) => {
    const erreurs: string[] = [];
    expect(analyserStatutsIndisponibles(brut, (m) => erreurs.push(m))).toEqual([402, 403, 429]);
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain('GEMINI_STATUTS_INDISPONIBLES');
  });
});
