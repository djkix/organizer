import { describe, expect, it } from 'vitest';
import { DELAI_ENVOI_PRIVE_MAX_MS, delaiEnvoiPriveMs, TAILLE_MAX_CAPTURE_PRIVEE } from '../src/api.js';

describe('contrat de transport des captures privées', () => {
  it('30 Mio au plus par capture', () => {
    expect(TAILLE_MAX_CAPTURE_PRIVEE).toBe(30 * 1024 * 1024);
  });

  it('le délai d\'envoi suit la taille : 60 s, puis 20 Ko/s', () => {
    expect(delaiEnvoiPriveMs(0)).toBe(60_000);
    expect(delaiEnvoiPriveMs(22_000_000)).toBe(60_000 + 1_100_000);
  });

  it('le délai maximal couvre la plus grosse capture, bien au-delà de 5 minutes', () => {
    expect(DELAI_ENVOI_PRIVE_MAX_MS).toBe(delaiEnvoiPriveMs(TAILLE_MAX_CAPTURE_PRIVEE));
    expect(DELAI_ENVOI_PRIVE_MAX_MS).toBeGreaterThan(25 * 60_000);
  });
});
