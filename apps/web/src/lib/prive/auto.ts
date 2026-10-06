/** Paramètre posé par les entrées explicites (boutons d'accueil, raccourcis Android) : l'écran démarre l'enregistrement. */
export const PARAMETRE_AUTO = 'auto';

/** Démarrage automatique seulement si l'entrée l'a demandé ; retour arrière, rechargement et lien nu ne démarrent rien. */
export function demarrageAuto(url: URL): boolean {
  return url.searchParams.get(PARAMETRE_AUTO) === '1';
}

/** Adresse sans le paramètre, pour que retour ou rechargement ne relancent pas l'enregistrement. */
export function sansAuto(url: URL): string {
  const u = new URL(url);
  u.searchParams.delete(PARAMETRE_AUTO);
  return u.pathname + u.search + u.hash;
}
