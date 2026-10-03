import type { Bot } from 'grammy';

const DELAI_INITIAL_MS = 5_000;
const DELAI_MAX_MS = 5 * 60_000;

export interface OptionsTelegram {
  bot: Pick<Bot, 'init' | 'start'> & { api: Pick<Bot['api'], 'deleteWebhook'> };
  mode: 'polling' | 'webhook';
  attendre: (ms: number, signal: AbortSignal) => Promise<void>;
  journal: (message: string) => void;
  signal: AbortSignal;
  quitter: (code: number) => void;
}

/**
 * Prépare le bot sans jamais bloquer ni arrêter l'API : Telegram injoignable au démarrage, on réessaie
 * de 5 s à 5 min. En webhook, grammY initialise de toute façon le bot à la première mise à jour.
 */
export async function demarrerTelegram(o: OptionsTelegram): Promise<void> {
  let delai = DELAI_INITIAL_MS;
  while (!o.signal.aborted) {
    try {
      await o.bot.init();
      break;
    } catch (e) {
      // Nom d'erreur seulement : le message d'une erreur grammY peut citer l'URL, donc le jeton.
      o.journal(`Telegram injoignable (${(e as Error).name}), nouvel essai dans ${delai / 1000} s.`);
      await o.attendre(delai, o.signal);
      delai = Math.min(delai * 2, DELAI_MAX_MS);
    }
  }
  if (o.signal.aborted || o.mode !== 'polling') return;
  await o.bot.api.deleteWebhook({ drop_pending_updates: false });
  // Le polling tourne en tâche de fond : s'il meurt (jeton refusé, conflit), l'API s'arrête, délibérément.
  o.bot.start().catch((err: unknown) => {
    o.journal(`Bot Telegram arrêté : ${(err as Error).name}`);
    o.quitter(1);
  });
}

export const dormir = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resoudre) => {
    const minuteur = setTimeout(resoudre, ms);
    signal.addEventListener('abort', () => { clearTimeout(minuteur); resoudre(); }, { once: true });
  });
