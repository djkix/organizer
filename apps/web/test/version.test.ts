import { describe, expect, it } from 'vitest';
import { ecartVersion, libelleVersion } from '../src/lib/version.js';

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

describe('ecartVersion', () => {
  it('signale un écart entre deux numéros publiés', () => {
    expect(ecartVersion('1.2.0', '1.2.1')).toBe(true);
    expect(ecartVersion('1.2.0', '1.2.0')).toBe(false);
  });
  it('ne signale rien tant que les deux numéros ne sont pas publiés', () => {
    // Sinon le bandeau resterait affiché en permanence en développement et sur une image d'essai.
    expect(ecartVersion('dev', '1.2.1')).toBe(false);
    expect(ecartVersion('1.2.0', 'essai')).toBe(false);
    expect(ecartVersion('1.2.0', null)).toBe(false);
  });
});
