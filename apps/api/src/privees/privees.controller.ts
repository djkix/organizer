import { randomUUID } from 'node:crypto';
import {
  BadRequestException, Body, Controller, Get, HttpCode, HttpException, Inject, NotFoundException,
  Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { EN_TETES_CAPTURE_PRIVEE, jourLocal, type JourPrive, type ReponseDepotPrive } from '@organizer/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { PRIVEES } from '../jetons.js';
import { CapturePriveeIntrouvable, FormatRefuse, IdentifiantRefuse, MoisInvalide, type CapturesPriveesService } from './privees.service.js';
import { AudioIllisible } from './reencodeur.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const schemaEtiquette = z.object({ etiquette: z.string().trim().max(80).nullable() });

function entete(req: RequeteAuthentifiee, nom: string): string | undefined {
  const v = req.headers[nom];
  return Array.isArray(v) ? v[0] : v;
}

function emisLe(valeur: string | undefined, maintenant: Date): Date {
  const d = valeur ? new Date(valeur) : maintenant;
  return Number.isNaN(d.getTime()) || d.getTime() > maintenant.getTime() + 5 * 60_000 ? maintenant : d;
}

function duree(valeur: string | undefined): number | null {
  if (valeur === undefined || !/^\d{1,4}$/.test(valeur)) return null;
  const n = Number(valeur);
  return n <= 3600 ? n : null;
}

@Controller('api/captures/privees')
@UseGuards(SessionGuard)
export class PriveesController {
  constructor(@Inject(PRIVEES) private readonly privees: CapturesPriveesService) {}

  @Post()
  async deposer(@Req() req: RequeteAuthentifiee, @Res({ passthrough: true }) res: Response): Promise<ReponseDepotPrive> {
    const corps: unknown = req.body;
    if (!Buffer.isBuffer(corps) || corps.length === 0) throw new BadRequestException('Enregistrement vide.');
    const idDemande = entete(req, EN_TETES_CAPTURE_PRIVEE.id.toLowerCase());
    // Présent mais invalide : refus net, un identifiant aléatoire rendrait le rejeu non idempotent.
    if (idDemande !== undefined && !UUID.test(idDemande)) throw new BadRequestException('Identifiant refusé.');
    const id = idDemande ? idDemande.toLowerCase() : randomUUID();
    const mime = (entete(req, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    try {
      const r = await this.privees.enregistrer(req.utilisateur.id, {
        id, donnees: corps, mime, emisLe: emisLe(entete(req, EN_TETES_CAPTURE_PRIVEE.emisLe.toLowerCase()), new Date()), dureeS: duree(entete(req, EN_TETES_CAPTURE_PRIVEE.dureeS.toLowerCase())),
      });
      res.status(r.nouvelle ? 201 : 200);
      return { id: r.id };
    } catch (e) {
      if (e instanceof FormatRefuse) throw new HttpException({ message: 'Format audio non pris en charge.' }, 415);
      if (e instanceof AudioIllisible) throw new HttpException({ message: 'Enregistrement illisible.' }, 422);
      if (e instanceof IdentifiantRefuse) throw new BadRequestException('Identifiant refusé.');
      throw e;
    }
  }

  @Patch(':id')
  @HttpCode(204)
  async etiqueter(@Param('id', ParseUUIDPipe) id: string, @Body() corps: unknown): Promise<void> {
    const p = schemaEtiquette.safeParse(corps);
    if (!p.success) throw new BadRequestException('Étiquette de 80 caractères au plus.');
    try {
      await this.privees.etiqueter(id, p.data.etiquette || null);
    } catch (e) {
      if (!(e instanceof CapturePriveeIntrouvable)) throw e;
      throw new NotFoundException('Élément introuvable.');
    }
  }

  @Get()
  async lister(@Req() req: RequeteAuthentifiee, @Query('mois') mois: string | undefined): Promise<JourPrive[]> {
    try {
      return await this.privees.lister(mois ?? jourLocal(new Date(), req.utilisateur.fuseau).slice(0, 7), req.utilisateur.fuseau);
    } catch (e) {
      if (!(e instanceof MoisInvalide)) throw e;
      throw new BadRequestException('Mois attendu au format AAAA-MM.');
    }
  }
}
