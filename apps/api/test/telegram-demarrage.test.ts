import { describe, expect, it } from 'vitest';
import { demarrerTelegram } from '../src/telegram/demarrage.js';

function fauxBot(echecs: number) {
  let essais = 0;
  const appels: string[] = [];
  const bot = {
    async init(): Promise<void> {
      essais++;
      if (essais <= echecs) throw Object.assign(new Error('getMe 0:secret refusé'), { name: 'HttpError' });
    },
    async start(): Promise<void> { appels.push('start'); },
    api: { async deleteWebhook(): Promise<true> { appels.push('deleteWebhook'); return true; } },
  };
  return { bot, appels, essais: () => essais };
}

const options = (bot: unknown, mode: 'polling' | 'webhook', delais: number[], journal: string[] = [], signal = new AbortController().signal) => ({
  bot: bot as Parameters<typeof demarrerTelegram>[0]['bot'],
  mode, signal, journal: (m: string) => { journal.push(m); },
  attendre: async (ms: number) => { delais.push(ms); },
  quitter: () => {},
});

describe('demarrerTelegram', () => {
  it('réessaie à 5 s en doublant, sans jamais lever ni journaliser le jeton', async () => {
    const f = fauxBot(3);
    const delais: number[] = [];
    const journal: string[] = [];
    await demarrerTelegram(options(f.bot, 'webhook', delais, journal));
    expect(f.essais()).toBe(4);
    expect(delais).toEqual([5_000, 10_000, 20_000]);
    expect(f.appels).toEqual([]);
    expect(journal.join('\n')).not.toContain('secret');
    expect(journal[0]).toContain('HttpError');
  });

  it('plafonne l\'attente à 5 minutes', async () => {
    const f = fauxBot(8);
    const delais: number[] = [];
    await demarrerTelegram(options(f.bot, 'webhook', delais));
    expect(delais).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });

  it('en polling, retire le webhook puis lance le polling une fois prêt', async () => {
    const f = fauxBot(1);
    await demarrerTelegram(options(f.bot, 'polling', []));
    expect(f.appels).toEqual(['deleteWebhook', 'start']);
  });

  it('s\'arrête avec l\'API, même si Telegram ne répond jamais', async () => {
    const arret = new AbortController();
    const f = fauxBot(Number.POSITIVE_INFINITY);
    let attentes = 0;
    await demarrerTelegram({
      ...options(f.bot, 'polling', [], [], arret.signal),
      attendre: async () => { if (++attentes === 2) arret.abort(); },
    });
    expect(f.essais()).toBe(2);
    expect(f.appels).toEqual([]);
  });
});
