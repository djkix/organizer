import { createRemoteJWKSet, customFetch, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface ProfilGoogle { sub: string; email: string; emailVerifie: boolean }

/** Les certificats de Google n'ont pas pu être lus : ce n'est pas le jeton qui est en cause. */
export class GoogleIndisponible extends Error {
  constructor(readonly code: string) {
    super(`certificats Google injoignables (${code})`);
  }
}

// Erreurs de jose nées de la récupération des certificats. ERR_JOSE_GENERIC : réponse autre que 200
// ou illisible (proxy qui refuse, par exemple) ; jose ne l'emploie que là.
const CLES_INJOIGNABLES = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JOSE_GENERIC']);

export interface VerificateurGoogle {
  /** Profil du jeton d'identité Google, ou `null` pour tout jeton invalide. Lève `GoogleIndisponible` si les certificats manquent. */
  verifier(jeton: string): Promise<ProfilGoogle | null>;
}

export function creerVerificateurGoogle(clientId: string, cles: JWTVerifyGetKey): VerificateurGoogle {
  return {
    async verifier(jeton) {
      try {
        const { payload } = await jwtVerify(jeton, cles, {
          issuer: ['https://accounts.google.com', 'accounts.google.com'],
          audience: clientId,
          algorithms: ['RS256'],
        });
        if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !payload.email) return null;
        return { sub: payload.sub, email: payload.email.toLowerCase(), emailVerifie: payload.email_verified === true };
      } catch (err) {
        if (err instanceof errors.JOSEError && !CLES_INJOIGNABLES.has(err.code)) return null;
        throw new GoogleIndisponible(err instanceof errors.JOSEError ? err.code : 'reseau');
      }
    },
  };
}

/** Clés publiques de Google, récupérées par le proxy sortant (liste fermée de domaines). */
export function clesGoogle(f: typeof fetch): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { [customFetch]: f });
}
