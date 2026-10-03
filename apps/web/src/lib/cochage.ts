import { MESSAGES } from './messages.js';

export const DELAI_ANNULATION_MS = 10_000;

export interface EtatCochage {
  /** Cochés dont l'annulation est close : ils quittent la liste. */
  retires: ReadonlySet<string>;
  /** Le dernier coché, barré, tant que « Annuler » est proposé. */
  enCours: string | null;
  /** Mot court, effacé seul au bout du même délai. Jamais d'alerte. */
  message: string | null;
}

export interface DepsCocheur {
  cocher(itemId: string): Promise<void>;
  decocher(itemId: string): Promise<void>;
  surChangement(etat: EtatCochage): void;
}

export interface Cocheur {
  etat(): EtatCochage;
  /** Écriture optimiste : la ligne est barrée avant la réponse du serveur. */
  cocher(itemId: string): void;
  /** Décoche le dernier coché, après la réponse de son cochage. */
  annuler(): Promise<void>;
  /** Ajoute une écriture (une correction) à la même file : elle part après les cochages en cours. */
  enfiler<T>(travail: () => Promise<T>): Promise<T>;
}

export function creerCocheur(d: DepsCocheur): Cocheur {
  let etat: EtatCochage = { retires: new Set(), enCours: null, message: null };
  let envoi: Promise<boolean> = Promise.resolve(false);
  // Toutes les écritures (cochages et décochages, tous items) passent par cette file :
  // elles atteignent le serveur dans l'ordre des gestes, jamais en parallèle.
  let file: Promise<unknown> = Promise.resolve();
  const enfiler = <T>(travail: () => Promise<T>): Promise<T> => {
    const resultat = file.then(travail);
    file = resultat.then(() => undefined, () => undefined);
    return resultat;
  };
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  let minuterieMessage: ReturnType<typeof setTimeout> | undefined;

  const publier = (modif: Partial<EtatCochage>): void => {
    etat = { ...etat, ...modif };
    d.surChangement(etat);
  };
  const avec = (s: ReadonlySet<string>, id: string): Set<string> => new Set([...s, id]);
  const sans = (s: ReadonlySet<string>, id: string): Set<string> => new Set([...s].filter((x) => x !== id));

  function signaler(message: string): void {
    clearTimeout(minuterieMessage);
    publier({ message });
    minuterieMessage = setTimeout(() => publier({ message: null }), DELAI_ANNULATION_MS);
  }

  function clore(): void {
    clearTimeout(minuterie);
    if (etat.enCours) publier({ retires: avec(etat.retires, etat.enCours), enCours: null });
  }

  return {
    etat: () => etat,
    enfiler,

    cocher(itemId) {
      if (etat.enCours === itemId || etat.retires.has(itemId)) return;
      clore();
      publier({ enCours: itemId });
      minuterie = setTimeout(clore, DELAI_ANNULATION_MS);
      envoi = enfiler(() => d.cocher(itemId)).then(
        () => true,
        () => {
          // Refusé ou coupé : la ligne revient telle quelle.
          if (etat.enCours === itemId) {
            clearTimeout(minuterie);
            publier({ enCours: null });
          } else {
            publier({ retires: sans(etat.retires, itemId) });
          }
          signaler(MESSAGES.cochageRate);
          return false;
        },
      );
    },

    async annuler() {
      const itemId = etat.enCours;
      if (!itemId) return;
      const cochage = envoi;
      clearTimeout(minuterie);
      publier({ enCours: null });
      try {
        // Mis en file tout de suite : un nouveau cochage de la même ligne passera après lui.
        await enfiler(async () => {
          if (!(await cochage)) return;
          await d.decocher(itemId);
        });
      } catch {
        publier({ retires: avec(etat.retires, itemId) });
        signaler(MESSAGES.annulationRatee);
      }
    },
  };
}
