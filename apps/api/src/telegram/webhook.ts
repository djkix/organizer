import type { Api } from 'grammy';

const ADRESSE = /^https:\/\/[^/\s]+\/telegram\/webhook$/;
const SECRET = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Pose le webhook : c'est l'instant de la bascule depuis le banc d'essai.
 * max_connections 1 : une mise à jour à la fois, donc « prochaine capture privée » est en pratique
 * enregistré avant le vocal suivant ; la garantie pour l'utilisatrice reste le message de confirmation
 * (dernier chemin d'une pensée voulue privée vers Gemini).
 * drop_pending_updates false : les messages arrivés pendant la bascule sont livrés, jamais jetés.
 */
export async function poserWebhook(api: Api, o: { url: string; secret: string }): Promise<void> {
  if (!ADRESSE.test(o.url)) throw new Error('TELEGRAM_WEBHOOK_URL doit être https://<domaine>/telegram/webhook');
  if (!SECRET.test(o.secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET : 1 à 256 caractères parmi A-Z, a-z, 0-9, _ et -');
  await api.setWebhook(o.url, {
    secret_token: o.secret, max_connections: 1, allowed_updates: ['message'], drop_pending_updates: false,
  });
}

/** Retour arrière : les messages en attente restent chez Telegram pour le prochain lecteur. */
export async function retirerWebhook(api: Api): Promise<void> {
  await api.deleteWebhook({ drop_pending_updates: false });
}

export async function etatWebhook(api: Api): Promise<string> {
  const i = await api.getWebhookInfo();
  const erreur = i.last_error_date
    ? `${new Date(i.last_error_date * 1000).toISOString()} ${i.last_error_message ?? ''}`.trim()
    : 'aucune';
  return [
    `adresse : ${i.url || '(aucune)'}`,
    `en attente : ${i.pending_update_count}`,
    `connexions max : ${i.max_connections ?? '-'}`,
    `dernière erreur : ${erreur}`,
  ].join('\n');
}
