export type TypeDefi = 'inscription' | 'connexion';

/** Durée de vie d'un défi : l'invite du téléphone (60 s) plus la marge du réseau. */
export const DUREE_DEFI_MS = 120_000;
/** Au-delà, Valkey est tenu pour muet : l'empreinte échoue vite, le mot de passe reste. */
export const DELAI_VALKEY_MS = 3_000;

export interface MagasinDefis {
  poser(type: TypeDefi, defi: string, valeur: string): Promise<void>;
  /** Lit et efface d'un coup : un défi ne sert qu'une fois. Expiré ou inconnu : null. */
  prendre(type: TypeDefi, defi: string): Promise<string | null>;
}

export class DelaiDepasse extends Error {
  override name = 'DelaiDepasse';
  constructor() {
    super('Valkey ne répond pas.');
  }
}

/** Ce que le magasin demande à ioredis. */
export interface ClientValkey {
  set(cle: string, valeur: string, unite: 'PX', duree: number): Promise<unknown>;
  getdel(cle: string): Promise<string | null>;
}

const cle = (type: TypeDefi, defi: string): string => `organizer:defi:${type}:${defi}`;

export function borner<T>(attente: Promise<T>, ms: number): Promise<T> {
  let minuteur: NodeJS.Timeout | undefined;
  const delai = new Promise<never>((_ok, non) => { minuteur = setTimeout(() => non(new DelaiDepasse()), ms); });
  return Promise.race([attente, delai]).finally(() => clearTimeout(minuteur));
}

/** Défis dans Valkey : expiration native, lecture et effacement atomiques (GETDEL). */
export class MagasinDefisValkey implements MagasinDefis {
  constructor(private readonly valkey: ClientValkey, private readonly delaiMs = DELAI_VALKEY_MS) {}

  async poser(type: TypeDefi, defi: string, valeur: string): Promise<void> {
    await borner(this.valkey.set(cle(type, defi), valeur, 'PX', DUREE_DEFI_MS), this.delaiMs);
  }

  async prendre(type: TypeDefi, defi: string): Promise<string | null> {
    return borner(this.valkey.getdel(cle(type, defi)), this.delaiMs);
  }
}
