import { OPTIONS_JOB_AGENDA } from '@organizer/shared';
import { describe, expect, it, vi } from 'vitest';
import { SignalAgendaFile } from '../src/agenda/signal.js';

describe('SignalAgendaFile', () => {
  it('enfile une synchronisation avec le délai demandé', async () => {
    const add = vi.fn(async () => undefined);
    await new SignalAgendaFile({ add }).signaler('i1', 15_000);
    expect(add).toHaveBeenCalledWith('synchroniser', { type: 'synchroniser', itemId: 'i1' }, { ...OPTIONS_JOB_AGENDA, delay: 15_000 });
  });

  it('Valkey en panne : rien ne remonte, le balayage rattrapera', async () => {
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(new SignalAgendaFile({ add: async () => { throw new Error('ECONNREFUSED'); } }).signaler('i1')).resolves.toBeUndefined();
    expect(erreurs.mock.calls[0]![0]).toContain('balayage');
    erreurs.mockRestore();
  });
});
