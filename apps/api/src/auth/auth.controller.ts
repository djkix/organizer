import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Optional, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { lireVar } from '@organizer/shared';
import { z } from 'zod';
import { AUTH, VERROU_CONNEXION } from '../jetons.js';
import type { AuthService } from './auth.service.js';
import { ancienCookieEfface, cookieEfface, cookieSession, lireCookie, NOM_COOKIE } from './cookies.js';
import { LimiteurDebit } from './limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from './session.guard.js';
import { VerrouConnexionMemoire, type VerrouConnexion } from './verrou.js';

export const schemaConnexion = z.object({ nom: z.string().min(1).max(100), motDePasse: z.string().min(1).max(500) });

@Controller('api/session')
export class AuthController {
  private readonly limiteur = new LimiteurDebit(10, 60_000);

  private readonly verrou: VerrouConnexion;

  constructor(@Inject(AUTH) private readonly auth: AuthService, @Optional() @Inject(VERROU_CONNEXION) verrou?: VerrouConnexion) {
    this.verrou = verrou ?? new VerrouConnexionMemoire();
  }

  @Post()
  @HttpCode(204)
  async ouvrir(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() corps: unknown): Promise<void> {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
    const p = schemaConnexion.safeParse(corps);
    if (!p.success) throw new UnauthorizedException('Identifiants invalides.');
    const { nom, motDePasse } = p.data;
    // Compte verrouillé : refus sans vérifier le mot de passe, même juste.
    if (await this.verrou.bloque(nom)) throw new HttpException({ message: "Trop d'essais. Réessaie dans un quart d'heure." }, 429);
    const s = await this.auth.ouvrirSession(nom, motDePasse);
    if (!s) {
      await this.verrou.echec(nom);
      throw new UnauthorizedException('Identifiants invalides.');
    }
    await this.verrou.reussite(nom);
    res.setHeader('Set-Cookie', [cookieSession(s.jeton, s.expireLe, this.auth.maintenant()), ancienCookieEfface()]);
  }

  @Delete()
  @HttpCode(204)
  async fermer(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
    if (jeton) await this.auth.fermerSession(jeton);
    res.setHeader('Set-Cookie', [cookieEfface(), ancienCookieEfface()]);
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
