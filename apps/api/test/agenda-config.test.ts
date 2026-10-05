import { describe, expect, it } from 'vitest';
import { lireConfigAgenda } from '../src/agenda/config.js';
import { DUREE_ETAT_OAUTH_MS, MagasinEtatsValkey } from '../src/agenda/etats.js';

describe('lireConfigAgenda', () => {
  it('hors production sans client : indisponible ; en production : refus', () => {
    expect(lireConfigAgenda({})).toBeNull();
    expect(() => lireConfigAgenda({ NODE_ENV: 'production' })).toThrow('GOOGLE_CLIENT_ID');
  });
  it('exige l\'adresse de retour, https en production', () => {
    expect(() => lireConfigAgenda({ GOOGLE_CLIENT_ID: 'x' })).toThrow('GOOGLE_REDIRECT_URI');
    expect(() => lireConfigAgenda({ NODE_ENV: 'production', GOOGLE_CLIENT_ID: 'x', GOOGLE_REDIRECT_URI: 'http://a/b' })).toThrow('https://');
    expect(lireConfigAgenda({ GOOGLE_CLIENT_ID: 'x', GOOGLE_REDIRECT_URI: 'https://a/api/agenda/retour' })).toMatchObject({ clientId: 'x', urlAutorisation: 'https://accounts.google.com/o/oauth2/v2/auth' });
  });
});

describe('MagasinEtatsValkey', () => {
  it('pose 10 minutes, prend par GETDEL', async () => {
    const appels: unknown[][] = [];
    const m = new MagasinEtatsValkey({ set: async (...a) => { appels.push(a); return 'OK'; }, getdel: async (c) => `v:${c}` });
    await m.poser('e1', 'v');
    expect(appels).toEqual([['organizer:agenda:etat:e1', 'v', 'PX', DUREE_ETAT_OAUTH_MS]]);
    expect(await m.prendre('e1')).toBe('v:organizer:agenda:etat:e1');
  });
});
