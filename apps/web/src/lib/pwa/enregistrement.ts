/** Les options de registerSW que la PWA utilise (vite-plugin-pwa). */
export interface OptionsSW {
  immediate?: boolean;
  onNeedReload?: () => void;
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string, enregistrement: ServiceWorkerRegistration | undefined) => void;
}

/** Ce que registerSW rend : active la version en attente. Seule, elle ne recharge pas la page. */
export type ActiverSW = (recharger?: boolean) => Promise<void>;
export type Enregistreur = (o: OptionsSW) => ActiverSW;

export interface SuiviSW {
  /** Une nouvelle coquille est téléchargée et attend d'être activée. */
  surEnAttente: () => void;
  /** Le service worker est enregistré : voici de quoi relancer une vérification. */
  surEnregistre: (verifier: () => void) => void;
}

/**
 * Enregistre le service worker sans jamais recharger la page : une mise à jour s'applique quand L
 * l'accepte, jamais en plein enregistrement. Par construction, pas par convention : onNeedReload
 * remplace le rechargement par défaut du plugin.
 */
export function enregistrerSW(enregistrer: Enregistreur, suivi: SuiviSW): ActiverSW {
  return enregistrer({
    immediate: true,
    onNeedReload: () => undefined,
    onNeedRefresh: suivi.surEnAttente,
    onRegisteredSW: (_url, e) => {
      if (e) suivi.surEnregistre(() => void e.update().catch(() => undefined));
    },
  });
}
