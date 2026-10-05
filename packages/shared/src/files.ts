export const FILE_CLASSEMENT = 'classement';
export const FILE_ALERTES = 'alertes';

export interface JobClassement { captureId: string }
export interface JobAlerte { message: string }

/** Environ 16 minutes de reprises avant de passer la capture en a_transcrire. */
export const OPTIONS_JOB_CLASSEMENT = {
  attempts: 6,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

/** L'alerte de crédit épuisé n'est émise qu'une fois : environ quatre heures de reprises avant abandon. */
export const OPTIONS_JOB_ALERTE = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
} as const;

export const FILE_AGENDA = 'agenda';
export const FILE_PROPOSITIONS = 'propositions';

/**
 * Jobs du scheduler ; le nom du job BullMQ est `type`. Un job `synchroniser` ne dit jamais quoi faire :
 * le scheduler relit l'action et ne fait que l'écart. Code et vérificateur ne vivent que le temps de l'échange.
 */
export type JobAgenda =
  | { type: 'synchroniser'; itemId: string }
  | { type: 'echanger'; utilisateurId: string; code: string; verificateur: string }
  | { type: 'deconnecter'; utilisateurId: string }
  | { type: 'balayer'; utilisateurId?: string };

/** Proposition du bouton « Avec alarme » après le classement d'une capture Telegram (envoyée par l'API). */
export interface JobProposition { captureId: string }

/** Environ deux heures de reprises (30 s doublées) ; au-delà, le balayage de 10 minutes rattrape. */
export const OPTIONS_JOB_AGENDA = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

/** Le code d'autorisation expire vite et ne doit rien laisser dans Valkey : peu d'essais, rien de gardé. */
export const OPTIONS_JOB_ECHANGE = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;

export const OPTIONS_JOB_PROPOSITION = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
} as const;

/** Après un cochage : au-delà des 10 s d'annulation de la PWA, pour qu'un cochage annulé ne touche pas l'agenda. */
export const DELAI_SYNCHRO_COCHAGE_MS = 15_000;

/** Ce que les producteurs demandent à une file BullMQ. */
export interface FileJobs<T> { add(nom: string, data: T, opts?: object): Promise<unknown> }

/** Pas de jobId : deux synchronisations du même item sont inoffensives, une seule serait perdue si l'autre est active. */
export async function enfilerSynchro(file: FileJobs<JobAgenda>, itemId: string, delaiMs = 0): Promise<void> {
  await file.add('synchroniser', { type: 'synchroniser', itemId }, { ...OPTIONS_JOB_AGENDA, delay: delaiMs });
}
