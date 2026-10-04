import { agentSortant } from '@organizer/shared';
import type { BotConfig, Context } from 'grammy';

export type OptionsClient = NonNullable<BotConfig<Context>['client']>;

/** Réglages du client grammY : racine de l'API Bot (tests) et passage par le proxy sortant (production). */
export function optionsClientTelegram(apiRoot: string | undefined, env: NodeJS.ProcessEnv = process.env): OptionsClient {
  const agent = agentSortant(env);
  return {
    ...(apiRoot ? { apiRoot } : {}),
    // compress : réglage par défaut de grammY sous Node, à garder quand on remplace baseFetchConfig.
    ...(agent ? { baseFetchConfig: { agent, compress: true } } : {}),
  };
}
