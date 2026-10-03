import type { NestExpressApplication } from '@nestjs/platform-express';
import { lireVar } from '@organizer/shared';
import { json, raw, type NextFunction, type Request, type Response } from 'express';
import { LimiteurDebit } from './auth/limiteur.js';

export const TAILLE_MAX_AUDIO = '30mb';

/** Configuration HTTP commune à la production et aux tests. */
export function configurerApp(app: NestExpressApplication): void {
  // X-Forwarded-For n'est cru que de l'adresse du proxy (TRUSTED_PROXY), sinon n'importe qui le falsifierait.
  app.set('trust proxy', lireVar('TRUSTED_PROXY') ?? 'loopback');
  const limiteur = new LimiteurDebit(60, 60_000);
  app.use('/api', (req: Request, res: Response, suite: NextFunction) => {
    if (limiteur.autoriser(req.ip ?? 'inconnue')) return suite();
    res.status(429).json({ message: 'Trop de requêtes. Réessaie dans une minute.' });
  });
  const audio = raw({ type: () => true, limit: TAILLE_MAX_AUDIO });
  app.use('/api/captures/privees', (req: Request, res: Response, suite: NextFunction) =>
    req.method === 'POST' && req.path === '/' ? audio(req, res, suite) : suite());
  app.use(json({ limit: '1mb' }));
}
