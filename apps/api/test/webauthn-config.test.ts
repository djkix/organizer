import { afterEach, describe, expect, it, vi } from 'vitest';
import { lireConfigWebauthn } from '../src/auth/empreintes/config.js';
import { lireConfigApi } from '../src/config.js';

afterEach(() => { vi.unstubAllEnvs(); });

const PROD = { NODE_ENV: 'production', WEBAUTHN_RP_ID: 'organizer.djkix.ovh' };

describe('lireConfigWebauthn', () => {
  it('hors production : localhost et le serveur de dev', () => {
    expect(lireConfigWebauthn({ NODE_ENV: 'test' })).toEqual({ rpId: 'localhost', origine: 'http://localhost:5173', nomRp: 'Organizer' });
  });

  it('en production, domaine et origine sont obligatoires', () => {
    expect(() => lireConfigWebauthn({ NODE_ENV: 'production' })).toThrow('WEBAUTHN_RP_ID et WEBAUTHN_ORIGIN obligatoires en production');
  });

  it('en production : le domaine de la PWA, en https', () => {
    expect(lireConfigWebauthn({ ...PROD, WEBAUTHN_ORIGIN: 'https://organizer.djkix.ovh' }))
      .toEqual({ rpId: 'organizer.djkix.ovh', origine: 'https://organizer.djkix.ovh', nomRp: 'Organizer' });
  });

  it.each([
    ['https://organizer.djkix.ovh/', 'origine seule'],
    ['https://autre.djkix.ovh', 'ne correspond pas'],
    ['http://organizer.djkix.ovh', 'https'],
    ['pas une adresse', 'illisible'],
  ])('refuse l\'origine %s', (origine, motif) => {
    expect(() => lireConfigWebauthn({ ...PROD, WEBAUTHN_ORIGIN: origine })).toThrow(motif);
  });

  it('la configuration de l\'API la porte', () => {
    vi.stubEnv('TELEGRAM_MODE', 'polling');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '0:test');
    vi.stubEnv('AUDIO_STORAGE_PATH', './data/audio');
    expect(lireConfigApi().webauthn.rpId).toBe('localhost');
  });
});
