import { join } from 'node:path';
import { RACINE_DEPOT } from '@organizer/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lireConfigApi } from '../src/config.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('lireConfigApi', () => {
  it('résout AUDIO_STORAGE_PATH relatif depuis la racine du dépôt', () => {
    vi.stubEnv('TELEGRAM_MODE', 'polling');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '0:test');
    vi.stubEnv('AUDIO_STORAGE_PATH', './data/audio');
    expect(lireConfigApi().audioRacine).toBe(join(RACINE_DEPOT, 'data/audio'));
  });

  it('en production, refuse un AUDIO_STORAGE_PATH relatif', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TELEGRAM_MODE', 'polling');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '0:test');
    vi.stubEnv('AUDIO_STORAGE_PATH', './data/audio');
    expect(() => lireConfigApi()).toThrow('AUDIO_STORAGE_PATH doit être un chemin absolu en production');
  });
});
