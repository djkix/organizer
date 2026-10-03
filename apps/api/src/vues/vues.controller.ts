import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { VueARevoir, VueAujourdhui, VueHorizons, VueSemaine } from '@organizer/shared';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { VUES } from '../jetons.js';
import type { VuesService } from './vues.service.js';

@Controller('api/vues')
@UseGuards(SessionGuard)
export class VuesController {
  constructor(@Inject(VUES) private readonly vues: VuesService) {}

  @Get('aujourdhui')
  aujourdhui(@Req() req: RequeteAuthentifiee): Promise<VueAujourdhui> {
    return this.vues.aujourdhui(new Date(), req.utilisateur.fuseau);
  }

  @Get('semaine')
  semaine(@Req() req: RequeteAuthentifiee): Promise<VueSemaine> {
    return this.vues.semaine(new Date(), req.utilisateur.fuseau);
  }

  @Get('horizons')
  horizons(@Req() req: RequeteAuthentifiee): Promise<VueHorizons> {
    return this.vues.horizons(new Date(), req.utilisateur.fuseau);
  }

  @Get('a-revoir')
  aRevoir(): Promise<VueARevoir> {
    return this.vues.aRevoir();
  }
}
