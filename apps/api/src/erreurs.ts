import { Catch, HttpException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';

/**
 * Erreur inattendue : nom et route seulement, jamais le message ni la pile.
 * Une erreur Prisma ou Postgres peut recopier des valeurs, donc du texte de capture.
 * Les erreurs HTTP prévues (400, 401, 404…) gardent la réponse par défaut de NestJS.
 */
@Catch()
export class FiltreSansContenu extends BaseExceptionFilter {
  override catch(erreur: unknown, hote: ArgumentsHost): void {
    if (erreur instanceof HttpException) {
      super.catch(erreur, hote);
      return;
    }
    const http = hote.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const nom = erreur instanceof Error ? erreur.name : 'inconnue';
    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
    console.error(`Erreur ${nom} sur ${req.method} ${route}`);
    if (!res.headersSent) res.status(500).json({ statusCode: 500, message: 'Erreur interne.' });
  }
}

/** Erreurs des analyseurs de corps (JSON illisible, corps trop gros) : leur message d'origine cite le corps. */
export function erreurDeCorps(erreur: unknown, req: Request, res: Response, suite: NextFunction): void {
  if (res.headersSent) {
    suite(erreur);
    return;
  }
  const e = erreur as { status?: number; type?: string; name?: string };
  const statut = e.status === 413 ? 413 : e.status !== undefined && e.status >= 400 && e.status < 500 ? e.status : 400;
  console.error(`Requête refusée sur ${req.method} ${req.path} : ${e.type ?? e.name ?? 'erreur'}`);
  res.status(statut).json({ message: statut === 413 ? 'Requête trop grosse.' : 'Requête illisible.' });
}
