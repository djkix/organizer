import type { PrismaClient } from '@organizer/db';
import { FILE_CLASSEMENT, OPTIONS_JOB_CLASSEMENT, type JobClassement } from '@organizer/shared';
import { UnrecoverableError, Worker, type ConnectionOptions, type Queue } from 'bullmq';
import { CreditEpuise } from './classement/provider.js';
import { CapturePriveeRefusee, traiterCapture, type DepsTraitement } from './classement/traiter.js';

export interface DepsWorker extends DepsTraitement {
  connexion: ConnectionOptions;
  concurrence: number;
  alerter(message: string): Promise<void>;
  nomFile?: string;
  pauseCreditMs?: number;
}

export function demarrerWorker(d: DepsWorker): Worker<JobClassement> {
  let creditSignale = false;
  const w: Worker<JobClassement> = new Worker<JobClassement>(
    d.nomFile ?? FILE_CLASSEMENT,
    async (job) => {
      try {
        const issue = await traiterCapture(job.data.captureId, d);
        creditSignale = false;
        return issue;
      } catch (e) {
        if (e instanceof CapturePriveeRefusee) throw new UnrecoverableError('capture privée refusée');
        if (e instanceof CreditEpuise) {
          // Indisponibilité, pas un échec : la file s'arrête et garde l'ordre.
          if (!creditSignale) {
            creditSignale = true;
            try {
              await d.alerter('Crédit Gemini épuisé : classement suspendu.');
            } catch (err) {
              // L'alerte ne doit jamais empêcher la pause : on la retentera au prochain 402.
              creditSignale = false;
              console.error(`Alerte crédit impossible : ${(err as Error).name}`);
            }
          }
          await w.rateLimit(d.pauseCreditMs ?? 15 * 60_000);
          throw Worker.RateLimitError();
        }
        throw e;
      }
    },
    { connection: d.connexion, concurrency: d.concurrence },
  );

  w.on('failed', (job, err) => {
    if (!job || err instanceof UnrecoverableError || err.name === 'UnrecoverableError') return;
    if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
    // Une requête Prisma est paresseuse : sans .catch (ou await), elle ne part jamais.
    void d.prisma.capture.updateMany({
      where: { id: job.data.captureId, prive: false, etat: { in: ['recue', 'en_file'] } },
      data: { etat: 'a_transcrire', erreur: err.name },
    }).catch((e: unknown) => console.error(`Passage en a_transcrire impossible : ${(e as Error).name}`));
  });
  return w;
}

/** États BullMQ où le job finira par être traité : la capture n'est pas orpheline. */
const ETATS_VIVANTS = new Set(['waiting', 'active', 'delayed', 'prioritized', 'waiting-children']);

/** Délai au-delà duquel une capture en_file sans job vivant est jugée orpheline. */
export const DELAI_ORPHELINE_MS = 60 * 60_000;

/**
 * Enfile la capture sous jobId = captureId, sauf si un job vivant existe déjà.
 * Un ancien job mort (échec, terminé) est retiré d'abord : BullMQ ignorerait sinon l'ajout.
 */
async function enfilerSansDoublon(file: Queue<JobClassement>, id: string): Promise<boolean> {
  const job = await file.getJob(id);
  if (job) {
    if (ETATS_VIVANTS.has(await job.getState())) return false;
    await file.remove(id);
  }
  await file.add('classer', { captureId: id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: id });
  return true;
}

/**
 * Remet en file les captures perdues en route : celles en a_transcrire (essais épuisés), et celles
 * restées en_file depuis plus d'une heure sans job vivant (job bloqué deux fois, handler failed en
 * échec, perte de Valkey). Jamais une capture privée. Renvoie le nombre de captures réenfilées.
 */
export async function reprendre(prisma: PrismaClient, file: Queue<JobClassement>, maintenant: Date = new Date()): Promise<number> {
  const captures = await prisma.capture.findMany({
    where: {
      prive: false,
      OR: [
        { etat: 'a_transcrire' },
        { etat: 'en_file', recuLe: { lt: new Date(maintenant.getTime() - DELAI_ORPHELINE_MS) } },
      ],
    },
    orderBy: { emisLe: 'asc' }, select: { id: true },
  });
  let n = 0;
  for (const { id } of captures) {
    // D'abord la file : un échec ici laisse la capture dans son état, reprise au prochain passage.
    if (await enfilerSansDoublon(file, id)) n++;
    await prisma.capture.updateMany({ where: { id, etat: 'a_transcrire' }, data: { etat: 'en_file' } });
  }
  return n;
}
