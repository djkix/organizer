import type { ResumeEmpreinte } from '@organizer/shared/api';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { ErreurApi, HorsLigne, type ClientApi } from './api.js';
import { MESSAGES } from './messages.js';

/** Clé de stockage : identifiant WebAuthn (public) de la clé de ce téléphone. Rien de personnel. */
export const CLE_MEMO = 'organizer.empreinte';

/**
 * Mémo « une clé est présente sur ce téléphone, identifiant inconnu » : posé quand l'activation répond
 * « déjà active » sans qu'on connaisse la clé (PWA réinstallée, clé synchronisée). Jamais un identifiant WebAuthn
 * (base64url, sans « ? ») ; la première connexion réussie le remplace par le vrai.
 */
export const CLE_INCONNUE = '?';

/** Les deux invites du téléphone. Injectées : les tests n'ont pas de navigateur. */
export interface Ceremonies {
  disponible(): boolean;
  creer(options: PublicKeyCredentialCreationOptionsJSON): Promise<RegistrationResponseJSON>;
  obtenir(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>;
}

/** Ce téléphone a-t-il une clé ? Sans réponse fiable (stockage absent ou bloqué) : non, le mot de passe suffit. */
export interface Memo {
  lire(): string | null;
  poser(identifiant: string): void;
  effacer(): void;
}

type Stockage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function memoLocal(stockage: () => Stockage | undefined = () => globalThis.localStorage): Memo {
  const essayer = <T>(f: (s: Stockage) => T, defaut: T): T => {
    try {
      const s = stockage();
      return s ? f(s) : defaut;
    } catch {
      return defaut;
    }
  };
  return {
    lire: () => essayer((s) => s.getItem(CLE_MEMO), null),
    poser: (identifiant) => essayer((s) => s.setItem(CLE_MEMO, identifiant), undefined),
    effacer: () => essayer((s) => s.removeItem(CLE_MEMO), undefined),
  };
}

export type Issue = { ok: true } | { ok: false; message: string };

const nomErreur = (err: unknown): string =>
  typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';

export type Contexte = 'connexion' | 'activation';

/** Message calme pour tout échec d'empreinte. Seuls 401 et 429 portent un message de l'API ; 400 et 409 se lisent selon le contexte. */
export function messageEmpreinte(err: unknown, contexte: Contexte): string {
  if (err instanceof HorsLigne) return MESSAGES.horsLigne;
  if (err instanceof ErreurApi) {
    if (err.statut === 401 || err.statut === 429) return err.message;
    if (err.statut === 503) return MESSAGES.empreinteServeurIndisponible;
    if (err.statut === 409 && contexte === 'activation') return MESSAGES.empreintesTrop;
    if (err.statut === 400) return contexte === 'activation' ? MESSAGES.empreinteRefusee : MESSAGES.empreinteNonReconnue;
    return MESSAGES.serveurIndisponible;
  }
  const nom = nomErreur(err);
  // NotAllowedError : feuille fermée, délai dépassé, ou aucune clé sur ce téléphone.
  if (nom === 'NotAllowedError' || nom === 'AbortError') return MESSAGES.empreinteAnnulee;
  if (nom === 'InvalidStateError') return MESSAGES.empreinteDejaActive;
  return MESSAGES.empreinteIndisponible;
}

export async function connecterParEmpreinte(
  api: Pick<ClientApi, 'optionsConnexionEmpreinte' | 'connecterParEmpreinte'>, c: Ceremonies, memo: Memo,
): Promise<Issue> {
  try {
    const reponse = await c.obtenir(await api.optionsConnexionEmpreinte());
    await api.connecterParEmpreinte(reponse);
    memo.poser(reponse.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: messageEmpreinte(err, 'connexion') };
  }
}

export async function activerEmpreinte(
  api: Pick<ClientApi, 'optionsInscriptionEmpreinte' | 'inscrireEmpreinte'>, c: Ceremonies, memo: Memo,
): Promise<{ ok: true; cle: ResumeEmpreinte } | { ok: false; message: string }> {
  try {
    const cle = await api.inscrireEmpreinte(await c.creer(await api.optionsInscriptionEmpreinte()));
    memo.poser(cle.identifiant);
    return { ok: true, cle };
  } catch (err) {
    // Une clé de ce compte est déjà sur ce téléphone : la connexion doit pouvoir la proposer.
    if (nomErreur(err) === 'InvalidStateError' && memo.lire() === null) memo.poser(CLE_INCONNUE);
    return { ok: false, message: messageEmpreinte(err, 'activation') };
  }
}

export async function retirerEmpreinte(api: Pick<ClientApi, 'retirerEmpreinte'>, cle: ResumeEmpreinte, memo: Memo): Promise<Issue> {
  try {
    await api.retirerEmpreinte(cle.id);
  } catch (err) {
    // Déjà partie : le but est atteint.
    if (!(err instanceof ErreurApi && err.statut === 404)) {
      return { ok: false, message: err instanceof HorsLigne ? MESSAGES.horsLigne : MESSAGES.retraitRate };
    }
  }
  if (memo.lire() === cle.identifiant) memo.effacer();
  return { ok: true };
}
