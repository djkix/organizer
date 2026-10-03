import { describe, expect, it } from 'vitest';
import { CreditEpuise, PalierNonPaye } from '../src/classement/provider.js';
import { verifierPalierAuDemarrage } from '../src/demarrage.js';

function faux(erreurs: Error[]) {
  let n = 0;
  return {
    appels: () => n,
    async verifierPalierPaye(): Promise<void> {
      const e = erreurs[n++];
      if (e) throw e;
    },
  };
}

describe('verifierPalierAuDemarrage', () => {
  it('réessaie après un crédit épuisé puis réussit', async () => {
    const p = faux([new CreditEpuise('402')]);
    const delais: number[] = [];
    await verifierPalierAuDemarrage(p, async (ms) => { delais.push(ms); }, () => {});
    expect(p.appels()).toBe(2);
    expect(delais).toEqual([30_000]);
  });

  it('double le délai jusqu\'à 900 s', async () => {
    const p = faux(Array.from({ length: 8 }, () => new Error('HTTP 503')));
    const delais: number[] = [];
    await verifierPalierAuDemarrage(p, async (ms) => { delais.push(ms); }, () => {});
    expect(delais).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000]);
  });

  it('propage PalierNonPaye sans réessayer', async () => {
    const p = faux([new PalierNonPaye('gratuit')]);
    const delais: number[] = [];
    await expect(verifierPalierAuDemarrage(p, async (ms) => { delais.push(ms); }, () => {})).rejects.toBeInstanceOf(PalierNonPaye);
    expect(p.appels()).toBe(1);
    expect(delais).toEqual([]);
  });

  it('ne journalise que le nom de l\'erreur', async () => {
    const p = faux([new Error('secret du corps')]);
    const lignes: string[] = [];
    await verifierPalierAuDemarrage(p, async () => {}, (m) => lignes.push(m));
    expect(lignes.join()).not.toContain('secret');
  });
});
