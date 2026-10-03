export const NOM_COOKIE = 'organizer_session';
const ATTRIBUTS = 'Path=/; HttpOnly; Secure; SameSite=Lax';

export function lireCookie(entete: string | undefined, nom: string): string | undefined {
  for (const morceau of (entete ?? '').split(';')) {
    const i = morceau.indexOf('=');
    if (i < 0 || morceau.slice(0, i).trim() !== nom) continue;
    try {
      return decodeURIComponent(morceau.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function cookieSession(jeton: string, expireLe: Date, maintenant: Date): string {
  const maxAge = Math.max(0, Math.floor((expireLe.getTime() - maintenant.getTime()) / 1000));
  return `${NOM_COOKIE}=${jeton}; ${ATTRIBUTS}; Max-Age=${maxAge}`;
}

export const cookieEfface = (): string => `${NOM_COOKIE}=; ${ATTRIBUTS}; Max-Age=0`;
