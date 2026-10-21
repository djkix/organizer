/** Revérification des mises à jour, application ouverte. */
export const DELAI_VERIFICATION_MS = 30 * 60_000;
/** Filet de rechargement : sur un simple écart de version, aucun service worker n'attend. */
export const DELAI_RECHARGE_MS = 1_500;

type Cible = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface BranchementMaj {
  /** Relance la vérification du service worker (registration.update()). */
  verifierSW: () => void;
  /** Version annoncée par le serveur ; null hors ligne ou sans session. */
  versionServeur: () => Promise<string | null>;
  surVersion: (v: string | null) => void;
  doc: Cible & { readonly visibilityState: DocumentVisibilityState };
  intervalleMs?: number;
}

/**
 * Revérifie toutes les trente minutes et à chaque retour au premier plan. Une PWA installée ne
 * vérifie d'elle-même qu'à son lancement, et un téléphone ne relance jamais vraiment une
 * application : sans cela, une version publiée en journée n'arriverait qu'au prochain démarrage.
 * Rend la fonction de démontage.
 */
export function suivreMaj(b: BranchementMaj): () => void {
  const verifier = (): void => {
    b.verifierSW();
    // Un échec attend la vérification suivante : jamais de message, c'est une information d'arrière-plan.
    b.versionServeur().then(b.surVersion, () => undefined);
  };
  const auRetour = (): void => {
    if (b.doc.visibilityState === 'visible') verifier();
  };
  const minuteur = setInterval(verifier, b.intervalleMs ?? DELAI_VERIFICATION_MS);
  b.doc.addEventListener('visibilitychange', auRetour);
  return () => {
    clearInterval(minuteur);
    b.doc.removeEventListener('visibilitychange', auRetour);
  };
}

/**
 * Active la version en attente, puis recharge dans tous les cas. Sans ce filet, le bouton ne ferait
 * rien du tout quand le bandeau vient de l'écart de version : il n'y a alors aucun worker en attente.
 */
export function rechargerMaintenant(activer: () => Promise<void>, rechargerPage: () => void, delaiMs = DELAI_RECHARGE_MS): void {
  activer().catch(() => undefined);
  setTimeout(rechargerPage, delaiMs);
}
