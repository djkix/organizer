import type {
  CorpsConnexion, CorpsCorrection, CorpsEtiquette, JourPrive, ReponseErreur,
  VueARevoir, VueAujourdhui, VueHorizons, VueSemaine,
} from '@organizer/shared/api';
import { MESSAGES } from './messages.js';

export class ErreurApi extends Error {
  override name = 'ErreurApi';
  constructor(readonly statut: number, message: string) {
    super(message);
  }
}

export class HorsLigne extends Error {
  override name = 'HorsLigne';
  constructor() {
    super(MESSAGES.horsLigne);
  }
}

export interface ClientApi {
  connecter(c: CorpsConnexion): Promise<void>;
  deconnecter(): Promise<void>;
  moi(): Promise<{ nom: string }>;
  aujourdhui(): Promise<VueAujourdhui>;
  semaine(): Promise<VueSemaine>;
  horizons(): Promise<VueHorizons>;
  aRevoir(): Promise<VueARevoir>;
  cocher(itemId: string): Promise<void>;
  decocher(itemId: string): Promise<void>;
  corriger(itemId: string, c: CorpsCorrection): Promise<void>;
  privees(mois: string): Promise<JourPrive[]>;
  etiqueter(captureId: string, etiquette: string | null): Promise<void>;
}

export interface OptionsClient {
  fetch?: typeof fetch;
  /** Appelé sur un 401, sauf pour connecter, deconnecter et moi. */
  surNonConnecte?: () => void;
}

export const urlAudio = (captureId: string): string => `/api/captures/${encodeURIComponent(captureId)}/audio`;

async function messageDe(r: Response): Promise<string> {
  try {
    const corps = (await r.json()) as Partial<ReponseErreur>;
    if (typeof corps.message === 'string' && corps.message.length > 0) return corps.message;
  } catch {
    // Corps absent ou illisible : message par défaut.
  }
  return r.status === 429 ? MESSAGES.tropDeRequetes : MESSAGES.serveurIndisponible;
}

export function creerClientApi(o: OptionsClient = {}): ClientApi {
  const f: typeof fetch = o.fetch ?? ((entree, init) => fetch(entree, init));

  async function appeler(methode: string, chemin: string, corps?: unknown, signaler = true): Promise<Response> {
    let r: Response;
    try {
      r = await f(chemin, {
        method: methode,
        credentials: 'same-origin',
        headers: corps === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
    } catch {
      throw new HorsLigne();
    }
    if (r.ok) return r;
    if (r.status === 401 && signaler) o.surNonConnecte?.();
    throw new ErreurApi(r.status, await messageDe(r));
  }

  const json = async <T>(r: Promise<Response>): Promise<T> => (await r).json() as Promise<T>;
  const sansCorps = async (r: Promise<Response>): Promise<void> => {
    await r;
  };
  const id = encodeURIComponent;

  return {
    connecter: (c) => sansCorps(appeler('POST', '/api/session', c, false)),
    deconnecter: () => sansCorps(appeler('DELETE', '/api/session', undefined, false)),
    moi: () => json(appeler('GET', '/api/session/moi', undefined, false)),
    aujourdhui: () => json(appeler('GET', '/api/vues/aujourdhui')),
    semaine: () => json(appeler('GET', '/api/vues/semaine')),
    horizons: () => json(appeler('GET', '/api/vues/horizons')),
    aRevoir: () => json(appeler('GET', '/api/vues/a-revoir')),
    cocher: (itemId) => sansCorps(appeler('POST', `/api/items/${id(itemId)}/fait`)),
    decocher: (itemId) => sansCorps(appeler('DELETE', `/api/items/${id(itemId)}/fait`)),
    corriger: (itemId, c) => sansCorps(appeler('PATCH', `/api/items/${id(itemId)}`, c)),
    privees: (mois) => json(appeler('GET', `/api/captures/privees?mois=${id(mois)}`)),
    etiqueter: (captureId, etiquette) =>
      sansCorps(appeler('PATCH', `/api/captures/privees/${id(captureId)}`, { etiquette } satisfies CorpsEtiquette)),
  };
}
