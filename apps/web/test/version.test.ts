import { describe, expect, it } from 'vitest';
import { libelleVersion } from '../src/lib/version.js';

describe('libelleVersion', () => {
  it('une seule version quand le serveur est identique ou inconnu', () => {
    expect(libelleVersion('1.2.0', '1.2.0')).toBe('v1.2.0');
    expect(libelleVersion('1.2.0', null)).toBe('v1.2.0');
  });
  it('ajoute le serveur quand il diffère ; « dev » et « essai » sans v', () => {
    expect(libelleVersion('1.2.0', '1.2.1')).toBe('v1.2.0 · serveur v1.2.1');
    expect(libelleVersion('dev', '1.2.1')).toBe('dev · serveur v1.2.1');
  });
});
