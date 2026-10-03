import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Res, UseGuards,
} from '@nestjs/common';
import { NATURES } from '@organizer/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { ConfigApi } from '../config.js';
import { CONFIG, ITEMS } from '../jetons.js';
import { CorrectionInvalide, ItemIntrouvable, type ItemsService } from './items.service.js';

const dateOuNul = z.string().max(40).nullable().optional();
export const schemaCorrection = z.object({
  nature: z.enum(NATURES).optional(),
  echeance: z.object({ type: z.string().max(40), date: dateOuNul, debut: dateOuNul, fin: dateOuNul }).optional(),
}).refine((c) => c.nature !== undefined || c.echeance !== undefined);

async function traduire<T>(appel: () => Promise<T>): Promise<T> {
  try {
    return await appel();
  } catch (e) {
    if (e instanceof ItemIntrouvable) throw new NotFoundException('Élément introuvable.');
    if (e instanceof CorrectionInvalide) throw new BadRequestException(e.message);
    throw e;
  }
}

@Controller('api')
@UseGuards(SessionGuard)
export class ItemsController {
  constructor(@Inject(ITEMS) private readonly items: ItemsService, @Inject(CONFIG) private readonly config: ConfigApi) {}

  @Post('items/:id/fait')
  @HttpCode(204)
  cocher(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return traduire(() => this.items.cocher(id));
  }

  @Delete('items/:id/fait')
  @HttpCode(204)
  decocher(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return traduire(() => this.items.decocher(id));
  }

  @Patch('items/:id')
  @HttpCode(204)
  corriger(@Param('id', ParseUUIDPipe) id: string, @Body() corps: unknown): Promise<void> {
    const p = schemaCorrection.safeParse(corps);
    if (!p.success) throw new BadRequestException('Correction illisible.');
    return traduire(() => this.items.corriger(id, p.data));
  }

  @Get('captures/:id/audio')
  async audio(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const a = await this.items.cheminAudio(id, this.config.audioRacine);
    if (!a) throw new NotFoundException('Audio indisponible.');
    res.type(a.mime).sendFile(a.chemin, { root: this.config.audioRacine, dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: 'Audio indisponible.' });
    });
  }
}
