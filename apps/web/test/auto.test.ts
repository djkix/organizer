import { describe, expect, it } from 'vitest';
import { demarrageAuto, sansAuto } from '../src/lib/prive/auto';

describe('démarrage automatique', () => {
  it('démarre quand l\'entrée le demande', () => {
    expect(demarrageAuto(new URL('https://x.test/enregistrer?auto=1'))).toBe(true);
    expect(demarrageAuto(new URL('https://x.test/prive/enregistrer?auto=1'))).toBe(true);
  });
  it('ne démarre ni sans paramètre (retour, rechargement) ni avec une autre valeur', () => {
    expect(demarrageAuto(new URL('https://x.test/enregistrer'))).toBe(false);
    expect(demarrageAuto(new URL('https://x.test/enregistrer?auto=0'))).toBe(false);
    expect(demarrageAuto(new URL('https://x.test/enregistrer?auto'))).toBe(false);
  });
  it('retire le paramètre et garde le reste', () => {
    expect(sansAuto(new URL('https://x.test/enregistrer?auto=1'))).toBe('/enregistrer');
    expect(sansAuto(new URL('https://x.test/a?b=2&auto=1#h'))).toBe('/a?b=2#h');
  });
});
