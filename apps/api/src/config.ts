import { lireConfigWebauthn, type ConfigWebauthn } from './auth/empreintes/config.js';
import { lireConfigAgenda, type ConfigAgendaApi } from './agenda/config.js';
import { chargerPrompt, cheminConfigure, exigerVar, lireVar, valeursAdmises } from '@organizer/shared';

export interface ConfigApi {
  port: number;
  redisUrl: string;
  telegramToken: string;
  telegramMode: 'polling' | 'webhook';
  webhookSecret: string | undefined;
  audioRacine: string;
  typesEcheance: string[];
  /** Racine de l'API Bot (tests, serveur Bot API local). Défaut : https://api.telegram.org */
  telegramApiRoot?: string;
  /** Adresse publique du webhook, pour la CLI telegram-webhook. */
  webhookUrl?: string;
  /** Empreinte (WebAuthn) : identifiant de RP et origine de la PWA. */
  webauthn: ConfigWebauthn;
  /** Client OAuth de Google Agenda ; null hors production sans GOOGLE_CLIENT_ID. */
  agenda: ConfigAgendaApi | null;
}

export function lireConfigApi(): ConfigApi {
  const mode = lireVar('TELEGRAM_MODE') ?? 'webhook';
  if (mode !== 'polling' && mode !== 'webhook') throw new Error(`TELEGRAM_MODE inconnu : ${mode}`);
  const webhookSecret = lireVar('TELEGRAM_WEBHOOK_SECRET');
  if (mode === 'webhook' && !webhookSecret) throw new Error('TELEGRAM_WEBHOOK_SECRET obligatoire en mode webhook');
  return {
    port: Number(lireVar('PORT') ?? '3000'),
    redisUrl: exigerVar('REDIS_URL'),
    telegramToken: exigerVar('TELEGRAM_BOT_TOKEN'),
    telegramMode: mode,
    webhookSecret,
    telegramApiRoot: lireVar('TELEGRAM_API_ROOT'),
    webhookUrl: lireVar('TELEGRAM_WEBHOOK_URL'),
    audioRacine: cheminConfigure('AUDIO_STORAGE_PATH', exigerVar('AUDIO_STORAGE_PATH')),
    typesEcheance: valeursAdmises(
      chargerPrompt(cheminConfigure('PROMPTS_DIR', lireVar('PROMPTS_DIR') ?? 'prompts'), lireVar('PROMPT_VERSION') ?? 'tri/v1'),
      'echeance_type',
    ),
    webauthn: lireConfigWebauthn(),
    agenda: lireConfigAgenda(),
  };
}
