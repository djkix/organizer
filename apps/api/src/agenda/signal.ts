import { enfilerSynchro, type FileJobs, type JobAgenda } from '@organizer/shared';

/** Prévient le scheduler qu'une action a changé. Ne fait jamais échouer le geste de L. */
export interface SignalAgenda { signaler(itemId: string, delaiMs?: number): Promise<void> }

export const SANS_AGENDA: SignalAgenda = { signaler: async () => {} };

export class SignalAgendaFile implements SignalAgenda {
  constructor(private readonly file: FileJobs<JobAgenda>) {}

  async signaler(itemId: string, delaiMs = 0): Promise<void> {
    try {
      await enfilerSynchro(this.file, itemId, delaiMs);
    } catch (e) {
      console.error(`Agenda : synchronisation de ${itemId} laissée au balayage (${(e as Error).name})`);
    }
  }
}
