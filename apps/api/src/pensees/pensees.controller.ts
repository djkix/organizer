import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { jourLocal, type VuePensees } from '@organizer/shared';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { PENSEES } from '../jetons.js';
import { MoisInvalide } from '../privees/privees.service.js';
import type { PenseesService } from './pensees.service.js';

const court = (v: string | undefined): string | undefined => (v && v.length <= 80 ? v : undefined);

@Controller('api/pensees')
@UseGuards(SessionGuard)
export class PenseesController {
  constructor(@Inject(PENSEES) private readonly pensees: PenseesService) {}

  @Get()
  async lister(
    @Req() req: RequeteAuthentifiee,
    @Query('mois') mois: string | undefined, @Query('theme') theme: string | undefined, @Query('personne') personne: string | undefined,
  ): Promise<VuePensees> {
    try {
      return await this.pensees.lister(
        req.utilisateur.id, mois ?? jourLocal(new Date(), req.utilisateur.fuseau).slice(0, 7), req.utilisateur.fuseau,
        { theme: court(theme), personne: court(personne) },
      );
    } catch (e) {
      if (!(e instanceof MoisInvalide)) throw e;
      throw new BadRequestException('Mois invalide.');
    }
  }
}
