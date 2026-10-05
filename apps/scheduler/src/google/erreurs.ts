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
  if (r.status === 403 || r.status === 429) return new GoogleIndisponible(r.status, raison);
  if (r.status === 404 || r.status === 410) return new Introuvable(r.status, raison);
  if (r.status === 409) return new DejaPresent(409, raison);
  return new ErreurGoogle(r.status, raison);
}
