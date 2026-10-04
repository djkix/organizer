import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DELAI_ENVOI_PRIVE_MAX_MS, lireVar, TAILLE_MAX_CAPTURE_PRIVEE } from '@organizer/shared';
import { json, raw, type NextFunction, type Request, type Response } from 'express';
import type { AuthService } from './auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from './auth/cookies.js';
import { AUTH } from './jetons.js';
import { LimiteurDebit } from './auth/limiteur.js';
import { erreurDeCorps, FiltreSansContenu } from './erreurs.js';

export const TAILLE_MAX_AUDIO = TAILLE_MAX_CAPTURE_PRIVEE;

/**
 * Adresses dont X-Forwarded-For est cru : en production, le sous-réseau de Caddy et l'IP du Nginx Proxy Manager.
 * Absent en production : arrêt, sinon les limiteurs verraient tout le monde derrière une seule adresse.
 */
export function lireConfianceProxy(env: NodeJS.ProcessEnv = process.env): string {
  const valeur = lireVar('TRUSTED_PROXY', env);
  if (valeur) return valeur;
  if (env.NODE_ENV === 'production') {
    throw new Error('TRUSTED_PROXY obligatoire en production : sous-réseau de Caddy et adresse du Nginx Proxy Manager');
  }
  return 'loopback';
}

/**
 * Node coupe une requête au bout de 5 min par défaut : une capture d'une heure sur un réseau lent
 * en demande jusqu'à DELAI_ENVOI_PRIVE_MAX_MS. Keep-alive au-delà des 2 min de Caddy.
 */
export function configurerServeur(serveur: Server): void {
  serveur.requestTimeout = DELAI_ENVOI_PRIVE_MAX_MS + 60_000;
  serveur.keepAliveTimeout = 130_000;
  serveur.headersTimeout = 135_000;
}

/** Configuration HTTP commune à la production et aux tests. */
export function configurerApp(app: NestExpressApplication): void {
  // X-Forwarded-For n'est cru que des adresses de TRUSTED_PROXY, sinon n'importe qui le falsifierait.
  app.set('trust proxy', lireConfianceProxy());
  // Aucune réponse de l'API (listes, audio privé compris) ne doit rester dans un cache HTTP.
  app.use('/api', (_req: Request, res: Response, suite: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    suite();
  });
  const limiteur = new LimiteurDebit(60, 60_000);
  app.use('/api', (req: Request, res: Response, suite: NextFunction) => {
    if (limiteur.autoriser(req.ip ?? 'inconnue')) return suite();
    res.status(429).json({ message: 'Trop de requêtes. Réessaie dans une minute.' });
  });
  const audio = raw({ type: () => true, limit: TAILLE_MAX_AUDIO });
  app.use('/api/captures/privees', (req: Request, res: Response, suite: NextFunction) => {
    if (req.method !== 'POST' || req.path !== '/') return suite();
    // Session valide exigée avant de lire jusqu'à 30 Mio : même vérification que SessionGuard.
    const jeton = lireCookie(req.headers.cookie, NOM_COOKIE);
    const refuser = (): void => {
      res.status(401).json({ message: 'Connecte-toi pour continuer.' });
    };
    if (!jeton) return refuser();
    app.get<AuthService>(AUTH, { strict: false }).utilisateurDeSession(jeton).then(
      (u) => (u ? audio(req, res, suite) : refuser()),
      suite,
    );
  });
  app.use(json({ limit: '1mb' }));
  app.use(erreurDeCorps);
  app.useGlobalFilters(new FiltreSansContenu(app.getHttpAdapter()));
}
