import { OPTIONS_JOB_CLASSEMENT, type JobClassement } from '@organizer/shared';
import type { Queue } from 'bullmq';
import type { FileClassement } from './ingestion.service.js';

export class FileClassementBullmq implements FileClassement {
  constructor(private readonly file: Queue<JobClassement>) {}

  async enfiler(captureId: string): Promise<void> {
    // jobId = captureId : un double enfilage est ignoré par BullMQ.
    await this.file.add('classer', { captureId }, { ...OPTIONS_JOB_CLASSEMENT, jobId: captureId });
  }
}
