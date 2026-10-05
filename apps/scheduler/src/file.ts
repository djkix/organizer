import type { PrismaClient } from '@organizer/db';
import { FILE_AGENDA, OPTIONS_JOB_AGENDA, type JobAgenda } from '@organizer/shared';
import { UnrecoverableError, Worker, type ConnectionOptions } from 'bullmq';
import { z } from 'zod';
import { balayer } from './agenda/balayer.js';
import { abandonnerDeconnexion, deconnecterAgenda, echangerCode, type DepsConnexion } from './agenda/connexion.js';
import type { Alerteur } from './agenda/jetons.js';
import type { DepsSynchro } from './agenda/synchroniser.js';
import { travailSynchro } from './agenda/travail.js';
import { ClientRefuse, GoogleIndisponible } from './google/erreurs.js';

/** Textes des alertes à l'administrateur (jamais à L) ; repris dans docs/exploitation.md. Ni jeton, ni titre, ni code. */
export const MESSAGES_ADMIN = {
  revoque: (nom: string) => `Google Agenda du compte ${nom} : autorisation retirée ou expirée. Reconnecter depuis Réglages.`,
  pause: (statut: number, raison: string | null) =>
    `Google Agenda refuse (${statut}${raison ? `, ${raison}` : ''}) : écritures suspendues 15 minutes.`,
  client: 'Google Agenda : client OAuth refusé. Vérifier GOOGLE_CLIENT_ID et google_client_secret.',
  agendaSupprime: (nom: string) => `Google Agenda du compte ${nom} : l'agenda Organizer a été supprimé. Écritures arrêtées.`,
  echecs: (n: number) => `Google Agenda : ${n} écritures en échec depuis une heure.`,
  revocationImpossible: (nom: string) => `Google Agenda du compte ${nom} : révocation impossible. Retirer l'accès depuis le compte Google.`,
};

/** Une alerte par constat ; un constat ne revient qu'après retablir (ou un redémarrage du scheduler). */
export class Signaleur {
  private readonly signales = new Set<string>();
  constructor(private readonly alerter: (message: string) => Promise<void>) {}

  async une(cle: string, message: string): Promise<void> {
    if (this.signales.has(cle)) return;
    this.signales.add(cle);
    try {
      await this.alerter(message);
    } catch (e) {
      this.signales.delete(cle);
      console.error(`Alerte impossible (${(e as Error).name})`);
    }
  }

  retablir(cle: string): void {
    this.signales.delete(cle);
  }
}

const nomDe = async (prisma: PrismaClient, uid: string): Promise<string> =>
  (await prisma.utilisateur.findUnique({ where: { id: uid }, select: { nom: true } }))?.nom ?? uid;

/** Pont entre les alertes de Jetons et de la synchronisation et l'alerte à l'administrateur (dédoublonnée par compte). */
export function alerteurAgenda(signaleur: Signaleur, prisma: PrismaClient): Alerteur {
  return async (a) => {
    const nom = await nomDe(prisma, a.utilisateurId);
    if (a.type === 'autorisation_retiree') await signaleur.une(`revoque:${a.utilisateurId}`, MESSAGES_ADMIN.revoque(nom));
    else await signaleur.une(`agenda:${a.utilisateurId}`, MESSAGES_ADMIN.agendaSupprime(nom));
  };
}

const idJob = z.string().min(1).max(100);
const SCHEMA_JOB = z.discriminatedUnion('type', [
  z.object({ type: z.literal('synchroniser'), itemId: idJob }).strict(),
  z.object({ type: z.literal('echanger'), utilisateurId: idJob, code: z.string().min(1).max(2000), verificateur: z.string().min(1).max(500) }).strict(),
  z.object({ type: z.literal('deconnecter'), utilisateurId: idJob }).strict(),
  z.object({ type: z.literal('balayer'), utilisateurId: idJob.optional() }).strict(),
]);

export interface DepsFileAgenda extends Omit<DepsSynchro, 'alerter'>, DepsConnexion {
  connexion: ConnectionOptions;
  alerter(message: string): Promise<void>;
  enfilerSynchro(itemId: string): Promise<void>;
  /** Le même signaleur que celui des Jetons (alerteurAgenda) ; créé ici à défaut. */
  signaleur?: Signaleur;
  nomFile?: string;
  pauseMs?: number;
}

const HEURE_MS = 3600_000;
export const BALAYAGE_MS = 10 * 60_000;

