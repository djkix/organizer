import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AUTH } from '../jetons.js';
import type { AuthService, UtilisateurSession } from './auth.service.js';
import { lireCookie, NOM_COOKIE } from './cookies.js';

export interface RequeteAuthentifiee extends Request { utilisateur: UtilisateurSession }

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: AuthService) {}

  async canActivate(contexte: ExecutionContext): Promise<boolean> {
    const req = contexte.switchToHttp().getRequest<RequeteAuthentifiee>();
    const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
    const u = jeton ? await this.auth.utilisateurDeSession(jeton) : null;
    if (!u) throw new UnauthorizedException('Connecte-toi pour continuer.');
    req.utilisateur = u;
    return true;
  }
}
