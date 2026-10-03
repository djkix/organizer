import type { PrismaClient } from '@organizer/db';
import type { Bot } from 'grammy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { envoyerAlerte } from '../src/alertes.js';

const prismaAvec = (chats: bigint[]) => ({
  utilisateur: { findMany: async () => chats.map((c, i) => ({ id: `a${i}`, telegramChatId: c })) },
}) as unknown as PrismaClient;

function botQui(echoue: number[]) {
  const envois: number[] = [];
  const bot = {
    api: {
      sendMessage: async (chat: number) => {
        envois.push(chat);
        if (echoue.includes(chat)) throw new Error('telegram hors service');
        return {};
      },
    },
  } as unknown as Bot;
  return { bot, envois };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('envoyerAlerte', () => {
  it('un admin en échec n\'empêche pas l\'envoi au suivant, puis le job échoue', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { bot, envois } = botQui([1]);
    await expect(envoyerAlerte('Crédit épuisé.', prismaAvec([1n, 2n]), bot)).rejects.toThrow();
    expect(envois).toEqual([1, 2]);
  });

  it('réussit quand tous les envois passent', async () => {
    const { bot, envois } = botQui([]);
    await envoyerAlerte('Crédit épuisé.', prismaAvec([1n, 2n]), bot);
    expect(envois).toEqual([1, 2]);
  });

  it('sans admin lié, journalise l\'alerte sans destinataire', async () => {
    const erreurs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((m: unknown) => { erreurs.push(String(m)); });
    const { bot, envois } = botQui([]);
    await envoyerAlerte('Crédit épuisé.', prismaAvec([]), bot);
    expect(envois).toHaveLength(0);
    expect(erreurs.some((e) => e.includes('Alerte sans destinataire'))).toBe(true);
  });
});
