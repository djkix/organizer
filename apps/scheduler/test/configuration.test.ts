import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lireConfigScheduler } from '../src/configuration.js';

const dossier = mkdtempSync(join(tmpdir(), 'sched-'));
const fichier = (nom: string, valeur: string): string => { const f = join(dossier, nom); writeFileSync(f, valeur); return f; };
const CLE = Buffer.alloc(32, 7).toString('base64');
const base = {
  REDIS_URL: 'redis://127.0.0.1:6379', GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET_FILE: fichier('secret', 'secret-essai\n'), AGENDA_CLE_FILE: fichier('cle', `${CLE}\n`),
  GOOGLE_REDIRECT_URI: 'https://organizer.essai/api/agenda/retour',
};

describe('lireConfigScheduler', () => {
  it('lit secrets et adresses ; bases Google par défaut', () => {
    const c = lireConfigScheduler({ ...base, NODE_ENV: 'production' })!;
    expect(c.google).toEqual({
      clientId: 'id.apps.googleusercontent.com', clientSecret: 'secret-essai',
      redirectUri: 'https://organizer.essai/api/agenda/retour',
      baseOauth: 'https://oauth2.googleapis.com', baseCalendrier: 'https://www.googleapis.com/calendar/v3',
    });
    expect(c.cle.length).toBe(32);
  });

  it('hors production, sans client OAuth : rien (le scheduler s\'arrête proprement)', () => {
    expect(lireConfigScheduler({ REDIS_URL: 'redis://x' })).toBeNull();
  });

  it('en production, sans client OAuth : refus explicite', () => {
    expect(() => lireConfigScheduler({ REDIS_URL: 'redis://x', NODE_ENV: 'production' })).toThrow('GOOGLE_CLIENT_ID');
  });

  it('clé de chiffrement de mauvaise taille : refus qui dit comment la générer', () => {
    const env = { ...base, AGENDA_CLE_FILE: fichier('courte', Buffer.alloc(16).toString('base64')) };
    expect(() => lireConfigScheduler(env)).toThrow('openssl rand -base64 32');
  });

  it('adresse de retour en https obligatoire en production', () => {
    expect(() => lireConfigScheduler({ ...base, NODE_ENV: 'production', GOOGLE_REDIRECT_URI: 'http://x/api/agenda/retour' })).toThrow('https');
  });
});
