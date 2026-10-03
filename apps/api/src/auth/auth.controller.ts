import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AUTH } from '../jetons.js';
import type { AuthService } from './auth.service.js';
import { cookieEfface, cookieSession, lireCookie, NOM_COOKIE } from './cookies.js';
import { LimiteurDebit } from './limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from './session.guard.js';

export const schemaConnexion = z.object({ nom: z.string().min(1).max(100), motDePasse: z.string().min(1).max(500) });

@Controller('api/session')
export class AuthController {
  private readonly limiteur = new LimiteurDebit(10, 60_000);

  constructor(@Inject(AUTH) private readonly auth: AuthService) {}

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
  moi(@Req() req: RequeteAuthentifiee): { nom: string } {
    return { nom: req.utilisateur.nom };
  }
}
