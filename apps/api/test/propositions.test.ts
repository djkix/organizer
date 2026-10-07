import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ItemsService } from '../src/items/items.service.js';
import type { IngestionService } from '../src/ingestion/ingestion.service.js';
import { creerBot } from '../src/telegram/bot.js';
import { LiaisonService } from '../src/telegram/liaison.service.js';
import { Alarmes, proposerAlarmes, texteRendezVous } from '../src/telegram/propositions.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

const MAINTENANT = new Date('2026-10-10T08:00:00Z');
const botInfo = { id: 1, is_bot: true, first_name: 'test', username: 'test_bot' } as UserFromGetMe;
const TYPES = ['datee', 'jour', 'fenetre', 'relative', 'aucune'];

function intercepter(bot: Bot) {
  const envois: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    envois.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: method === 'sendMessage' ? { message_id: 99, date: 0, chat: { id: 7, type: 'private' } } : true } as never;
  });
  return envois;
}

async function rendezVous(o: { recuLe?: string; agenda?: boolean; canal?: 'telegram' | 'pwa'; date?: string; type?: string; alarme?: boolean; prive?: boolean } = {}) {
  const u = await prisma.utilisateur.upsert({ where: { nom: 'l' }, create: { nom: 'l', telegramChatId: 7n }, update: {} });
  if (o.agenda ?? true) {
    await prisma.agendaGoogle.upsert({ where: { utilisateurId: u.id }, create: { utilisateurId: u.id, etat: 'connecte', calendrierId: 'a' }, update: {} });
  }
  const c = await prisma.capture.create({
    data: {
      utilisateurId: u.id, canal: o.canal ?? 'telegram', prive: o.prive ?? false, etat: o.prive ? 'privee' : 'classee', sourceRef: `tg:7:${Math.floor(Math.random() * 1e6)}`,
      emisLe: MAINTENANT, recuLe: new Date(o.recuLe ?? '2026-10-10T07:55:00Z'), texteEcrit: 'x',
    },
  });
  const it = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: 'dentiste', nature: 'action', confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
      action: { create: { echeanceType: o.type ?? 'datee', echeanceDate: new Date(o.date ?? '2026-10-14T08:00:00Z'), alarme: o.alarme ?? false } },
    },
  });
  return { uid: u.id, captureId: c.id, itemId: it.id, sourceRef: c.sourceRef! };
}

describe('proposerAlarmes', () => {
  it('un message silencieux, en réponse au vocal, avec « Avec alarme » ; jamais deux fois', async () => {
    const r = await rendezVous();
    const bot = new Bot('0:test', { botInfo });
    const envois = intercepter(bot);
    expect(await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT })).toBe(1);
    expect(envois).toHaveLength(1);
    expect(envois[0]!.payload).toMatchObject({
      chat_id: 7, text: 'Dentiste, mercredi 14 octobre, 10:00.', disable_notification: true,
      reply_parameters: { message_id: Number(r.sourceRef.split(':')[2]), allow_sending_without_reply: true },
      reply_markup: { inline_keyboard: [[{ text: 'Avec alarme', callback_data: `alarme:1:${r.itemId}` }]] },
    });
    expect(await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT })).toBe(0);
    expect(envois).toHaveLength(1);
  });

  it('alarme déjà comprise à la voix : le message le dit et propose « Sans alarme »', async () => {
    const r = await rendezVous({ alarme: true });
    const bot = new Bot('0:test', { botInfo });
    const envois = intercepter(bot);
    await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT });
    expect(envois[0]!.payload).toMatchObject({
      text: 'Dentiste, mercredi 14 octobre, 10:00. Alarme 10 minutes avant.',
      reply_markup: { inline_keyboard: [[{ text: 'Sans alarme', callback_data: `alarme:0:${r.itemId}` }]] },
    });
  });

  it.each([
    ['une capture de plus de 15 minutes (classement tardif)', { recuLe: '2026-10-10T07:44:00Z' }],
    ['un compte sans agenda connecté', { agenda: false }],
    ['un rendez-vous déjà passé', { date: '2026-10-10T07:00:00Z' }],
    ['une action « un jour »', { type: 'jour' }],
    ['une capture venue de la PWA', { canal: 'pwa' as const }],
  ])('rien pour %s', async (_cas, o) => {
    const r = await rendezVous(o);
    const bot = new Bot('0:test', { botInfo });
    const envois = intercepter(bot);
    expect(await proposerAlarmes(r.captureId, { prisma, bot, maintenant: () => MAINTENANT })).toBe(0);
    expect(envois).toHaveLength(0);
  });
});

