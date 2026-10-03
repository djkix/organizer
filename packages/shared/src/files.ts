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
