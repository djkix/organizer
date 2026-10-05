import { borner, DELAI_VALKEY_MS, type ClientValkey } from '../auth/empreintes/defis.js';

/** Le temps de l'écran de consentement de Google, marge comprise. */
export const DUREE_ETAT_OAUTH_MS = 10 * 60_000;

export interface MagasinEtats {
  poser(etat: string, valeur: string): Promise<void>;
  /** Lit et efface d'un coup : un état ne sert qu'une fois. Expiré ou inconnu : null. */
  prendre(etat: string): Promise<string | null>;
}

const cle = (etat: string): string => `organizer:agenda:etat:${etat}`;

export class MagasinEtatsValkey implements MagasinEtats {
  constructor(private readonly valkey: ClientValkey, private readonly delaiMs = DELAI_VALKEY_MS) {}

  async poser(etat: string, valeur: string): Promise<void> {
    await borner(this.valkey.set(cle(etat), valeur, 'PX', DUREE_ETAT_OAUTH_MS), this.delaiMs);
  }

  prendre(etat: string): Promise<string | null> {
    return borner(this.valkey.getdel(cle(etat)), this.delaiMs);
  }
}
