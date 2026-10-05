import 'reflect-metadata';
import type { Request, Response } from 'express';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigApi } from '../src/config.js';
import { TelegramController } from '../src/telegram/telegram.controller.js';

const botInfo = { id: 1, is_bot: true, first_name: 'test', username: 'test_bot' } as UserFromGetMe;
const SECRET = 'jeton-webhook-test';

function config(mode: 'polling' | 'webhook'): ConfigApi {
  return {
    port: 0, redisUrl: 'redis://inutilise', telegramToken: '0:test', telegramMode: mode,
    webhookSecret: mode === 'webhook' ? SECRET : undefined, audioRacine: '/inutilise', typesEcheance: [],
    webauthn: { rpId: 'localhost', origine: 'http://localhost:5173', nomRp: 'Organizer' },
  };
}

function requete(corps: unknown, secret: string | null = SECRET): Request {
  return {
    body: corps,
    header: (nom: string) => (nom.toLowerCase() === 'x-telegram-bot-api-secret-token' ? (secret ?? undefined) : undefined),
  } as unknown as Request;
}

function reponse() {
  const r = { statut: 200, corps: undefined as unknown, terminee: false };
  const res = {
    status(s: number) { r.statut = s; return res; },
    set() { return res; },
    send(c: unknown) { r.corps = c; r.terminee = true; return res; },
    end() { r.terminee = true; return res; },
    sendStatus(s: number) { r.statut = s; r.terminee = true; return res; },
  };
  return { res: res as unknown as Response, r };
}

const maj = (id: number) => ({
  update_id: id,
  message: { message_id: 1, date: 1_791_270_720, chat: { id: 7, type: 'private', first_name: 'x' }, text: 'pain' },
});

afterEach(() => { vi.restoreAllMocks(); });

describe('TelegramController en mode polling', () => {
  it('ne remplace pas bot.start', () => {
    const bot = new Bot('0:test', { botInfo });
    new TelegramController(bot, config('polling'));
    expect(Object.prototype.hasOwnProperty.call(bot, 'start')).toBe(false);
    expect(bot.start).toBe(Bot.prototype.start);
  });

  it('la route webhook répond 404', async () => {
    const bot = new Bot('0:test', { botInfo });
    const vues: number[] = [];
    bot.use((ctx) => { vues.push(ctx.update.update_id); });
    const c = new TelegramController(bot, config('polling'));
    const { res, r } = reponse();
    await c.recevoir(requete(maj(1)), res);
    expect(r.statut).toBe(404);
    expect(r.terminee).toBe(true);
    expect(vues).toHaveLength(0);
  });
});

describe('TelegramController en mode webhook', () => {
  it('transmet la mise à jour au bot', async () => {
    const bot = new Bot('0:test', { botInfo });
    const vues: number[] = [];
    bot.use((ctx) => { vues.push(ctx.update.update_id); });
    const c = new TelegramController(bot, config('webhook'));
    const { res, r } = reponse();
    await c.recevoir(requete(maj(5)), res);
    expect(vues).toEqual([5]);
    expect(r.statut).toBe(200);
    expect(r.terminee).toBe(true);
  });

  it('refuse un secret faux', async () => {
    const bot = new Bot('0:test', { botInfo });
    const c = new TelegramController(bot, config('webhook'));
    const { res, r } = reponse();
    await c.recevoir(requete(maj(5), 'faux'), res);
    expect(r.statut).toBe(401);
  });

  it.each([['faux', 'faux'], ['absent', null], ['trop court', 'jeton']])(
    'secret %s : 401 sans initialiser le bot',
    async (_nom, secret) => {
      const bot = new Bot('0:test');
      const init = vi.spyOn(bot, 'init').mockRejectedValue(new Error('Telegram injoignable'));
      const vues: number[] = [];
      bot.use((ctx) => { vues.push(ctx.update.update_id); });
      const c = new TelegramController(bot, config('webhook'));
      const { res, r } = reponse();
      await c.recevoir(requete(maj(5), secret), res);
      expect(r.statut).toBe(401);
      expect(r.terminee).toBe(true);
      expect(init).not.toHaveBeenCalled();
      expect(vues).toHaveLength(0);
    },
  );

  it('une erreur du bot répond 500 sans rien journaliser du contenu', async () => {
    const bot = new Bot('0:test', { botInfo });
    bot.use(() => { throw new Error('Argument texteEcrit invalide : secret de L'); });
    const c = new TelegramController(bot, config('webhook'));
    const journal: string[] = [];
    const capter = (...a: unknown[]) => { journal.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' ')); };
    for (const m of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation(capter);
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => { journal.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation((s) => { journal.push(String(s)); return true; });
    const { res, r } = reponse();
    await c.recevoir(requete(maj(9)), res);
    vi.restoreAllMocks();
    expect(r.statut).toBe(500);
    expect(r.terminee).toBe(true);
    expect(String(r.corps ?? '')).not.toContain('secret');
    expect(journal.join('\n')).not.toContain('secret');
    expect(journal.join('\n')).toContain('9');
  });
});
