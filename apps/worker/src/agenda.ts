import type { PrismaClient } from '@organizer/db';
import { enfilerSynchro, OPTIONS_JOB_PROPOSITION, type FileJobs, type JobAgenda, type JobProposition } from '@organizer/shared';

export interface FilesApresClassement { agenda: FileJobs<JobAgenda>; propositions: FileJobs<JobProposition> }

/**
 * Après le classement : chaque rendez-vous daté part vers l'agenda ; une capture Telegram qui en contient reçoit
 * la proposition du bouton « Avec alarme » (envoyée par l'API, seul point d'envoi vers L). jobId : une seule par capture.
 */
export async function apresClassement(prisma: PrismaClient, files: FilesApresClassement, captureId: string): Promise<void> {
  const c = await prisma.capture.findUnique({
    where: { id: captureId },
    select: { canal: true, prive: true, items: { where: { nature: 'action', action: { is: { echeanceType: 'datee' } } }, select: { id: true } } },
  });
  if (!c || c.prive || c.items.length === 0) return;
  for (const it of c.items) await enfilerSynchro(files.agenda, it.id);
  if (c.canal === 'telegram') {
    await files.propositions.add('proposer', { captureId }, { ...OPTIONS_JOB_PROPOSITION, jobId: `proposer-${captureId}` });
  }
}
