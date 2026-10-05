/** Ligne discrète des versions : « v1.2.0 », puis « · serveur v1.2.1 » seulement si le serveur diffère. */
export function libelleVersion(pwa: string, serveur: string | null): string {
  const v = (x: string): string => (/^\d/.test(x) ? `v${x}` : x);
  return serveur && serveur !== pwa ? `${v(pwa)} · serveur ${v(serveur)}` : v(pwa);
}
