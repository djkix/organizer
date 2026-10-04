import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { BotError, webhookCallback, type Bot } from 'grammy';
import type { ConfigApi } from '../config.js';
import { BOT, CONFIG } from '../jetons.js';

@Controller()
export class TelegramController {
  /** Absent en mode polling : webhookCallback remplacerait bot.start par une fonction qui lève. */
  private readonly gestionnaire?: (req: Request, res: Response) => Promise<void>;

  private readonly secret?: string;

  constructor(@Inject(BOT) bot: Bot, @Inject(CONFIG) config: ConfigApi) {
    this.secret = config.webhookSecret;
    if (config.telegramMode === 'webhook') {
      this.gestionnaire = webhookCallback(bot, 'express', { secretToken: config.webhookSecret });
    }
  }

  @Get('health')
  sante(): { ok: true } {
    return { ok: true };
  }

  @Post('telegram/webhook')
  async recevoir(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.gestionnaire) {
      res.status(404).end();
      return;
    }
    // grammY initialise le bot (getMe) avant de vérifier le secret : on le contrôle d'abord, en temps constant.
    if (!this.secretValide(req.header('x-telegram-bot-api-secret-token'))) {
      res.status(401).end();
      return;
    }
    try {
      await this.gestionnaire(req, res);
    } catch (err) {
      // Le message d'un BotError recopie l'erreur interne, qui peut contenir le texte de la capture :
      // identifiant de mise à jour et nom d'erreur seulement. Telegram relivrera, l'ingestion est idempotente.
      const corps: unknown = req.body;
      const updateId = typeof corps === 'object' && corps !== null && typeof (corps as { update_id?: unknown }).update_id === 'number'
        ? (corps as { update_id: number }).update_id
        : 'illisible';
      const cause = err instanceof BotError ? err.error : err;
      console.error(`Webhook, mise à jour ${updateId} : ${(cause as Error).name}`);
      if (!res.headersSent) res.status(500).end();
    }
  }

  private secretValide(recu: string | undefined): boolean {
    if (!this.secret || recu === undefined) return false;
    const attendu = Buffer.from(this.secret);
    const fourni = Buffer.from(recu);
    return fourni.length === attendu.length && timingSafeEqual(fourni, attendu);
  }
}
