import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cheminConfigure, cheminDepuisRacine, RACINE_DEPOT } from '../src/chemins.js';

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

describe('cheminConfigure', () => {
  it('en production, refuse un chemin relatif en nommant la variable', () => {
    expect(() => cheminConfigure('PROMPTS_DIR', 'prompts', { NODE_ENV: 'production' }))
      .toThrow('PROMPTS_DIR doit être un chemin absolu en production');
  });

  it('en production, garde un chemin absolu', () => {
    expect(cheminConfigure('AUDIO_STORAGE_PATH', '/data/audio', { NODE_ENV: 'production' })).toBe('/data/audio');
  });

  it('hors production, résout depuis la racine du dépôt', () => {
    expect(cheminConfigure('PROMPTS_DIR', 'prompts', { NODE_ENV: 'test' })).toBe(join(RACINE_DEPOT, 'prompts'));
  });
});
