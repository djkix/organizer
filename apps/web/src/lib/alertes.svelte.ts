import { api, garde } from './client.js';

/** Une alerte technique attend-elle l'admin ? Jamais vrai pour un autre compte (aucune requête n'est faite). */
export const etatAlertes = $state({ nonVues: false });

export async function rafraichirAlertes(): Promise<void> {
  try {
    const s = await garde.etat();
    if (s.etat !== 'connecte' || !s.admin) { etatAlertes.nonVues = false; return; }
    etatAlertes.nonVues = (await api.alertes()).nonVues;
  } catch {
    // Hors ligne : le point reste tel quel, il sera revu au retour.
  }
}
