import { ErreurApi, type ClientApi } from './api.js';
import { CHEMINS } from './config.js';

export type EtatSession = { etat: 'connecte'; nom: string } | { etat: 'deconnecte' } | { etat: 'hors-ligne' };

/** Vérifie la session une fois ; une session confirmée n'est plus revérifiée avant oublier(). */
export class GardeSession {
  private connue: EtatSession | null = null;

  constructor(private readonly api: Pick<ClientApi, 'moi'>) {}

  async etat(): Promise<EtatSession> {
    if (this.connue) return this.connue;
    try {
      const { nom } = await this.api.moi();
      this.connue = { etat: 'connecte', nom };
      return this.connue;
    } catch (e) {
      // Seul un 401 prouve l'absence de session ; le reste n'empêche pas d'utiliser l'application.
      return e instanceof ErreurApi && e.statut === 401 ? { etat: 'deconnecte' } : { etat: 'hors-ligne' };
    }
  }

  oublier(): void {
    this.connue = null;
  }
}

/** Où envoyer la personne, ou null pour la laisser. L'enregistreur privé n'est jamais bloqué. */
export function redirection(chemin: string, s: EtatSession): string | null {
  if (chemin === CHEMINS.enregistreur) return null;
  if (s.etat === 'deconnecte' && chemin !== CHEMINS.connexion) return CHEMINS.connexion;
  if (s.etat === 'connecte' && chemin === CHEMINS.connexion) return CHEMINS.accueil;
  return null;
}
