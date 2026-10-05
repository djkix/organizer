import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@organizer/db';
import { OPTIONS_JOB_AGENDA, OPTIONS_JOB_ECHANGE, PORTEE_AGENDA, type FileJobs, type JobAgenda } from '@organizer/shared';
import type { ErreurAgenda, ReponseAgenda, ReponseConnexionAgenda } from '@organizer/shared/api';
import type { ConfigAgendaApi } from './config.js';
import type { MagasinEtats } from './etats.js';

export { PORTEE_AGENDA };

export class AgendaIndisponible extends Error {
  override name = 'AgendaIndisponible';
}

export type IssueRetour = 'retour' | 'refus' | 'expire';

/**
 * Parcours OAuth côté API. L'API ne joint jamais Google : elle prépare l'adresse de consentement (état et PKCE),
 * vérifie le retour, puis confie code et vérificateur au scheduler. Le code n'est jamais journalisé.
 */
export class AgendaService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly etats: MagasinEtats,
    private readonly file: FileJobs<JobAgenda>,
    private readonly config: ConfigAgendaApi | null,
  ) {}

  async etat(uid: string): Promise<ReponseAgenda> {
    if (!this.config) return { etat: 'indisponible', erreur: null };
    const a = await this.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid } });
    return a ? { etat: a.etat, erreur: (a.erreur as ErreurAgenda) ?? null } : { etat: 'deconnecte', erreur: null };
  }

  async demarrer(uid: string): Promise<ReponseConnexionAgenda> {
    if (!this.config) throw new AgendaIndisponible();
    const etat = randomBytes(32).toString('base64url');
    const verificateur = randomBytes(48).toString('base64url');
    const defi = createHash('sha256').update(verificateur).digest('base64url');
    await this.etats.poser(etat, JSON.stringify({ utilisateurId: uid, verificateur }));
    const url = new URL(this.config.urlAutorisation);
    const params: Record<string, string> = {
      client_id: this.config.clientId, redirect_uri: this.config.redirectUri, response_type: 'code', scope: PORTEE_AGENDA,
      access_type: 'offline', prompt: 'consent', state: etat, code_challenge: defi, code_challenge_method: 'S256',
    };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return { url: url.toString() };
  }

  /** L'état est consommé avant tout : un retour rejoué, ou arrivé sur une autre session, est « expiré ». */
  async retour(q: { state?: string; code?: string; error?: string }, uidSession: string | null): Promise<IssueRetour> {
    if (!this.config || !q.state) return 'expire';
    const brut = await this.etats.prendre(q.state);
    if (!brut) return 'expire';
    const v = JSON.parse(brut) as { utilisateurId: string; verificateur: string };
    if (!uidSession || uidSession !== v.utilisateurId) return 'expire';
    if (q.error) return 'refus';
    if (!q.code) return 'expire';
    await this.prisma.agendaGoogle.upsert({
      where: { utilisateurId: v.utilisateurId },
      create: { utilisateurId: v.utilisateurId, etat: 'en_cours' },
      update: { etat: 'en_cours', erreur: null },
    });
    await this.file.add('echanger', { type: 'echanger', utilisateurId: v.utilisateurId, code: q.code, verificateur: v.verificateur }, OPTIONS_JOB_ECHANGE);
    return 'retour';
  }

  async deconnecter(uid: string): Promise<void> {
    const r = await this.prisma.agendaGoogle.updateMany({
      where: { utilisateurId: uid, etat: { not: 'deconnecte' } }, data: { etat: 'deconnexion', erreur: null },
    });
    if (r.count > 0) await this.file.add('deconnecter', { type: 'deconnecter', utilisateurId: uid }, OPTIONS_JOB_AGENDA);
  }
}
