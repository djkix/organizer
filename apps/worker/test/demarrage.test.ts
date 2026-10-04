import { describe, expect, it } from 'vitest';
import { CreditEpuise, ErreurFournisseur, FournisseurIndisponible, PalierNonPaye } from '../src/classement/provider.js';
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

  it('journalise le statut HTTP de Gemini, jamais plus', async () => {
    const p = faux([new ErreurFournisseur(503, 'Gemini principal : HTTP 503')]);
    const journal: string[] = [];
    await verifierPalierAuDemarrage(p, async () => {}, (m) => { journal.push(m); });
    expect(journal[0]).toContain('Gemini principal : HTTP 503');
  });

  it('4xx de configuration : ligne distincte à chaque essai, une seule alerte, réarmée au succès', async () => {
    const p = faux([new ErreurFournisseur(400, 'Gemini principal : HTTP 400'), new ErreurFournisseur(404, 'Gemini principal : HTTP 404'), new ErreurFournisseur(400, 'x')]);
    const journal: string[] = [];
    const alertes: string[] = [];
    await verifierPalierAuDemarrage(p, async () => {}, (m) => { journal.push(m); }, async (m) => { alertes.push(m); });
    expect(p.appels()).toBe(4);
    expect(journal).toHaveLength(3);
    expect(journal[0]).toContain('Configuration Gemini refusée (HTTP 400) : vérifier GEMINI_MODEL et GEMINI_THINKING_LEVEL.');
    expect(journal[1]).toContain('(HTTP 404)');
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toContain('Configuration Gemini refusée (HTTP 400)');
  });

  it('503 et indisponibilités : chemin de panne ordinaire, aucune alerte', async () => {
    const p = faux([new ErreurFournisseur(503, 'Gemini principal : HTTP 503'), new FournisseurIndisponible(429, 'Gemini principal : HTTP 429')]);
    const journal: string[] = [];
    const alertes: string[] = [];
    await verifierPalierAuDemarrage(p, async () => {}, (m) => { journal.push(m); }, async (m) => { alertes.push(m); });
    expect(journal.every((l) => l.startsWith('Contrôle du palier impossible'))).toBe(true);
    expect(alertes).toEqual([]);
  });

  it('une alerte en échec ne casse pas la boucle', async () => {
    const p = faux([new ErreurFournisseur(400, 'x')]);
    await verifierPalierAuDemarrage(p, async () => {}, () => {}, async () => { throw new Error('file hors service'); });
    expect(p.appels()).toBe(2);
  });
});
