import { goto } from '$app/navigation';
import { creerClientApi } from './api.js';
import { CHEMINS } from './config.js';
import { GardeSession } from './session.js';

/** Instances uniques de l'application. Une session perdue en cours de route renvoie vers la connexion. */
function versConnexion(): void {
  const ici = location.pathname;
  if (ici !== CHEMINS.enregistreur && ici !== CHEMINS.connexion) void goto(CHEMINS.connexion);
}

export const api = creerClientApi({
  surNonConnecte: () => {
    garde.oublier();
    versConnexion();
  },
});

/** Un 401 tardif de la vérification de session renvoie aussi vers la connexion. */
export const garde = new GardeSession(api, { surDeconnecte: versConnexion });
