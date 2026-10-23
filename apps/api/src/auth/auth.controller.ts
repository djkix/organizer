import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Logger, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { lireVar } from '@organizer/shared';
import { z } from 'zod';
import { AUTH, CLIENT_GOOGLE, VERIFICATEUR_GOOGLE } from '../jetons.js';
import type { AuthService } from './auth.service.js';
import { cookieEfface, cookieSession, lireCookie, NOM_COOKIE } from './cookies.js';
import { GoogleIndisponible, type VerificateurGoogle } from './google.js';
import { LimiteurDebit } from './limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from './session.guard.js';

export const schemaConnexionGoogle = z.object({ jeton: z.string().min(1).max(4096) });

export const schemaConnexion = z.object({ nom: z.string().min(1).max(100), motDePasse: z.string().min(1).max(500) });

@Controller('api/session')
export class AuthController {
  private readonly limiteur = new LimiteurDebit(10, 60_000);
  private readonly journal = new Logger('AuthController');

  constructor(
    @Inject(AUTH) private readonly auth: AuthService,
    @Inject(VERIFICATEUR_GOOGLE) private readonly google: VerificateurGoogle | null,
    @Inject(CLIENT_GOOGLE) private readonly clientId: string | null,
  ) {}

  @Get('google')
  configGoogle(): { clientId: string | null } {
    return { clientId: this.clientId };
  }

  /** Même limiteur, même session que le mot de passe. Un seul message de refus, quelle qu'en soit la cause.
   *  Certificats de Google injoignables : 503, pour que L passe au mot de passe et que djkix en ait trace. */
  @Post('google')
  @HttpCode(204)
  async ouvrirGoogle(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corps: unknown): Promise<void> {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
    const p = schemaConnexionGoogle.safeParse(corps);
    const profil = p.success && this.google ? await this.google.verifier(p.data.jeton).catch((err: unknown) => {
      if (!(err instanceof GoogleIndisponible)) throw err;
      // Ni jeton, ni adresse, ni sub : seulement le code de jose.
      this.journal.warn(`Connexion Google : certificats injoignables (${err.code})`);
      throw new HttpException({ message: 'Google indisponible. Utilise ton mot de passe.' }, 503);
    }) : null;
    const s = profil ? await this.auth.ouvrirSessionGoogle(profil) : null;
    if (!s) throw new UnauthorizedException("Ce compte Google n'est pas reconnu.");
    res.setHeader('Set-Cookie', cookieSession(s.jeton, s.expireLe, this.auth.maintenant()));
  }

  @Post()
  @HttpCode(204)
  async ouvrir(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corps: unknown): Promise<void> {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
    const p = schemaConnexion.safeParse(corps);
    const s = p.success ? await this.auth.ouvrirSession(p.data.nom, p.data.motDePasse) : null;
    if (!s) throw new UnauthorizedException('Identifiants invalides.');
    res.setHeader('Set-Cookie', cookieSession(s.jeton, s.expireLe, this.auth.maintenant()));
  }

  @Delete()
  @HttpCode(204)
  async fermer(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
    if (jeton) await this.auth.fermerSession(jeton);
    res.setHeader('Set-Cookie', cookieEfface());
  }

  @Get('moi')
  @UseGuards(SessionGuard)
  moi(@Req() req: RequeteAuthentifiee): { nom: string; admin: boolean; versionServeur: string } {
    const { nom, admin } = req.utilisateur;
    // La version sort pour les deux comptes : la PWA la compare à la sienne pour proposer « Recharger ».
    // Elle n'est affichée dans Réglages que pour l'administrateur.
    return { nom, admin, versionServeur: lireVar('ORGANIZER_VERSION') ?? 'dev' };
  }
}
