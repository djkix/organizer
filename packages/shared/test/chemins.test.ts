import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cheminDepuisRacine, RACINE_DEPOT } from '../src/chemins.js';

describe('cheminDepuisRacine', () => {
  it('la racine du dépôt est celle qui contient pnpm-workspace.yaml', () => {
    expect(existsSync(join(RACINE_DEPOT, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('résout un chemin relatif depuis la racine, quel que soit le dossier courant', () => {
    expect(cheminDepuisRacine('./data/audio')).toBe(join(RACINE_DEPOT, 'data/audio'));
    expect(cheminDepuisRacine('prompts')).toBe(join(RACINE_DEPOT, 'prompts'));
  });

  it('laisse un chemin absolu inchangé', () => {
    expect(cheminDepuisRacine('/data/audio')).toBe('/data/audio');
  });
});
