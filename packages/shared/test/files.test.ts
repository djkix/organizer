import { describe, expect, it } from 'vitest';
import { OPTIONS_JOB_ALERTE } from '../src/files.js';

describe('OPTIONS_JOB_ALERTE', () => {
  it('réessaie une alerte plusieurs fois avec un délai croissant', () => {
    expect(OPTIONS_JOB_ALERTE).toMatchObject({ attempts: 8, backoff: { type: 'exponential', delay: 60_000 } });
  });
});
