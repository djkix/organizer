import { ErreurApi, type ClientApi } from './api.js';
import { CHEMINS } from './config.js';

export type EtatSession = { etat: 'connecte'; nom: string; admin: boolean; versionServeur: string | null } | { etat: 'deconnecte' } | { etat: 'hors-ligne' };

/** Au-delà, l'écran s'affiche sans attendre : la vérification continue en arrière-plan. */
export const DELAI_GARDE_MS = 2_500;

export interface OptionsGarde {
  delaiMs?: number;
  /** Un 401 arrivé après l'affichage de l'écran : la session est partie, retour à la connexion. */
  surDeconnecte?: () => void;
}

/**
 * Vérifie la session. Une session confirmée n'est plus revérifiée avant oublier().
 * Réseau lent ou absent : « hors ligne » au bout de 2,5 s, retenu pour la durée de la page
 * (un mot, rien de personnel) et reconfirmé en arrière-plan.
 */
export class GardeSession {
  private connue: EtatSession | null = null;
  private horsLigne = false;
  private enCours: Promise<EtatSession> | null = null;
  private generation = 0;

  constructor(private readonly api: Pick<ClientApi, 'moi'>, private readonly options: OptionsGarde = {}) {}

  async etat(): Promise<EtatSession> {
    if (this.connue) return this.connue;
    const verification = this.verifier();
    if (this.horsLigne) return { etat: 'hors-ligne' };
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const lenteur = new Promise<null>((ok) => { minuteur = setTimeout(() => ok(null), this.options.delaiMs ?? DELAI_GARDE_MS); });
    try {
      const e = await Promise.race([verification, lenteur]);
      if (e) return e;
    } finally {
      clearTimeout(minuteur);
    }
    this.horsLigne = true;
    // La vérification se poursuit : un 401 tardif est traité dans verifier().
    return { etat: 'hors-ligne' };
  }

  private verifier(): Promise<EtatSession> {
    if (this.enCours) return this.enCours;
    const generation = this.generation;
    const lancee = this.api.moi().then(
      ({ nom, admin, versionServeur }): EtatSession => ({ etat: 'connecte', nom, admin: admin === true, versionServeur: versionServeur ?? null }),
      // Seul un 401 prouve l'absence de session ; le reste n'empêche pas d'utiliser l'application.
      (e: unknown): EtatSession => (e instanceof ErreurApi && e.statut === 401 ? { etat: 'deconnecte' } : { etat: 'hors-ligne' }),
    ).then((e) => {
      if (this.enCours === lancee) this.enCours = null;
      if (generation !== this.generation) return e;
      if (e.etat === 'connecte') {
        this.connue = e;
        this.horsLigne = false;
      } else if (e.etat === 'deconnecte') {
        const tardif = this.horsLigne;
        this.horsLigne = false;
        if (tardif) this.options.surDeconnecte?.();
      } else {
        this.horsLigne = true;
      }
      return e;
    });
    this.enCours = lancee;
    return lancee;
  }

  oublier(): void {
    this.connue = null;
    this.horsLigne = false;
    this.enCours = null;
    this.generation++;
  }
}

/** Où envoyer la personne, ou null pour la laisser. L'enregistreur privé n'est jamais bloqué. */
export function redirection(chemin: string, s: EtatSession): string | null {
  if (chemin === CHEMINS.enregistreur) return null;
  if (s.etat === 'deconnecte' && chemin !== CHEMINS.connexion) return CHEMINS.connexion;
  if (s.etat === 'connecte' && chemin === CHEMINS.connexion) return CHEMINS.accueil;
  return null;
}
