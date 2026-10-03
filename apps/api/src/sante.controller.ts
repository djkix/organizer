import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { PrismaClient } from '@organizer/db';
import type { Request, Response } from 'express';
import { PRISMA, REDIS } from './jetons.js';

const DELAI_MS = 3_000;

/**
 * Sonde d'Uptime Kuma : base et file joignables. « vu » est l'adresse du client telle que l'API la voit :
 * depuis un téléphone en 4G, elle doit être son adresse publique (contrôle de TRUSTED_PROXY).
 */
@Controller('api/sante')
export class SanteController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: { ping(): Promise<string> },
  ) {}

  @Get()
  async sante(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: boolean; vu: string }> {
    let minuteur: NodeJS.Timeout | undefined;
    const delai = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error('délai')), DELAI_MS);
    });
    const ok = await Promise.race([Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]), delai])
      .then(() => true, () => false);
    clearTimeout(minuteur);
    if (!ok) res.status(503);
    return { ok, vu: req.ip ?? 'inconnue' };
  }
}
