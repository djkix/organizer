import { exigerVar, lireVar } from '@organizer/shared';

export interface ConfigGoogle { clientId: string; clientSecret: string; redirectUri: string; baseOauth: string; baseCalendrier: string }
export interface ConfigScheduler { redisUrl: string; google: ConfigGoogle; cle: Buffer }

/**
 * Hors production, sans GOOGLE_CLIENT_ID : null, le scheduler s'arrête proprement (pnpm dev sans Google).
 * En production : tout est exigé. Les bases Google ne changent que pour les tests (faux serveur).
 */
export function lireConfigScheduler(env: NodeJS.ProcessEnv = process.env): ConfigScheduler | null {
  const production = env.NODE_ENV === 'production';
  const clientId = lireVar('GOOGLE_CLIENT_ID', env);
  if (!clientId && !production) return null;
  const redisUrl = exigerVar('REDIS_URL', env);
  const id = exigerVar('GOOGLE_CLIENT_ID', env);
  const redirectUri = exigerVar('GOOGLE_REDIRECT_URI', env);
  if (production && !redirectUri.startsWith('https://')) throw new Error('GOOGLE_REDIRECT_URI doit commencer par https:// en production');
  const cle = Buffer.from(exigerVar('AGENDA_CLE', env), 'base64');
  if (cle.length !== 32) throw new Error('AGENDA_CLE doit faire 32 octets : openssl rand -base64 32');
  return {
    redisUrl,
    google: {
      clientId: id,
      clientSecret: exigerVar('GOOGLE_CLIENT_SECRET', env),
      redirectUri,
      baseOauth: lireVar('GOOGLE_OAUTH_BASE', env) ?? 'https://oauth2.googleapis.com',
      baseCalendrier: lireVar('GOOGLE_CALENDAR_BASE', env) ?? 'https://www.googleapis.com/calendar/v3',
    },
    cle,
  };
}
