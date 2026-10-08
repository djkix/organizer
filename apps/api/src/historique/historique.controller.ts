import { BadRequestException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { jourLocal, type DetailEnvoi, type JourHistorique } from '@organizer/shared';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { HISTORIQUE } from '../jetons.js';
import { MoisInvalide } from '../privees/privees.service.js';
import type { HistoriqueService } from './historique.service.js';

/** Historique des envois non privés du compte de la session, en lecture seule. */
@Controller('api/historique')
@UseGuards(SessionGuard)
export class HistoriqueController {
  constructor(@Inject(HISTORIQUE) private readonly historique: HistoriqueService) {}

  @Get()
  async lister(@Req() req: RequeteAuthentifiee, @Query('mois') mois: string | undefined): Promise<JourHistorique[]> {
    try {
      return await this.historique.lister(req.utilisateur.id, mois ?? jourLocal(new Date(), req.utilisateur.fuseau).slice(0, 7), req.utilisateur.fuseau);
    } catch (e) {
      if (!(e instanceof MoisInvalide)) throw e;
      throw new BadRequestException('Mois invalide.');
    }
  }

  @Get(':id')
  async detail(@Req() req: RequeteAuthentifiee, @Param('id', ParseUUIDPipe) id: string): Promise<DetailEnvoi> {
    const d = await this.historique.detail(req.utilisateur.id, id);
    if (!d) throw new NotFoundException('Élément introuvable.');
    return d;
  }
}
