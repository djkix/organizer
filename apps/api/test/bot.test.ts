import type { UserFromGetMe } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import type { CaptureEntrante } from '../src/ingestion/extraire.js';
import type { IngestionService } from '../src/ingestion/ingestion.service.js';
import type { LiaisonService } from '../src/telegram/liaison.service.js';
import { creerBot } from '../src/telegram/bot.js';

const botInfo = { id: 1, is_bot: true, first_name: 'test', username: 'test_bot' } as UserFromGetMe;

function monter(lie: boolean) {
  const envois: { method: string; payload: Record<string, unknown> }[] = [];
  const recues: string[] = [];
  const finalisees: string[] = [];
  const liaison = {
    utilisateurDuChat: async () => (lie ? { id: 'u1' } : null),
    lier: async (code: string) => (code === '123456' ? 'lie' : 'invalide'),
  } as unknown as LiaisonService;
  let arme = false;
  const privees: string[] = [];
  const ingestion = {
    recevoir: async (_u: string, e: CaptureEntrante) => {
      const nouvelle = !recues.includes(e.sourceRef);
      recues.push(e.sourceRef);
      const prive = nouvelle && arme;
      if (prive) arme = false;
      return { id: 'c1', nouvelle, prive };
    },
    finaliser: async (id: string) => { finalisees.push(id); },
    finaliserPrivee: async (id: string) => { privees.push(id); },
    armerPrivee: async () => { arme = true; },
  } as unknown as IngestionService;
  const bot = creerBot('0:test', { liaison, ingestion }, { botInfo });
  bot.api.config.use(async (_prev, method, payload) => {
    envois.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: true } as never;
  });
  return { bot, envois, recues, finalisees, privees };
}

const maj = (id: number, message: Record<string, unknown>) => ({
  update_id: id,
  message: { message_id: 42, date: 1_791_270_720, chat: { id: 7, type: 'private', first_name: 'x' }, ...message },
}) as never;

describe('creerBot', () => {
  it('accuse réception d\'un vocal et lance la finalisation', async () => {
    const { bot, envois, finalisees } = monter(true);
    await bot.handleUpdate(maj(1, { voice: { file_id: 'F', file_unique_id: 'U', duration: 3 } }));
    expect(envois).toHaveLength(1);
    expect(envois[0]).toMatchObject({ method: 'sendMessage', payload: { chat_id: 7, text: 'Reçu.' } });
    await new Promise((r) => setImmediate(r));
    expect(finalisees).toEqual(['c1']);
  });

  it('une mise à jour relivrée ne produit pas de second accusé', async () => {
    const { bot, envois, recues } = monter(true);
    await bot.handleUpdate(maj(1, { text: 'pain' }));
    await bot.handleUpdate(maj(1, { text: 'pain' }));
    expect(recues).toHaveLength(2);
    expect(envois.filter((e) => e.payload.text === 'Reçu.')).toHaveLength(1);
  });

  it('un chat non lié ne crée aucune capture', async () => {
    const { bot, envois, recues } = monter(false);
    await bot.handleUpdate(maj(1, { text: 'pain' }));
    expect(recues).toHaveLength(0);
    expect(envois[0]!.payload.text).toBe("Ce compte n'est pas lié.");
  });

  it('/start avec un code lie le chat', async () => {
    const { bot, envois } = monter(false);
    await bot.handleUpdate(maj(1, { text: '/start 123456', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    expect(envois[0]!.payload.text).toBe("C'est lié. Envoie un vocal quand tu veux.");
  });

  it('le bouton arme la capture privée ; la suivante est accusée comme privée, jamais finalisée en ordinaire', async () => {
    const { bot, envois, finalisees, privees } = monter(true);
    await bot.handleUpdate(maj(1, { text: 'Prochaine capture privée' }));
    expect(envois[0]!.payload.text).toBe('La prochaine capture reste sur le serveur.');
    await bot.handleUpdate(maj(2, { voice: { file_id: 'F', file_unique_id: 'U', duration: 3 } }));
    expect(envois[1]!.payload.text).toBe('Reçu. Elle reste sur le serveur.');
    await new Promise((r) => setImmediate(r));
    expect(privees).toEqual(['c1']);
    expect(finalisees).toEqual([]);
  });

  it('la liaison réussie envoie le clavier avec le bouton privé', async () => {
    const { bot, envois } = monter(false);
    await bot.handleUpdate(maj(1, { text: '/start 123456', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    expect(JSON.stringify(envois[0]!.payload.reply_markup)).toContain('Prochaine capture privée');
  });

  it('un format non pris en charge reçoit une réponse sans capture', async () => {
    const { bot, envois, recues } = monter(true);
    await bot.handleUpdate(maj(1, { sticker: { file_id: 'S', file_unique_id: 'U' } }));
    expect(recues).toHaveLength(0);
    expect(envois[0]!.payload.text).toBe('Je garde seulement la voix et le texte.');
  });

  it('les messages du bot font moins de 12 mots et sans emoji', async () => {
    const { bot, envois } = monter(false);
    await bot.handleUpdate(maj(1, { text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    await bot.handleUpdate(maj(2, { text: '/start 000000', entities: [{ type: 'bot_command', offset: 0, length: 6 }] }));
    await bot.handleUpdate(maj(3, { text: 'pain' }));
    const { bot: lie, envois: envoisLie } = monter(true);
    await lie.handleUpdate(maj(4, { sticker: { file_id: 'S', file_unique_id: 'U' } }));
    envois.push(...envoisLie);
    for (const e of envois) {
      const texte = String(e.payload.text);
      expect(texte.split(/\s+/).length).toBeLessThan(12);
      expect(texte).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
