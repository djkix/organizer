import { PORTEE_AGENDA } from '@organizer/shared';
import { z } from 'zod';
import type { ConfigGoogle } from '../configuration.js';
import { ClientRefuse, ErreurGoogle, OctroiInvalide, raisonDe } from './erreurs.js';

export { PORTEE_AGENDA };
const DELAI_MS = 15_000;

const reponseJeton = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(''),
});

export interface JetonsObtenus { acces: string; expireDansS: number; rafraichissement: string | null; portees: string[] }

/** Serveur OAuth de Google (oauth2.googleapis.com). Aucun jeton n'est journalisé ni mis dans un message d'erreur. */
export class ClientOAuth {
  constructor(private readonly c: ConfigGoogle, private readonly f: typeof fetch) {}

  private poster(chemin: string, champs: Record<string, string>): Promise<Response> {
    return this.f(`${this.c.baseOauth}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(champs).toString(),
      signal: AbortSignal.timeout(DELAI_MS),
    });
  }

  private async lireJetons(r: Response): Promise<JetonsObtenus> {
    if (!r.ok) {
      const raison = await raisonDe(r);
      if (raison === 'invalid_grant') throw new OctroiInvalide(r.status, raison);
      if (raison === 'invalid_client' || raison === 'unauthorized_client') throw new ClientRefuse(r.status, raison);
      throw new ErreurGoogle(r.status, raison);
    }
    const j = reponseJeton.parse(await r.json());
    return { acces: j.access_token, expireDansS: j.expires_in, rafraichissement: j.refresh_token ?? null, portees: j.scope.split(' ').filter(Boolean) };
  }

  async echanger(code: string, verificateur: string): Promise<JetonsObtenus> {
    return this.lireJetons(await this.poster('/token', {
      grant_type: 'authorization_code', code, code_verifier: verificateur,
      client_id: this.c.clientId, client_secret: this.c.clientSecret, redirect_uri: this.c.redirectUri,
    }));
  }

  async rafraichir(rafraichissement: string): Promise<{ acces: string; expireDansS: number }> {
    const j = await this.lireJetons(await this.poster('/token', {
      grant_type: 'refresh_token', refresh_token: rafraichissement, client_id: this.c.clientId, client_secret: this.c.clientSecret,
    }));
    return { acces: j.acces, expireDansS: j.expireDansS };
  }

  /** Révoque l'autorisation entière de ce compte. Un jeton déjà mort (400) compte comme révoqué. */
  async revoquer(jeton: string): Promise<void> {
    const r = await this.poster('/revoke', { token: jeton });
    await r.body?.cancel();
    if (r.ok || r.status === 400) return;
    throw new ErreurGoogle(r.status, null);
  }
}
