import { ErreurFournisseur, FournisseurIndisponible, PalierNonPaye, type ClassificationProvider } from './classement/provider.js';

const DELAI_INITIAL_MS = 30_000;
const DELAI_MAX_MS = 15 * 60_000;

/**
 * Règle n° 8 : pas de palier payé, pas de worker. Une panne passagère (crédit épuisé,
 * réseau, 5xx) n'est pas un refus : on attend et on réessaie, sans jamais démarrer sans contrôle.
 */
export async function verifierPalierAuDemarrage(
  provider: Pick<ClassificationProvider, 'verifierPalierPaye'>,
  attendre: (ms: number) => Promise<void>,
  journal: (message: string) => void,
  alerter?: (message: string) => Promise<void>,
): Promise<void> {
  let delai = DELAI_INITIAL_MS;
  let configSignalee = false;
  for (;;) {
    try {
      await provider.verifierPalierPaye();
      return;
    } catch (e) {
      if (e instanceof PalierNonPaye) throw e;
      // Un 4xx hors indisponibilité (réflexion, modèle retiré, requête mal formée) n'est pas une panne :
      // on réessaie sans planter, mais on le dit autrement et on alerte l'administrateur une fois.
      if (e instanceof ErreurFournisseur && !(e instanceof FournisseurIndisponible) && e.statut >= 400 && e.statut < 500 && e.statut !== 408) {
        const ligne = `Configuration Gemini refusée (HTTP ${e.statut}) : vérifier GEMINI_MODEL et GEMINI_THINKING_LEVEL.`;
        journal(`${ligne} Nouvel essai dans ${delai / 1000} s.`);
        if (!configSignalee) {
          configSignalee = true;
          try {
            await alerter?.(ligne);
          } catch (err) {
            journal(`Alerte impossible (${(err as Error).name}).`);
          }
        }
        await attendre(delai);
        delai = Math.min(delai * 2, DELAI_MAX_MS);
        continue;
      }
      // Le message d'une ErreurFournisseur ne contient que le modèle et le statut HTTP.
      const raison = e instanceof ErreurFournisseur ? e.message : (e as Error).name;
      journal(`Contrôle du palier impossible (${raison}), nouvel essai dans ${delai / 1000} s.`);
      await attendre(delai);
      delai = Math.min(delai * 2, DELAI_MAX_MS);
    }
  }
}
