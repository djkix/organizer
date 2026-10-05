import { lireVar } from '@organizer/shared';

export interface ConfigAgendaApi { clientId: string; redirectUri: string; urlAutorisation: string }

/** Le client OAuth (Application Web) de Franck. Hors production sans GOOGLE_CLIENT_ID : Google Agenda indisponible. */
export function lireConfigAgenda(env: NodeJS.ProcessEnv = process.env): ConfigAgendaApi | null {
  const production = env.NODE_ENV === 'production';
  const clientId = lireVar('GOOGLE_CLIENT_ID', env);
  if (!clientId) {
    if (production) throw new Error('Variable manquante : GOOGLE_CLIENT_ID (ou GOOGLE_CLIENT_ID_FILE)');
    return null;
  }
  const redirectUri = lireVar('GOOGLE_REDIRECT_URI', env);
  if (!redirectUri) throw new Error('Variable manquante : GOOGLE_REDIRECT_URI (ou GOOGLE_REDIRECT_URI_FILE)');
  if (production && !redirectUri.startsWith('https://')) throw new Error('GOOGLE_REDIRECT_URI doit commencer par https:// en production');
  return { clientId, redirectUri, urlAutorisation: lireVar('GOOGLE_AUTH_URL', env) ?? 'https://accounts.google.com/o/oauth2/v2/auth' };
}
