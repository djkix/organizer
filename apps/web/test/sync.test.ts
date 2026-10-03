import { describe, expect, it, vi } from 'vitest';
import type { BilanVidage } from '../src/lib/prive/file.js';
import { surSync } from '../src/lib/pwa/sync.js';

const bilan = (b: Partial<BilanVidage>): BilanVidage => ({ livrees: 0, restantes: 0, refusees: 0, nonConnecte: false, horsLigne: false, ...b });

describe('surSync', () => {
  it('ignore les autres étiquettes', () => {
    const vider = vi.fn(async () => bilan({}));
    expect(surSync('autre', vider)).toBeNull();
    expect(vider).not.toHaveBeenCalled();
  });

  it('vide la file et réussit quand tout est livré', async () => {
    await expect(surSync('organizer-prive', async () => bilan({ livrees: 2 }))).resolves.toBeUndefined();
  });

  it('échoue s\'il reste des captures faute de réseau : le navigateur réessaiera', async () => {
    await expect(surSync('organizer-prive', async () => bilan({ restantes: 1, horsLigne: true }))).rejects.toThrow();
  });

  it('réussit sans session : la prochaine ouverture s\'en charge, sans boucle d\'essais', async () => {
    await expect(surSync('organizer-prive', async () => bilan({ restantes: 1, nonConnecte: true }))).resolves.toBeUndefined();
  });

  it('réussit si seules des captures refusées restent : aucun essai automatique ne les reprendra', async () => {
    await expect(surSync('organizer-prive', async () => bilan({ refusees: 2 }))).resolves.toBeUndefined();
  });

  it('un échec du vidage lui-même fait réessayer le navigateur', async () => {
    await expect(surSync('organizer-prive', async () => { throw new Error('base'); })).rejects.toThrow();
  });
});
