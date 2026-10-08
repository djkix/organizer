/** Effacer en deux temps : la ligne quitte la liste tout de suite, la requête ne part qu'au bout du délai. */
export const DELAI_EFFACEMENT_MS = 5_000;

export interface EtatEffacement {
  /** L'effacement que « Annuler » peut encore retenir. */
  enAttente: string | null;
}

export interface DepsEffaceur {
  /** Envoi réel ; l'appelant le met dans sa file d'écritures. */
  effacer(itemId: string): Promise<void>;
  surChangement(etat: EtatEffacement): void;
  /** Refusé ou coupé : la ligne revient. */
  surEchec(itemId: string): void;
}

export interface Effaceur {
  /** Fait partir l'effacement précédent tout de suite, puis attend le délai pour celui-ci. */
  planifier(itemId: string): void;
  /** Retient l'effacement en attente, sans aucune requête ; rend son id. */
  annuler(): string | null;
  /** Envoie maintenant l'effacement en attente (l'écran se ferme). */
  vider(): void;
}

export function creerEffaceur(d: DepsEffaceur, delaiMs = DELAI_EFFACEMENT_MS): Effaceur {
  let enAttente: string | null = null;
  let minuterie: ReturnType<typeof setTimeout> | undefined;

  const publier = (id: string | null): void => {
    enAttente = id;
    d.surChangement({ enAttente: id });
  };
  const envoyer = (id: string): void => {
    d.effacer(id).catch(() => d.surEchec(id));
  };
  const partir = (): void => {
    clearTimeout(minuterie);
    const id = enAttente;
    if (id === null) return;
    publier(null);
    envoyer(id);
  };

  return {
    planifier(itemId) {
      if (enAttente === itemId) return;
      partir();
      publier(itemId);
      minuterie = setTimeout(partir, delaiMs);
    },
    annuler() {
      clearTimeout(minuterie);
      const id = enAttente;
      if (id !== null) publier(null);
      return id;
    },
    vider: partir,
  };
}
