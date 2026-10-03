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
            await d.alerter('Crédit Gemini épuisé : classement suspendu.');
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

/** Réenfile les captures dont le classement a échoué faute de réseau ou d'API. */
export async function reprendre(prisma: PrismaClient, file: Queue<JobClassement>): Promise<number> {
  const captures = await prisma.capture.findMany({
    where: { etat: 'a_transcrire', prive: false }, orderBy: { emisLe: 'asc' }, select: { id: true },
  });
  for (const { id } of captures) {
    await prisma.capture.update({ where: { id }, data: { etat: 'en_file' } });
    await file.add('classer', { captureId: id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: `${id}-reprise-${Date.now()}` });
  }
  return captures.length;
}
