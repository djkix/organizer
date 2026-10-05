import { Bot, type BotConfig, type Context, Keyboard } from 'grammy';
import { extraireCapture } from '../ingestion/extraire.js';
import type { IngestionService } from '../ingestion/ingestion.service.js';
import type { LiaisonService } from './liaison.service.js';
import { clavierAlarme, MOTIF_ALARME, type Alarmes } from './propositions.js';

export const LIBELLE_PRIVEE = 'Prochaine capture privée';
const clavier = (): Keyboard => new Keyboard().text(LIBELLE_PRIVEE).resized().persistent();

export interface DepsBot { liaison: LiaisonService; ingestion: IngestionService; alarmes?: Pick<Alarmes, 'definir'> }

export function creerBot(token: string, d: DepsBot, options?: BotConfig<Context>): Bot {
  const bot = new Bot(token, options);

  bot.command('start', async (ctx) => {
    const code = ctx.match.trim();
    if (!code) {
      if (await d.liaison.utilisateurDuChat(ctx.chat.id)) await ctx.reply('Le bouton privé est revenu.', { reply_markup: clavier() });
      else await ctx.reply('Envoie /start suivi de ton code.');
      return;
    }
    const r = await d.liaison.lier(code, ctx.chat.id);
    if (r === 'lie') {
      await ctx.reply("C'est lié. Envoie un vocal quand tu veux.", { reply_markup: clavier() });
      return;
    }
    await ctx.reply('Code invalide ou expiré.');
  });

  // Bouton « Avec alarme » / « Sans alarme » : la réponse tient dans le message lui-même, rien d'autre n'est envoyé.
  bot.callbackQuery(MOTIF_ALARME, async (ctx) => {
    // Jamais relancé : une erreur ferait relivrer la mise à jour, et max_connections 1 bloquerait les vocaux suivants.
    let reponse: { text: string } | undefined;
    try {
      const [, valeur, itemId] = ctx.match as RegExpMatchArray;
      const u = ctx.chat ? await d.liaison.utilisateurDuChat(ctx.chat.id) : null;
      const r = u && d.alarmes ? await d.alarmes.definir(u.id, itemId!, valeur === '1') : null;
      if (!r) {
        reponse = { text: 'Ce rendez-vous a changé.' };
      } else {
        try {
          await ctx.editMessageText(r.texte, { reply_markup: clavierAlarme(itemId!, r.alarme) });
        } catch (e) {
          // Appui relivré : le message porte déjà ce texte.
          if (!(e as Error).message.includes('message is not modified')) throw e;
        }
        reponse = { text: r.alarme ? 'Alarme activée.' : 'Alarme retirée.' };
      }
    } catch (e) {
      console.error(`Telegram : bouton d'alarme en échec (${(e as Error).name})`);
      reponse = { text: 'Ce rendez-vous a changé.' };
    } finally {
      await ctx.answerCallbackQuery(reponse).catch((e: unknown) => console.error(`Telegram : réponse au bouton impossible (${(e as Error).name})`));
    }
  });

  // Donnée inconnue (ancien bouton) : on répond pour arrêter le sablier, sans rien faire d'autre.
  bot.on('callback_query', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => undefined);
  });

  bot.on('message', async (ctx) => {
    const u = await d.liaison.utilisateurDuChat(ctx.chat.id);
    if (!u) {
      await ctx.reply("Ce compte n'est pas lié.");
      return;
    }
    if (ctx.message.text === LIBELLE_PRIVEE) {
      try {
        await d.ingestion.armerPrivee(u.id);
      } catch (e) {
        // Telegram rejouera la mise à jour : on prévient au mieux, puis on relance l'erreur.
        await ctx.reply('Mode privé non activé. Réessaie.').catch(() => undefined);
        throw e;
      }
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
    await ctx.reply(prive ? 'Reçu. Elle reste sur le serveur.' : 'Reçu.', { reply_parameters: { message_id: ctx.message.message_id }, reply_markup: clavier() });
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
