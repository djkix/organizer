/** Erreur HTTP de Google. Le message ne porte que le statut et la raison technique, jamais un corps ni un jeton. */
export class ErreurGoogle extends Error {
  override name = 'ErreurGoogle';
  constructor(readonly statut: number, readonly raison: string | null) {
    super(`Google HTTP ${statut}${raison ? ` (${raison})` : ''}`);
  }
}
export class JetonRefuse extends ErreurGoogle { override name = 'JetonRefuse'; }
export class GoogleIndisponible extends ErreurGoogle { override name = 'GoogleIndisponible'; }
export class Introuvable extends ErreurGoogle { override name = 'Introuvable'; }
export class DejaPresent extends ErreurGoogle { override name = 'DejaPresent'; }
export class OctroiInvalide extends ErreurGoogle { override name = 'OctroiInvalide'; }
export class ClientRefuse extends ErreurGoogle { override name = 'ClientRefuse'; }
/** 403 qui n'est pas une limite de débit (forbidden, insufficientPermissions…) : inutile de réessayer. */
export class GoogleRefuse extends ErreurGoogle { override name = 'GoogleRefuse'; }
/** Autre 4xx (400…) : la requête est mauvaise, la rejouer donnerait la même réponse. */
export class RequeteInvalide extends ErreurGoogle { override name = 'RequeteInvalide'; }

/**
 * Classes à réessayer (panne passagère) : GoogleIndisponible (429, 403 de débit), ErreurGoogle simple (5xx),
 * erreurs réseau et délais dépassés (TypeError, AbortError / TimeoutError, hors de ces classes).
 * Classes à ne pas réessayer : JetonRefuse, Introuvable, DejaPresent, OctroiInvalide, ClientRefuse, GoogleRefuse, RequeteInvalide.
 */
const RAISONS_DE_DEBIT = new Set(['ratelimitexceeded', 'userratelimitexceeded', 'quotaexceeded', 'dailylimitexceeded', 'resource_exhausted']);
export const estRaisonDeDebit = (raison: string | null): boolean => raison !== null && RAISONS_DE_DEBIT.has(raison.toLowerCase());

/** « rateLimitExceeded », « invalid_grant »… ; jamais `message` ni `error_description`, qui peuvent citer une donnée. */
export async function raisonDe(r: Response): Promise<string | null> {
  try {
    const c = (await r.json()) as { error?: string | { errors?: { reason?: unknown }[]; status?: unknown } };
    if (typeof c.error === 'string') return c.error.slice(0, 40);
    const raison = c.error?.errors?.[0]?.reason ?? c.error?.status;
    return typeof raison === 'string' ? raison.slice(0, 40) : null;
  } catch {
    return null;
  }
}

export async function erreurCalendrier(r: Response): Promise<ErreurGoogle> {
  const raison = await raisonDe(r);
  if (r.status === 401) return new JetonRefuse(401, raison);
  if (r.status === 429 || (r.status === 403 && estRaisonDeDebit(raison))) return new GoogleIndisponible(r.status, raison);
  if (r.status === 403) return new GoogleRefuse(403, raison);
  if (r.status === 404 || r.status === 410) return new Introuvable(r.status, raison);
  if (r.status === 409) return new DejaPresent(409, raison);
  if (r.status >= 400 && r.status < 500) return new RequeteInvalide(r.status, raison);
  return new ErreurGoogle(r.status, raison);
}

/** Description journalisable : classe, et statut + raison plafonnée pour les erreurs construites par nos classes. Jamais de corps ni de jeton. */
export function decrire(e: unknown): string {
  if (e instanceof ErreurGoogle) return `${e.name} ${e.statut}${e.raison ? ` (${e.raison})` : ''}`;
  return e instanceof Error ? e.name : 'erreur';
}
