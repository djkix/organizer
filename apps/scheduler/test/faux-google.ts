import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const PORTEE = 'https://www.googleapis.com/auth/calendar.app.created';
export const SECRET_ESSAI = 'secret-essai';

export interface RequeteVue { methode: string; chemin: string; autorisation: string | undefined; corps: string }
interface EvenementStocke { id: string; status: 'confirmed' | 'cancelled'; corps: Record<string, unknown> }
interface AgendaStocke { summary: string; timeZone: string; evenements: Map<string, EvenementStocke> }

const lire = (req: IncomingMessage): Promise<string> => new Promise((ok, ko) => {
  const morceaux: Buffer[] = [];
  req.on('data', (m: Buffer) => morceaux.push(m)).on('end', () => ok(Buffer.concat(morceaux).toString('utf8'))).on('error', ko);
});

function envoyer(res: ServerResponse, statut: number, corps?: unknown): void {
  if (corps === undefined || statut === 204) {
    res.writeHead(statut).end();
    return;
  }
  res.writeHead(statut, { 'content-type': 'application/json' }).end(JSON.stringify(corps));
}

const erreur = (code: number, reason: string) => ({ error: { code, errors: [{ reason }], message: `message de Google ${reason}` } });

/** Faux Google (OAuth et agenda v3), en mémoire. Aucun appel au vrai Google dans les tests. */
export class FauxGoogle {
  url = '';
  readonly requetes: RequeteVue[] = [];
  /** Codes d'autorisation acceptés : portée accordée, vérificateur PKCE attendu, jeton de rafraîchissement absent. */
  readonly codes = new Map<string, { portee: string; verificateur?: string; sansRafraichissement?: boolean }>();
  readonly rafraichissements = new Set<string>();
  readonly acces = new Set<string>();
  readonly revoques: string[] = [];
  readonly agendas = new Map<string, AgendaStocke>();
  private forces: Array<{ motif: RegExp; statut: number; corps: unknown }> = [];
  private n = 0;
  private serveur?: Server;

  /** La prochaine requête « MÉTHODE /chemin » qui correspond reçoit ce statut. Un appel = une réponse forcée. */
  forcer(motif: RegExp, statut: number, corps: unknown = erreur(statut, 'force')): void {
    this.forces.push({ motif, statut, corps });
  }

  connecte(rafr = 'rafr-1'): void {
    this.rafraichissements.add(rafr);
  }

  agenda(id = 'agenda-1@group.calendar.google.com'): string {
    this.agendas.set(id, { summary: 'Organizer', timeZone: 'Europe/Paris', evenements: new Map() });
    return id;
  }

  evenement(agenda: string, id: string): EvenementStocke | undefined {
    return this.agendas.get(agenda)?.evenements.get(id);
  }

  /** Ce que fait L quand elle supprime l'événement dans Google Agenda. */
  supprimerParL(agenda: string, id: string): void {
    const e = this.evenement(agenda, id);
    if (e) e.status = 'cancelled';
  }

