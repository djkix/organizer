import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { webhookCallback, type Bot } from 'grammy';
import type { ConfigApi } from '../config.js';
import { BOT, CONFIG } from '../jetons.js';

@Controller()
export class TelegramController {
  private readonly gestionnaire: (req: Request, res: Response) => Promise<void>;

  constructor(@Inject(BOT) bot: Bot, @Inject(CONFIG) config: ConfigApi) {
    this.gestionnaire = webhookCallback(bot, 'express', { secretToken: config.webhookSecret });
  }

  @Get('health')
  sante(): { ok: true } {
    return { ok: true };
  }

  @Post('telegram/webhook')
  async recevoir(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.gestionnaire(req, res);
  }
}
