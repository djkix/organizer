import {
  Controller, Delete, Get, HttpCode, HttpException, Inject, Post, Query, Req, Res, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import type { ReponseAgenda, ReponseConnexionAgenda } from '@organizer/shared/api';
import type { Request, Response } from 'express';
import { AGENDA, AUTH } from '../jetons.js';
import type { AuthService } from '../auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../auth/cookies.js';
import { DelaiDepasse } from '../auth/empreintes/defis.js';
import { LimiteurDebit } from '../auth/limiteur.js';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { AgendaIndisponible, type AgendaService, type IssueRetour } from './agenda.service.js';

export const MESSAGE_AGENDA_INDISPONIBLE = "Google Agenda n'est pas configuré.";
const texte = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= 2048 ? v : undefined);

@Controller('api/agenda')
export class AgendaController {
  private readonly limiteur = new LimiteurDebit(10, 60_000);

  constructor(@Inject(AGENDA) private readonly agenda: AgendaService, @Inject(AUTH) private readonly auth: AuthService) {}

  @Get()
  @UseGuards(SessionGuard)
  etat(@Req() req: RequeteAuthentifiee): Promise<ReponseAgenda> {
    return this.agenda.etat(req.utilisateur.id);
  }

  @Post('connexion')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async connexion(@Req() req: RequeteAuthentifiee): Promise<ReponseConnexionAgenda> {
    if (!this.limiteur.autoriser(req.ip ?? 'inconnue')) throw new HttpException({ message: "Trop d'essais. Réessaie dans une minute." }, 429);
    try {
      return await this.agenda.demarrer(req.utilisateur.id);
    } catch (e) {
      if (e instanceof AgendaIndisponible) throw new ServiceUnavailableException(MESSAGE_AGENDA_INDISPONIBLE);
      if (e instanceof DelaiDepasse) throw new ServiceUnavailableException('Le serveur ne répond pas.');
      throw e;
    }
  }

  /** Arrivée depuis Google (navigation de premier niveau : le cookie SameSite=Lax est envoyé). Toujours vers Réglages. */
  @Get('retour')
  async retour(@Req() req: Request, @Query() q: Record<string, unknown>, @Res() res: Response): Promise<void> {
    let issue: IssueRetour = 'expire';
    if (this.limiteur.autoriser(req.ip ?? 'inconnue')) {
      try {
        const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
        const u = jeton ? await this.auth.utilisateurDeSession(jeton) : null;
        issue = await this.agenda.retour({ state: texte(q.state), code: texte(q.code), error: texte(q.error) }, u?.id ?? null);
      } catch (e) {
        // Nom d'erreur seulement : jamais la requête, qui porte le code d'autorisation.
        console.error(`Retour de Google en échec (${(e as Error).name})`);
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(303, `/reglages?agenda=${issue}`);
  }

  @Delete()
  @UseGuards(SessionGuard)
  @HttpCode(202)
  deconnecter(@Req() req: RequeteAuthentifiee): Promise<void> {
    return this.agenda.deconnecter(req.utilisateur.id);
  }
}
