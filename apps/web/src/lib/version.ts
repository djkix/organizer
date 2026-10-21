/** Ligne discrète des versions : « v1.2.0 », puis « · serveur v1.2.1 » seulement si le serveur diffère. */
export function libelleVersion(pwa: string, serveur: string | null): string {
  const v = (x: string): string => (/^\d/.test(x) ? `v${x}` : x);
  return serveur && serveur !== pwa ? `${v(pwa)} · serveur ${v(serveur)}` : v(pwa);
}

/** Un numéro publié, « 1.2.0 » : en développement, « dev » ou une étiquette d'essai n'en est pas un. */
const publiee = (v: string): boolean => /^\d+\.\d+\.\d+$/.test(v);

/**
 * Le serveur annonce-t-il une autre version que la coquille chargée ? Deux numéros publiés seulement :
 * sans ce garde-fou, le bandeau resterait affiché en permanence en développement.
 */
export function ecartVersion(pwa: string, serveur: string | null): boolean {
  return serveur !== null && publiee(pwa) && publiee(serveur) && pwa !== serveur;
}
