import { chargerPrompt, cheminConfigure, exigerVar, lireVar, valeursAdmises } from '@organizer/shared';

export interface ConfigApi {
  port: number;
  redisUrl: string;
  telegramToken: string;
  telegramMode: 'polling' | 'webhook';
  webhookSecret: string | undefined;
  audioRacine: string;
  typesEcheance: string[];
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
    audioRacine: cheminConfigure('AUDIO_STORAGE_PATH', exigerVar('AUDIO_STORAGE_PATH')),
    typesEcheance: valeursAdmises(
      chargerPrompt(cheminConfigure('PROMPTS_DIR', lireVar('PROMPTS_DIR') ?? 'prompts'), lireVar('PROMPT_VERSION') ?? 'tri/v1'),
      'echeance_type',
    ),
  };
}
