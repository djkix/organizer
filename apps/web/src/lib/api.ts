import type {
  CorpsConnexion, CorpsCorrection, CorpsEtiquette, JourPrive, ReponseAgenda, ReponseConnexionAgenda, ReponseErreur,
  ResumeEmpreinte, VueARevoir, VueAujourdhui, VueHorizons, VueSemaine,
} from '@organizer/shared/api';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/browser';
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
  optionsConnexionEmpreinte(): Promise<PublicKeyCredentialRequestOptionsJSON>;
  connecterParEmpreinte(r: AuthenticationResponseJSON): Promise<void>;
  optionsInscriptionEmpreinte(): Promise<PublicKeyCredentialCreationOptionsJSON>;
  inscrireEmpreinte(r: RegistrationResponseJSON): Promise<ResumeEmpreinte>;
  empreintes(): Promise<ResumeEmpreinte[]>;
  retirerEmpreinte(cleId: string): Promise<void>;
  aujourdhui(): Promise<VueAujourdhui>;
  semaine(): Promise<VueSemaine>;
  horizons(): Promise<VueHorizons>;
  aRevoir(): Promise<VueARevoir>;
  cocher(itemId: string): Promise<void>;
  decocher(itemId: string): Promise<void>;
  corriger(itemId: string, c: CorpsCorrection): Promise<void>;
  privees(mois: string): Promise<JourPrive[]>;
  etiqueter(captureId: string, etiquette: string | null): Promise<void>;
  agenda(): Promise<ReponseAgenda>;
  connecterAgenda(): Promise<ReponseConnexionAgenda>;
  deconnecterAgenda(): Promise<void>;
}

export interface OptionsClient {
  fetch?: typeof fetch;
  /** Appelé sur un 401, sauf pour connecter, deconnecter, moi et la connexion par empreinte. */
  surNonConnecte?: () => void;
}

export const urlAudio = (captureId: string): string => `/api/captures/${encodeURIComponent(captureId)}/audio`;

/** Durée maximale d'un appel : une panne réseau muette ne bloque jamais l'écran. */
export const DELAI_APPEL_MS = 15_000;

/** Seuls 401 et 429 portent un message français connu de l'API ; le reste ne montre jamais le texte du serveur. */
async function messageDe(r: Response): Promise<string> {
  if (r.status === 413) return MESSAGES.enregistrementTropLong;
  if (r.status === 401 || r.status === 429) {
    try {
      const corps = (await r.json()) as Partial<ReponseErreur>;
      if (typeof corps.message === 'string' && corps.message.length > 0) return corps.message;
    } catch {
      // Corps absent ou illisible : message par défaut.
    }
    return r.status === 429 ? MESSAGES.tropDeRequetes : MESSAGES.identifiantsInvalides;
  }
  if (r.status === 400) {
    // Seul refus connu et calme de l'API (alarme sans heure) : montré tel quel ; le reste ne l'est jamais.
    try {
      const corps = (await r.json()) as Partial<ReponseErreur>;
      if (corps.message === MESSAGES.alarmeSansHeure) return corps.message;
    } catch {
      // Corps absent ou illisible : message par défaut.
    }
  }
  return MESSAGES.serveurIndisponible;
}

export function creerClientApi(o: OptionsClient = {}): ClientApi {
  const f: typeof fetch = o.fetch ?? ((entree, init) => fetch(entree, init));

  async function appeler(methode: string, chemin: string, corps?: unknown, signaler = true): Promise<Response> {
    let r: Response;
    const arret = new AbortController();
    const minuteur = setTimeout(() => arret.abort(), DELAI_APPEL_MS);
    try {
      r = await f(chemin, {
        signal: arret.signal,
        method: methode,
        credentials: 'same-origin',
        headers: corps === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
    } catch {
      // Coupure ou délai dépassé : hors ligne, jamais déconnecté.
      throw new HorsLigne();
    } finally {
      clearTimeout(minuteur);
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
    optionsConnexionEmpreinte: () => json(appeler('POST', '/api/session/empreinte/options', undefined, false)),
    connecterParEmpreinte: (r) => sansCorps(appeler('POST', '/api/session/empreinte', r, false)),
    optionsInscriptionEmpreinte: () => json(appeler('POST', '/api/empreintes/options')),
    inscrireEmpreinte: (r) => json(appeler('POST', '/api/empreintes', r)),
    empreintes: () => json(appeler('GET', '/api/empreintes')),
    retirerEmpreinte: (cleId) => sansCorps(appeler('DELETE', `/api/empreintes/${id(cleId)}`)),
    aujourdhui: () => json(appeler('GET', '/api/vues/aujourdhui')),
    semaine: () => json(appeler('GET', '/api/vues/semaine')),
    horizons: () => json(appeler('GET', '/api/vues/horizons')),
    aRevoir: () => json(appeler('GET', '/api/vues/a-revoir')),
    agenda: () => json(appeler('GET', '/api/agenda')),
    connecterAgenda: () => json(appeler('POST', '/api/agenda/connexion')),
    deconnecterAgenda: () => sansCorps(appeler('DELETE', '/api/agenda')),
    cocher: (itemId) => sansCorps(appeler('POST', `/api/items/${id(itemId)}/fait`)),
    decocher: (itemId) => sansCorps(appeler('DELETE', `/api/items/${id(itemId)}/fait`)),
    corriger: (itemId, c) => sansCorps(appeler('PATCH', `/api/items/${id(itemId)}`, c)),
    privees: (mois) => json(appeler('GET', `/api/captures/privees?mois=${id(mois)}`)),
    etiqueter: (captureId, etiquette) =>
      sansCorps(appeler('PATCH', `/api/captures/privees/${id(captureId)}`, { etiquette } satisfies CorpsEtiquette)),
  };
}
