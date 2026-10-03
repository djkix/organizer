/** Les options de registerSW que la PWA utilise (vite-plugin-pwa). */
export interface OptionsSW {
  immediate?: boolean;
  onNeedReload?: () => void;
}

/**
 * Enregistre le service worker sans jamais recharger la page : une mise à jour s'applique
 * à la prochaine ouverture, jamais en plein enregistrement. Par construction, pas par convention :
 * onNeedReload remplace le rechargement par défaut du plugin.
 */
export function enregistrerSW(enregistrer: (o: OptionsSW) => unknown): void {
  enregistrer({ immediate: true, onNeedReload: () => undefined });
}
