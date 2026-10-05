import { z } from 'zod';
import { erreurCalendrier, Introuvable } from './erreurs.js';

export interface CorpsEvenement {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders: { useDefault: false; overrides: { method: 'popup'; minutes: number }[] };
}
export interface EvenementLu { id: string; status: string }

const evenementLu = z.object({ id: z.string(), status: z.string().default('confirmed') });
const agendaCree = z.object({ id: z.string().min(1) });
const DELAI_MS = 15_000;

/** API Google Calendar v3, portée calendar.app.created : seuls l'agenda et les événements créés ici sont visibles. */
export class ClientCalendrier {
  constructor(private readonly base: string, private readonly f: typeof fetch) {}

  private async appeler(jeton: string, methode: string, chemin: string, corps?: unknown): Promise<Response> {
    const r = await this.f(`${this.base}${chemin}`, {
      method: methode,
      headers: {
        authorization: `Bearer ${jeton}`, accept: 'application/json',
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!r.ok) throw await erreurCalendrier(r);
    return r;
  }

  private static evenements(agenda: string, id?: string, ecriture = false): string {
    return `/calendars/${encodeURIComponent(agenda)}/events${id ? `/${encodeURIComponent(id)}` : ''}${ecriture ? '?sendUpdates=none' : ''}`;
  }

  async creerAgenda(jeton: string, nom: string, fuseau: string): Promise<string> {
    const r = await this.appeler(jeton, 'POST', '/calendars', { summary: nom, timeZone: fuseau });
    return agendaCree.parse(await r.json()).id;
  }

  async agendaExiste(jeton: string, id: string): Promise<boolean> {
    try {
      const r = await this.appeler(jeton, 'GET', `/calendars/${encodeURIComponent(id)}`);
      await r.body?.cancel();
      return true;
    } catch (e) {
      if (e instanceof Introuvable) return false;
      throw e;
    }
  }

  async inserer(jeton: string, agenda: string, id: string, corps: CorpsEvenement): Promise<void> {
    const r = await this.appeler(jeton, 'POST', ClientCalendrier.evenements(agenda, undefined, true), { id, ...corps });
    await r.body?.cancel();
  }

  async lire(jeton: string, agenda: string, id: string): Promise<EvenementLu | null> {
    try {
      const r = await this.appeler(jeton, 'GET', ClientCalendrier.evenements(agenda, id));
      return evenementLu.parse(await r.json());
    } catch (e) {
      if (e instanceof Introuvable) return null;
      throw e;
    }
  }

  async remplacer(jeton: string, agenda: string, id: string, corps: CorpsEvenement): Promise<void> {
    const r = await this.appeler(jeton, 'PUT', ClientCalendrier.evenements(agenda, id, true), { id, ...corps });
    await r.body?.cancel();
  }

  /** Déjà supprimé (410) ou inconnu (404) : rien à faire. */
  async supprimer(jeton: string, agenda: string, id: string): Promise<void> {
    try {
      const r = await this.appeler(jeton, 'DELETE', ClientCalendrier.evenements(agenda, id, true));
      await r.body?.cancel();
    } catch (e) {
      if (!(e instanceof Introuvable)) throw e;
    }
  }
}
