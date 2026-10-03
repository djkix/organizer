// Types propres à l'application. Ceux du service worker arrivent avec la tâche 8.
declare global {
  namespace App {
    /** État d'historique du détail ouvert (navigation superficielle). */
    interface PageState { detail?: string }
  }
}
export {};