  async demarrer(): Promise<void> {
    this.serveur = createServer((req, res) => {
      this.traiter(req, res).catch(() => envoyer(res, 500, erreur(500, 'backendError')));
    });
    await new Promise<void>((ok) => this.serveur!.listen(0, '127.0.0.1', ok));
    this.url = `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
  }

  async arreter(): Promise<void> {
    await new Promise<void>((ok) => this.serveur?.close(() => ok()) ?? ok());
  }

  private async traiter(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const corps = await lire(req);
    const chemin = new URL(req.url ?? '/', 'http://x').pathname;
    const methode = req.method ?? 'GET';
    this.requetes.push({ methode, chemin, autorisation: req.headers.authorization, corps });
    const i = this.forces.findIndex((f) => f.motif.test(`${methode} ${chemin}`));
    if (i >= 0) {
      const [f] = this.forces.splice(i, 1);
      return envoyer(res, f!.statut, f!.corps);
    }
    if (methode === 'POST' && chemin === '/token') return this.jeton(new URLSearchParams(corps), res);
    if (methode === 'POST' && chemin === '/revoke') {
      const jeton = new URLSearchParams(corps).get('token') ?? '';
      this.revoques.push(jeton);
      this.rafraichissements.delete(jeton);
      return envoyer(res, 200, {});
    }
    const m = /^\/calendar\/v3\/calendars(?:\/([^/]+))?(\/events)?(?:\/([^/]+))?$/.exec(chemin);
    if (!m) return envoyer(res, 404, erreur(404, 'notFound'));
    if (!this.acces.has((req.headers.authorization ?? '').replace(/^Bearer /, ''))) return envoyer(res, 401, erreur(401, 'authError'));
    const agendaId = m[1] ? decodeURIComponent(m[1]) : undefined;
    const evenementId = m[3] ? decodeURIComponent(m[3]) : undefined;
    if (!agendaId) {
      if (methode !== 'POST') return envoyer(res, 404, erreur(404, 'notFound'));
      const c = JSON.parse(corps) as { summary: string; timeZone: string };
      const id = `agenda-${++this.n}@group.calendar.google.com`;
      this.agendas.set(id, { summary: c.summary, timeZone: c.timeZone, evenements: new Map() });
      return envoyer(res, 200, { id, summary: c.summary, timeZone: c.timeZone });
    }
    const a = this.agendas.get(agendaId);
    if (!a) return envoyer(res, 404, erreur(404, 'notFound'));
    if (!m[2]) return methode === 'GET' ? envoyer(res, 200, { id: agendaId, summary: a.summary }) : envoyer(res, 404, erreur(404, 'notFound'));
    if (!evenementId) {
      if (methode !== 'POST') return envoyer(res, 404, erreur(404, 'notFound'));
      const c = JSON.parse(corps) as Record<string, unknown>;
      const id = String(c.id);
      if (a.evenements.has(id)) return envoyer(res, 409, erreur(409, 'duplicate'));
      a.evenements.set(id, { id, status: 'confirmed', corps: c });
      return envoyer(res, 200, { id, status: 'confirmed' });
    }
    const e = a.evenements.get(evenementId);
    if (!e) return envoyer(res, 404, erreur(404, 'notFound'));
    if (methode === 'GET') return envoyer(res, 200, { id: e.id, status: e.status });
    if (methode === 'PUT') {
      e.corps = JSON.parse(corps) as Record<string, unknown>;
      return envoyer(res, 200, { id: e.id, status: e.status });
    }
    if (methode === 'DELETE') {
      if (e.status === 'cancelled') return envoyer(res, 410, erreur(410, 'deleted'));
      e.status = 'cancelled';
      return envoyer(res, 204);
    }
    return envoyer(res, 404, erreur(404, 'notFound'));
  }

  private jeton(p: URLSearchParams, res: ServerResponse): void {
    if (p.get('client_secret') !== SECRET_ESSAI) return envoyer(res, 401, { error: 'invalid_client', error_description: 'secret' });
    if (p.get('grant_type') === 'authorization_code') {
      const code = p.get('code') ?? '';
      const c = this.codes.get(code);
      if (!c || (c.verificateur !== undefined && c.verificateur !== p.get('code_verifier'))) {
        return envoyer(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
      }
      this.codes.delete(code);
      const n = ++this.n;
      this.acces.add(`acces-${n}`);
      if (!c.sansRafraichissement) this.rafraichissements.add(`rafr-${n}`);
      return envoyer(res, 200, {
        access_token: `acces-${n}`, expires_in: 3599, scope: c.portee, token_type: 'Bearer',
        ...(c.sansRafraichissement ? {} : { refresh_token: `rafr-${n}` }),
      });
    }
    if (p.get('grant_type') === 'refresh_token') {
      if (!this.rafraichissements.has(p.get('refresh_token') ?? '')) return envoyer(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      const n = ++this.n;
      this.acces.add(`acces-${n}`);
      return envoyer(res, 200, { access_token: `acces-${n}`, expires_in: 3599, scope: PORTEE, token_type: 'Bearer' });
    }
    return envoyer(res, 400, { error: 'unsupported_grant_type' });
  }
}
