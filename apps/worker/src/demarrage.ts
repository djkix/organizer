import { ErreurFournisseur, PalierNonPaye, type ClassificationProvider } from './classement/provider.js';

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
): Promise<void> {
  let delai = DELAI_INITIAL_MS;
  for (;;) {
    try {
      await provider.verifierPalierPaye();
      return;
    } catch (e) {
      if (e instanceof PalierNonPaye) throw e;
      // Le message d'une ErreurFournisseur ne contient que le modèle et le statut HTTP.
      const raison = e instanceof ErreurFournisseur ? e.message : (e as Error).name;
      journal(`Contrôle du palier impossible (${raison}), nouvel essai dans ${delai / 1000} s.`);
      await attendre(delai);
      delai = Math.min(delai * 2, DELAI_MAX_MS);
    }
  }
}
