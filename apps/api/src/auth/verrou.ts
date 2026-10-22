import { createHash } from 'node:crypto';
import { borner, DELAI_VALKEY_MS } from './empreintes/defis.js';

/** Échecs de mot de passe admis par compte, toutes adresses confondues, avant le verrou. */
export const MAX_ECHECS_COMPTE = 10;
/** Fenêtre fixe ouverte au premier échec : le verrou tombe à sa fin, ou dès une connexion réussie. */
export const FENETRE_VERROU_MS = 15 * 60_000;

/**
 * Verrou par compte, en plus du limiteur par IP : une force brute répartie sur beaucoup d'adresses
 * bute sur le compte visé. Vaut pour tout nom, connu ou non : il ne révèle pas quels comptes existent.
 * L'empreinte (WebAuthn) n'y est pas soumise : un intrus qui verrouille le mot de passe ne bloque pas l'utilisatrice.
 */
export interface VerrouConnexion {
  bloque(nom: string): Promise<boolean>;
  echec(nom: string): Promise<void>;
  reussite(nom: string): Promise<void>;
}

/** Ce que le verrou demande à ioredis. */
export interface ClientValkeyVerrou {
  get(cle: string): Promise<string | null>;
  del(cle: string): Promise<number>;
  eval(script: string, nbCles: number, ...args: (string | number)[]): Promise<unknown>;
}

// INCR et PEXPIRE d'un seul tenant : jamais un compteur sans expiration, donc jamais un verrou sans fin.
const INCREMENTER = "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return n";

// Empreinte du nom : longueur fixe, aucun caractère du nom dans la clé.
const cle = (nom: string): string => `organizer:echecs-connexion:${createHash('sha256').update(nom).digest('hex')}`;

/**
 * Compteurs dans Valkey : expiration native, partagés si l'API tourne un jour en plusieurs processus.
 * Valkey muet ou en erreur : on journalise et on laisse passer, le limiteur par IP reste en place.
 */
export class VerrouConnexionValkey implements VerrouConnexion {
  constructor(
    private readonly valkey: ClientValkeyVerrou,
    private readonly delaiMs = DELAI_VALKEY_MS,
    private readonly journal: (m: string) => void = (m) => console.error(m),
  ) {}

  async bloque(nom: string): Promise<boolean> {
    try {
      return Number(await borner(this.valkey.get(cle(nom)), this.delaiMs)) >= MAX_ECHECS_COMPTE;
    } catch (e) {
      this.journal(`Verrou de connexion indisponible (${(e as Error).name})`);
      return false;
    }
  }

  async echec(nom: string): Promise<void> {
    try {
      await borner(this.valkey.eval(INCREMENTER, 1, cle(nom), FENETRE_VERROU_MS), this.delaiMs);
    } catch (e) {
      this.journal(`Verrou de connexion indisponible (${(e as Error).name})`);
    }
  }

  async reussite(nom: string): Promise<void> {
    try {
      await borner(this.valkey.del(cle(nom)), this.delaiMs);
    } catch (e) {
      this.journal(`Verrou de connexion indisponible (${(e as Error).name})`);
    }
  }
}

/** Même règle en mémoire : tests, et contrôleur instancié sans Valkey. */
export class VerrouConnexionMemoire implements VerrouConnexion {
  private readonly comptes = new Map<string, { echecs: number; fin: number }>();

  constructor(private readonly maintenant: () => number = Date.now) {}

  private lire(nom: string): { echecs: number; fin: number } | undefined {
    const c = this.comptes.get(nom);
    if (c && c.fin <= this.maintenant()) {
      this.comptes.delete(nom);
      return undefined;
    }
    return c;
  }

  async bloque(nom: string): Promise<boolean> {
    return (this.lire(nom)?.echecs ?? 0) >= MAX_ECHECS_COMPTE;
  }

  async echec(nom: string): Promise<void> {
    const c = this.lire(nom) ?? { echecs: 0, fin: this.maintenant() + FENETRE_VERROU_MS };
    c.echecs += 1;
    this.comptes.set(nom, c);
  }

  async reussite(nom: string): Promise<void> {
    this.comptes.delete(nom);
  }
}
