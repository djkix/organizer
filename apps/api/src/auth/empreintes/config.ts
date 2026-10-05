import { lireVar } from '@organizer/shared';

export interface ConfigWebauthn { rpId: string; origine: string; nomRp: string }

/**
 * Identifiant de RP (domaine de la PWA) et origine exacte attendue dans chaque réponse du téléphone.
 * Une clé d'accès est liée à son identifiant de RP : changer de domaine rend toutes les clés inutilisables.
 */
export function lireConfigWebauthn(env: NodeJS.ProcessEnv = process.env): ConfigWebauthn {
  const rpId = lireVar('WEBAUTHN_RP_ID', env);
  const origine = lireVar('WEBAUTHN_ORIGIN', env);
  if (env.NODE_ENV === 'production' && (!rpId || !origine)) {
    throw new Error('WEBAUTHN_RP_ID et WEBAUTHN_ORIGIN obligatoires en production : domaine de la PWA et https://<domaine>');
  }
  const config = { rpId: rpId ?? 'localhost', origine: origine ?? 'http://localhost:5173', nomRp: 'Organizer' };
  let url: URL;
  try {
    url = new URL(config.origine);
  } catch {
    throw new Error(`WEBAUTHN_ORIGIN illisible : ${config.origine}`);
  }
  if (url.origin !== config.origine) {
    throw new Error(`WEBAUTHN_ORIGIN doit être une origine seule, sans chemin ni barre finale : ${config.origine}`);
  }
  if (url.hostname !== config.rpId) {
    throw new Error(`WEBAUTHN_ORIGIN (${config.origine}) ne correspond pas à WEBAUTHN_RP_ID (${config.rpId})`);
  }
  if (url.protocol !== 'https:' && config.rpId !== 'localhost') {
    throw new Error('WEBAUTHN_ORIGIN doit être en https, sauf sur localhost');
  }
  return config;
}
