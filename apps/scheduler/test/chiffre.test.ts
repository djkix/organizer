import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chiffrer, dechiffrer } from '../src/chiffre.js';

const cle = randomBytes(32);

describe('chiffrement du jeton de rafraîchissement', () => {
  it('rend le clair avec la même clé et le même compte', () => {
    const c = chiffrer('1//jeton-fabrique', cle, 'compte-1');
    expect(c.startsWith('v1.')).toBe(true);
    expect(c).not.toContain('jeton-fabrique');
    expect(dechiffrer(c, cle, 'compte-1')).toBe('1//jeton-fabrique');
  });

  it('deux chiffrements du même jeton diffèrent (IV aléatoire)', () => {
    expect(chiffrer('x', cle, 'c')).not.toBe(chiffrer('x', cle, 'c'));
  });

  it('refuse un autre compte, une autre clé, un octet modifié, un format inconnu', () => {
    const c = chiffrer('jeton', cle, 'compte-1');
    expect(() => dechiffrer(c, cle, 'compte-2')).toThrow();
    expect(() => dechiffrer(c, randomBytes(32), 'compte-1')).toThrow();
    const brut = Buffer.from(c.slice(3), 'base64url');
    brut[brut.length - 1]! ^= 1;
    expect(() => dechiffrer(`v1.${brut.toString('base64url')}`, cle, 'compte-1')).toThrow();
    expect(() => dechiffrer('v0.abc', cle, 'compte-1')).toThrow('Format de jeton chiffré inconnu');
  });

  it('refuse une charge tronquée ou vide', () => {
    expect(() => dechiffrer('v1.', cle, 'c')).toThrow();
    expect(() => dechiffrer('v1.AAAA', cle, 'c')).toThrow();
  });

  it('exige une clé de 32 octets', () => {
    expect(() => chiffrer('x', randomBytes(16), 'c')).toThrow('32 octets');
    expect(() => dechiffrer('v1.AAAA', randomBytes(16), 'c')).toThrow('32 octets');
  });
});
