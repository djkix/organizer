import { Bot, type BotConfig, type Context, Keyboard } from 'grammy';
import { extraireCapture } from '../ingestion/extraire.js';
import type { IngestionService } from '../ingestion/ingestion.service.js';
import type { LiaisonService } from './liaison.service.js';

export const LIBELLE_PRIVEE = 'Prochaine capture privée';
const clavier = (): Keyboard => new Keyboard().text(LIBELLE_PRIVEE).resized().persistent();

export interface DepsBot { liaison: LiaisonService; ingestion: IngestionService }

export function creerBot(token: string, d: DepsBot, options?: BotConfig<Context>): Bot {
  const bot = new Bot(token, options);

  bot.command('start', async (ctx) => {
    const code = ctx.match.trim();
    if (!code) {
      await ctx.reply('Envoie /start suivi de ton code.');
      return;
    }
    const r = await d.liaison.lier(code, ctx.chat.id);
    if (r === 'lie') {
      await ctx.reply("C'est lié. Envoie un vocal quand tu veux.", { reply_markup: clavier() });
      return;
    }
    await ctx.reply('Code invalide ou expiré.');
  });

  bot.on('message', async (ctx) => {
    const u = await d.liaison.utilisateurDuChat(ctx.chat.id);
    if (!u) {
      await ctx.reply("Ce compte n'est pas lié.");
      return;
    }
    if (ctx.message.text === LIBELLE_PRIVEE) {
      await d.ingestion.armerPrivee(u.id);
      await ctx.reply('La prochaine capture reste sur le serveur.');
      return;
    }
    const e = extraireCapture(ctx.message);
    if (!e) {
      if (!ctx.message.text?.startsWith('/')) await ctx.reply('Je garde seulement la voix et le texte.');
      return;
    }
    const { id, nouvelle, prive } = await d.ingestion.recevoir(u.id, e);
    if (!nouvelle) return;
    await ctx.reply(prive ? 'Reçu. Elle reste sur le serveur.' : 'Reçu.', { reply_parameters: { message_id: ctx.message.message_id } });
    // Pas d'attente : l'accusé part avant le téléchargement (CAP-03). La reprise rattrape un échec.
    const suite = prive ? d.ingestion.finaliserPrivee(id) : d.ingestion.finaliser(id);
    void suite.catch((err: unknown) => {
      console.error(`Capture ${id} : finalisation reportée (${(err as Error).name})`);
    });
  });

  bot.catch((err) => {
    // Jamais le contenu du message : identifiant de mise à jour et nom d'erreur seulement.
    console.error(`Mise à jour ${err.ctx.update.update_id} : ${(err.error as Error).name}`);
  });
  return bot;
}
