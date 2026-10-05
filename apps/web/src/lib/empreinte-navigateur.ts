import type { Ceremonies } from './empreinte.js';

/**
 * Invites réelles du téléphone (Credential Manager Android). Câblage éprouvé par l'e2e.
 * La bibliothèque ne se charge qu'au toucher du bouton : le bundle initial ne grossit pas.
 */
const bibliotheque = (): Promise<typeof import('@simplewebauthn/browser')> => import('@simplewebauthn/browser');

export const ceremoniesNavigateur: Ceremonies = {
  // Détection sans la bibliothèque : même test (API présente), rien à charger pour afficher l'écran.
  disponible: () => typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.create === 'function',
  creer: async (optionsJSON) => (await bibliotheque()).startRegistration({ optionsJSON }),
  obtenir: async (optionsJSON) => (await bibliotheque()).startAuthentication({ optionsJSON }),
};
