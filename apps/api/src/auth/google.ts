import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface ProfilGoogle { sub: string; email: string; emailVerifie: boolean }

export interface VerificateurGoogle {
  /** Profil du jeton d'identité Google, ou `null` pour tout jeton invalide. Ne lève jamais. */
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
      } catch {
        return null;
      }
    },
  };
}

/** Clés publiques de Google, récupérées par le proxy sortant (liste fermée de domaines). */
export function clesGoogle(f: typeof fetch): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { [customFetch]: f });
}
