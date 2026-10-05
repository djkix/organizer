import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, HttpException, Inject, NotFoundException,
  Param, Post, Req, Res, ServiceUnavailableException, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { ResumeEmpreinte } from '@organizer/shared/api';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AUTH, EMPREINTES } from '../../jetons.js';
import type { AuthService } from '../auth.service.js';
import { cookieSession } from '../cookies.js';
import { LimiteurDebit } from '../limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from '../session.guard.js';
import { DelaiDepasse } from './defis.js';
import { MAX_CLES_PAR_COMPTE, TropDeCles, type EmpreintesService } from './empreintes.service.js';
import { schemaConnexionEmpreinte, schemaInscription } from './schemas.js';

export const MESSAGE_REFUS = 'Empreinte non reconnue. Essaie ton mot de passe.';
export const MESSAGE_TROP = `${MAX_CLES_PAR_COMPTE} empreintes au plus. Retires-en une.`;
export const MESSAGE_INDISPONIBLE = 'Empreinte indisponible. Essaie ton mot de passe.';

/** Valkey muet : refus court et propre (503), jamais une 500 ; le mot de passe reste possible. */
async function sansPanne<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof DelaiDepasse) throw new ServiceUnavailableException(MESSAGE_INDISPONIBLE);
    throw err;
  }
}

@Controller('api')
export class EmpreintesController {
  /** Même plafond que le mot de passe : 10 essais par minute et par IP, sur chaque POST d'empreinte. */
  private readonly limiteur = new LimiteurDebit(10, 60_000);

  constructor(
    @Inject(EMPREINTES) private readonly empreintes: EmpreintesService,
    @Inject(AUTH) private readonly auth: AuthService,
  ) {}

  private limiter(req: Request): void {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
  }

  @Post('session/empreinte/options')
  @HttpCode(200)
  optionsConnexion(@Req() req: Request): Promise<PublicKeyCredentialRequestOptionsJSON> {
    this.limiter(req);
    return sansPanne(() => this.empreintes.optionsConnexion());
  }

  @Post('session/empreinte')
  @HttpCode(204)
  async connecter(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corps: unknown): Promise<void> {
    this.limiter(req);
    const p = schemaConnexionEmpreinte.safeParse(corps);
    // Forme vérifiée ici ; la bibliothèque revérifie tout, signature comprise.
    const utilisateurId = p.success ? await sansPanne(() => this.empreintes.verifierConnexion(p.data)) : null;
    if (!utilisateurId) throw new UnauthorizedException(MESSAGE_REFUS);
    const s = await this.auth.ouvrirSessionPour(utilisateurId);
    res.setHeader('Set-Cookie', cookieSession(s.jeton, s.expireLe, this.auth.maintenant()));
  }

  @Get('empreintes')
  @UseGuards(SessionGuard)
  lister(@Req() req: RequeteAuthentifiee): Promise<ResumeEmpreinte[]> {
    return this.empreintes.lister(req.utilisateur.id);
  }

  @Post('empreintes/options')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async optionsInscription(@Req() req: RequeteAuthentifiee): Promise<PublicKeyCredentialCreationOptionsJSON> {
    this.limiter(req);
    try {
      return await sansPanne(() => this.empreintes.optionsInscription(req.utilisateur));
    } catch (err) {
      if (err instanceof TropDeCles) throw new ConflictException(MESSAGE_TROP);
      throw err;
    }
  }

  @Post('empreintes')
  @UseGuards(SessionGuard)
  @HttpCode(201)
  async inscrire(@Req() req: RequeteAuthentifiee, @Body() corps: unknown): Promise<ResumeEmpreinte> {
    this.limiter(req);
    const p = schemaInscription.safeParse(corps);
    const cle = p.success ? await sansPanne(() => this.empreintes.inscrire(req.utilisateur, p.data)) : null;
    if (!cle) throw new BadRequestException('Empreinte non activée. Réessaie.');
    return cle;
  }

  @Delete('empreintes/:id')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async retirer(@Req() req: RequeteAuthentifiee, @Param('id') id: string): Promise<void> {
    const retiree = z.uuid().safeParse(id).success && (await this.empreintes.retirer(req.utilisateur.id, id));
    if (!retiree) throw new NotFoundException('Empreinte introuvable.');
  }
}
