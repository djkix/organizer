import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Req, Res, UseGuards,
} from '@nestjs/common';
import { NATURES } from '@organizer/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import type { ConfigApi } from '../config.js';
import { CONFIG, ITEMS } from '../jetons.js';
import { CorrectionInvalide, ItemIntrouvable, type ItemsService } from './items.service.js';

const dateOuNul = z.string().max(40).nullable().optional();
export const schemaCorrection = z.object({
  nature: z.enum(NATURES).optional(),
  echeance: z.object({ type: z.string().max(40), date: dateOuNul, debut: dateOuNul, fin: dateOuNul }).optional(),
  alarme: z.boolean().optional(),
}).refine((c) => c.nature !== undefined || c.echeance !== undefined || c.alarme !== undefined);

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
  cocher(@Req() req: RequeteAuthentifiee, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return traduire(() => this.items.cocher(req.utilisateur.id, id));
  }

  @Delete('items/:id/fait')
  @HttpCode(204)
  decocher(@Req() req: RequeteAuthentifiee, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return traduire(() => this.items.decocher(req.utilisateur.id, id));
  }

  @Patch('items/:id')
  @HttpCode(204)
  corriger(@Req() req: RequeteAuthentifiee, @Param('id', ParseUUIDPipe) id: string, @Body() corps: unknown): Promise<void> {
    const p = schemaCorrection.safeParse(corps);
    if (!p.success) throw new BadRequestException('Correction illisible.');
    return traduire(() => this.items.corriger(req.utilisateur.id, id, p.data));
  }

  @Get('captures/:id/audio')
  async audio(@Req() req: RequeteAuthentifiee, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const a = await this.items.cheminAudio(req.utilisateur.id, id, this.config.audioRacine);
    if (!a) throw new NotFoundException('Audio indisponible.');
    res.type(a.mime).sendFile(a.chemin, { root: this.config.audioRacine, dotfiles: 'allow', cacheControl: false }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: 'Audio indisponible.' });
    });
  }
}
