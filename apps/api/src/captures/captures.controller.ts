import { randomUUID } from 'node:crypto';
import { BadRequestException, Controller, HttpException, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { EN_TETES_CAPTURE_PRIVEE, type ReponseDepotPrive } from '@organizer/shared';
import type { Response } from 'express';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { CAPTURES } from '../jetons.js';
import { duree, emisLe, entete } from '../privees/privees.controller.js';
import { FormatRefuse, IdentifiantRefuse } from '../privees/privees.service.js';
import { AudioIllisible, ServeurOccupe } from '../privees/reencodeur.js';
import type { CapturesOrdinairesService } from './captures.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** POST /api/captures : mêmes en-têtes et mêmes erreurs que /api/captures/privees, mais capture ordinaire, canal pwa. */
@Controller('api/captures')
@UseGuards(SessionGuard)
export class CapturesController {
  constructor(@Inject(CAPTURES) private readonly captures: CapturesOrdinairesService) {}

  @Post()
  async deposer(@Req() req: RequeteAuthentifiee, @Res({ passthrough: true }) res: Response): Promise<ReponseDepotPrive> {
    const corps: unknown = req.body;
    if (!Buffer.isBuffer(corps) || corps.length === 0) throw new BadRequestException('Enregistrement vide.');
    const idDemande = entete(req, EN_TETES_CAPTURE_PRIVEE.id.toLowerCase());
    if (idDemande !== undefined && !UUID.test(idDemande)) throw new BadRequestException('Identifiant refusé.');
    const id = idDemande ? idDemande.toLowerCase() : randomUUID();
    const mime = (entete(req, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    try {
      const r = await this.captures.enregistrer(req.utilisateur.id, {
        id, donnees: corps, mime, emisLe: emisLe(entete(req, EN_TETES_CAPTURE_PRIVEE.emisLe.toLowerCase()), new Date()), dureeS: duree(entete(req, EN_TETES_CAPTURE_PRIVEE.dureeS.toLowerCase())),
      });
      res.status(r.nouvelle ? 201 : 200);
      return { id: r.id };
    } catch (e) {
      if (e instanceof FormatRefuse) throw new HttpException({ message: 'Format audio non pris en charge.' }, 415);
      if (e instanceof AudioIllisible) throw new HttpException({ message: 'Enregistrement illisible.' }, 422);
      if (e instanceof IdentifiantRefuse) throw new BadRequestException('Identifiant refusé.');
      if (e instanceof ServeurOccupe) throw new HttpException({ message: 'Serveur occupé. Réessaie plus tard.' }, 503);
      throw e;
    }
  }
}
