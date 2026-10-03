/// <reference types="vite-plugin-pwa/client" />
// Types propres à l'application.
declare global {
  namespace App {
    /** État d'historique du détail ouvert (navigation superficielle). */
    interface PageState { detail?: string }
  }
}
export {};
