/** Fuseau des dates envoyées à l'API. L'API ne l'expose pas : c'est celui des deux comptes. */
export const FUSEAU = 'Europe/Paris';

export const CHEMINS = {
  accueil: '/',
  connexion: '/connexion',
  prive: '/prive',
  enregistreur: '/prive/enregistrer',
  enregistrer: '/enregistrer',
  reglages: '/reglages',
  aRevoir: '/a-revoir',
} as const;

/** Étiquette Background Sync de la file des captures privées. */
export const ETIQUETTE_SYNC = 'organizer-prive';