/**
 * Une seule instance de scheduler et une concurrence de 1 : les écritures vers Google sont sérialisées
 * (quota par utilisateur, identifiants d'événement déterministes). Ne jamais lancer deux schedulers.
 */
export function demarrerFileAgenda(d: DepsFileAgenda): Worker<JobAgenda> {
  const signaleur = d.signaleur ?? new Signaleur(d.alerter);
  const nom = (uid: string): Promise<string> => nomDe(d.prisma, uid);
  const synchro = travailSynchro({ ...d, alerter: alerteurAgenda(signaleur, d.prisma) });
  const echecs: number[] = [];
  let echecsSignalesLe = 0;

  const w: Worker<JobAgenda> = new Worker<JobAgenda>(
    d.nomFile ?? FILE_AGENDA,
    async (job) => {
      const lu = SCHEMA_JOB.safeParse(job.data);
      if (!lu.success) throw new UnrecoverableError('Données du job invalides');
      const j = lu.data;
      try {
        switch (j.type) {
          case 'synchroniser': {
            const r = await synchro(j.itemId);
            if (r !== 'rien' && r !== 'sans_agenda' && r !== 'revoque') signaleur.retablir('pause');
            return r;
          }
          case 'echanger': {
            const r = await echangerCode(j, d);
            if (r === 'connecte') {
              signaleur.retablir(`revoque:${j.utilisateurId}`);
              signaleur.retablir(`agenda:${j.utilisateurId}`);
            }
            return r;
          }
          case 'deconnecter':
            await deconnecterAgenda(j.utilisateurId, d);
            return 'deconnecte';
          case 'balayer':
            return await balayer({
              ...d, enfiler: d.enfilerSynchro,
              surRevocation: async (uid) => signaleur.une(`revoque:${uid}`, MESSAGES_ADMIN.revoque(await nom(uid))),
            }, j.utilisateurId);
        }
      } catch (e) {
        if (e instanceof GoogleIndisponible) {
          // Quota ou refus de débit : pause de toute la file, une alerte par épisode ; le job est repris sans compter un essai.
          await signaleur.une('pause', MESSAGES_ADMIN.pause(e.statut, e.raison));
          await w.rateLimit(d.pauseMs ?? 15 * 60_000);
          throw Worker.RateLimitError();
        }
        if (e instanceof ClientRefuse) {
          await signaleur.une('client', MESSAGES_ADMIN.client);
          throw new UnrecoverableError(e.name);
        }
        throw e;
      }
    },
    { connection: d.connexion, concurrency: 1 },
  );

  w.on('failed', (job, err) => {
    if (!job) return;
    const definitif = err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!definitif) return;
    console.error(`Agenda : job ${job.name} en échec définitif (${err.name})`);
    const type = (job.data as { type?: string }).type;
    const uid = (job.data as { utilisateurId?: string }).utilisateurId;
    void (async () => {
      if (type === 'echanger' && uid) {
        await d.prisma.agendaGoogle.updateMany({
          where: { utilisateurId: uid, etat: 'en_cours' }, data: { etat: 'echec', erreur: 'echange', jetonChiffre: null },
        });
      }
      if (type === 'deconnecter' && uid) {
        await abandonnerDeconnexion(uid, d);
        await signaleur.une(`revocation:${uid}`, MESSAGES_ADMIN.revocationImpossible(await nom(uid)));
      }
      const t = Date.now();
      echecs.push(t);
      while (echecs.length > 0 && echecs[0]! < t - HEURE_MS) echecs.shift();
      if (echecs.length >= 3 && t - echecsSignalesLe > HEURE_MS) {
        echecsSignalesLe = t;
        await signaleur.une(`echecs:${t}`, MESSAGES_ADMIN.echecs(echecs.length));
      }
    })().catch((e: unknown) => console.error(`Agenda : suite d'un échec impossible (${(e as Error).name})`));
  });
  return w;
}

/** Balayage périodique : un planificateur répétable à identifiant fixe, idempotent d'un démarrage à l'autre. */
export async function planifierBalayage(file: { upsertJobScheduler: (id: string, o: { every: number }, t: { name: string; data: JobAgenda; opts: object }) => Promise<unknown> }): Promise<void> {
  await file.upsertJobScheduler('balayage', { every: BALAYAGE_MS }, { name: 'balayer', data: { type: 'balayer' }, opts: { ...OPTIONS_JOB_AGENDA, attempts: 1 } });
}
