import { api } from './client.js';
import { enregistrerSW, type ActiverSW, type Enregistreur } from './pwa/enregistrement.js';
import { rechargerMaintenant, suivreMaj } from './pwa/maj.js';
import { ecartVersion } from './version.js';

/**
 * Deux signaux, aucun ne suffit seul : une nouvelle coquille téléchargée qui attend d'être activée,
 * et un écart entre la version chargée et celle du serveur (cache périmé, worker qui n'a rien vu).
 */
export const etatMaj = $state({ enAttente: false, versionServeur: null as string | null });

let activer: ActiverSW = async () => undefined;
let verifierSW = (): void => undefined;

/** Enregistre le service worker et retient de quoi l'activer. Une seule fois, au démarrage. */
export function brancherMaj(enregistrer: Enregistreur): void {
  activer = enregistrerSW(enregistrer, {
    surEnAttente: () => { etatMaj.enAttente = true; },
    surEnregistre: (v) => { verifierSW = v; },
  });
}

/** Installe les revérifications ; rend la fonction de démontage. */
export const suivre = (): (() => void) => suivreMaj({
  verifierSW: () => verifierSW(),
  versionServeur: async () => (await api.moi()).versionServeur ?? null,
  surVersion: (v) => { etatMaj.versionServeur = v; },
  doc: document,
});

/** Le numéro proposé, quand c'est le serveur qui l'annonce ; le worker, lui, ne dit pas le sien. */
export const versionProposee = (): string | null =>
  (ecartVersion(__VERSION_PWA__, etatMaj.versionServeur) ? etatMaj.versionServeur : null);

export const majProposee = (): boolean => etatMaj.enAttente || versionProposee() !== null;

export const recharger = (): void => rechargerMaintenant(() => activer(), () => location.reload());
