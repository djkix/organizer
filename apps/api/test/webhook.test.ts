import { Api } from 'grammy';
import { describe, expect, it } from 'vitest';
import { etatWebhook, poserWebhook, retirerWebhook } from '../src/telegram/webhook.js';

function api(resultat: unknown = true) {
  const appels: { method: string; payload: unknown }[] = [];
  const a = new Api('0:test');
  a.config.use(async (_prev, method, payload) => {
    appels.push({ method, payload });
    return { ok: true, result: resultat } as never;
  });
  return { a, appels };
}

const URL_BOT = 'https://organizer-bot.djkix.ovh/telegram/webhook';

describe('webhook Telegram', () => {
  it('pose le webhook avec le secret, une seule connexion, sans perdre les messages en attente', async () => {
    const { a, appels } = api();
    await poserWebhook(a, { url: URL_BOT, secret: 'abc_DEF-123' });
    expect(appels).toEqual([{
      method: 'setWebhook',
      payload: { url: URL_BOT, secret_token: 'abc_DEF-123', max_connections: 1, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false },
    }]);
  });

  it('refuse une adresse qui n\'est pas https://…/telegram/webhook, ou un secret hors de l\'alphabet de Telegram', async () => {
    const { a, appels } = api();
    await expect(poserWebhook(a, { url: 'http://organizer-bot.djkix.ovh/telegram/webhook', secret: 'abc' })).rejects.toThrow('TELEGRAM_WEBHOOK_URL');
    await expect(poserWebhook(a, { url: 'https://organizer.djkix.ovh/api', secret: 'abc' })).rejects.toThrow('TELEGRAM_WEBHOOK_URL');
    await expect(poserWebhook(a, { url: URL_BOT, secret: 'pas de blanc' })).rejects.toThrow('TELEGRAM_WEBHOOK_SECRET');
    expect(appels).toEqual([]);
  });

  it('retirer garde les messages en attente', async () => {
    const { a, appels } = api();
    await retirerWebhook(a);
    expect(appels).toEqual([{ method: 'deleteWebhook', payload: { drop_pending_updates: false } }]);
  });

  it('état : adresse, messages en attente, connexions, dernière erreur', async () => {
    const { a } = api({
      url: URL_BOT, has_custom_certificate: false, pending_update_count: 3, max_connections: 1,
      last_error_date: 1_791_270_720, last_error_message: 'Wrong response from the webhook: 500 Internal Server Error',
    });
    const etat = await etatWebhook(a);
    expect(etat).toContain(`adresse : ${URL_BOT}`);
    expect(etat).toContain('en attente : 3');
    expect(etat).toContain('connexions max : 1');
    expect(etat).toContain('500 Internal Server Error');
  });

  it('état sans webhook : polling ou rien', async () => {
    const { a } = api({ url: '', has_custom_certificate: false, pending_update_count: 0 });
    const etat = await etatWebhook(a);
    expect(etat).toContain('adresse : (aucune)');
    expect(etat).toContain('dernière erreur : aucune');
  });
});