describe('proposerAlarmes : garanties', () => {
  it('deux exécutions simultanées : un seul message (marque posée avant l\'envoi)', async () => {
    const r = await rendezVous();
    const bot = new Bot('0:test', { botInfo });
    const envois = intercepter(bot);
    const d = { prisma, bot, maintenant: () => MAINTENANT };
    await Promise.all([proposerAlarmes(r.captureId, d), proposerAlarmes(r.captureId, d)]);
    expect(envois.filter((e) => e.method === 'sendMessage')).toHaveLength(1);
  });

  it('un titre long reste sous 12 mots, avec ou sans phrase d\'alarme', async () => {
    const t = 'appeler le notaire pour la signature du compromis de vente de la maison';
    for (const alarme of [false, true]) {
      expect(texteRendezVous(t, new Date('2026-10-14T08:00:00Z'), 'Europe/Paris', alarme).split(/\s+/).length).toBeLessThan(12);
    }
  });
});

describe('Alarmes.definir', () => {
  it('refuse une capture privée', async () => {
    const r = await rendezVous({ prive: true });
    const items = new ItemsService(prisma, TYPES, () => MAINTENANT);
    expect(await new Alarmes(prisma, items, () => MAINTENANT).definir(r.uid, r.itemId, true)).toBeNull();
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: r.itemId } })).alarme).toBe(false);
  });
});

describe('Alarmes.definir : action effacée', () => {
  it('refuse une action archivée, sans poser d\'alarme', async () => {
    const r = await rendezVous({});
    await prisma.item.update({ where: { id: r.itemId }, data: { archiveLe: MAINTENANT } });
    const items = new ItemsService(prisma, TYPES, () => MAINTENANT);
    expect(await new Alarmes(prisma, items, () => MAINTENANT).definir(r.uid, r.itemId, true)).toBeNull();
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: r.itemId } })).alarme).toBe(false);
  });
});

describe('bouton du bot', () => {
  const appui = (id: number, data: string) => ({
    update_id: id,
    callback_query: {
      id: `cb${id}`, from: { id: 7, is_bot: false, first_name: 'x' }, chat_instance: 'ci', data,
      message: { message_id: 99, date: 0, chat: { id: 7, type: 'private', first_name: 'x' }, text: 'Dentiste, mercredi 14 octobre, 10:00.' },
    },
  }) as never;

  function monter() {
    const items = new ItemsService(prisma, TYPES, () => MAINTENANT);
    const bot = creerBot('0:test', {
      liaison: new LiaisonService(prisma), ingestion: {} as IngestionService, alarmes: new Alarmes(prisma, items, () => MAINTENANT),
    }, { botInfo });
    return { bot, envois: intercepter(bot) };
  }

  it('« Avec alarme » pose l\'alarme et réécrit le message ; l\'appui relivré ne la défait pas', async () => {
    const r = await rendezVous();
    const { bot, envois } = monter();
    await bot.handleUpdate(appui(1, `alarme:1:${r.itemId}`));
    await bot.handleUpdate(appui(1, `alarme:1:${r.itemId}`));
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: r.itemId } })).alarme).toBe(true);
    const edit = envois.find((e) => e.method === 'editMessageText')!;
    expect(edit.payload).toMatchObject({
      text: 'Dentiste, mercredi 14 octobre, 10:00. Alarme 10 minutes avant.',
      reply_markup: { inline_keyboard: [[{ text: 'Sans alarme', callback_data: `alarme:0:${r.itemId}` }]] },
    });
    expect(envois.filter((e) => e.method === 'answerCallbackQuery').map((e) => e.payload.text)).toEqual(['Alarme activée.', 'Alarme activée.']);
    expect(envois.filter((e) => e.method === 'sendMessage')).toHaveLength(0);
  });

  it('« Sans alarme » la retire ; un rendez-vous d\'un autre compte ou cochée : « Ce rendez-vous a changé. »', async () => {
    const r = await rendezVous({ alarme: true });
    const { bot, envois } = monter();
    await bot.handleUpdate(appui(2, `alarme:0:${r.itemId}`));
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId: r.itemId } })).alarme).toBe(false);
    await prisma.action.update({ where: { itemId: r.itemId }, data: { faitLe: MAINTENANT } });
    await bot.handleUpdate(appui(3, `alarme:1:${r.itemId}`));
    expect(envois.filter((e) => e.method === 'answerCallbackQuery').at(-1)!.payload.text).toBe('Ce rendez-vous a changé.');
  });

  it('erreur interne : le callback est quand même acquitté, rien n\'est relancé', async () => {
    const r = await rendezVous();
    const bot = creerBot('0:test', {
      liaison: new LiaisonService(prisma), ingestion: {} as IngestionService,
      alarmes: { definir: async () => { throw new Error('panne'); } },
    }, { botInfo });
    const envois = intercepter(bot);
    await expect(bot.handleUpdate(appui(4, `alarme:1:${r.itemId}`))).resolves.toBeUndefined();
    expect(envois.filter((e) => e.method === 'answerCallbackQuery')).toHaveLength(1);
  });

  it('donnée inconnue : acquittée sans autre envoi', async () => {
    const { bot, envois } = monter();
    await bot.handleUpdate(appui(5, 'ancien:bouton'));
    expect(envois.map((e) => e.method)).toEqual(['answerCallbackQuery']);
  });
});
