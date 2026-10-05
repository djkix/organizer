import type { ReponseAgenda } from '@organizer/shared/api';
import type { ClientApi } from './api.js';
import { MESSAGES } from './messages.js';

export type RetourAgenda = 'retour' | 'refus' | 'expire';
export interface VueAgenda { ligne: string; bouton: 'connecter' | 'deconnecter' | null }

/** Issue posée par l'API dans l'adresse de retour (/reglages?agenda=…). Toute autre valeur est ignorée. */
export function lireRetour(recherche: string): RetourAgenda | null {
  const v = new URLSearchParams(recherche).get('agenda');
  return v === 'retour' || v === 'refus' || v === 'expire' ? v : null;
}

export function messageRetour(r: RetourAgenda): string | null {
  if (r === 'refus') return MESSAGES.agendaRefus;
  if (r === 'expire') return MESSAGES.agendaExpire;
  return null;
}

/** Ce que Réglages montre : une ligne d'état, et au plus un bouton. Rien n'est jamais signalé ailleurs. */
export function vueAgenda(r: ReponseAgenda): VueAgenda {
  switch (r.etat) {
    case 'indisponible': return { ligne: MESSAGES.agendaIndisponible, bouton: null };
    case 'deconnecte': return { ligne: MESSAGES.agendaDeconnecte, bouton: 'connecter' };
    case 'en_cours': return { ligne: MESSAGES.agendaEnCours, bouton: null };
    case 'connecte': return { ligne: MESSAGES.agendaConnecte, bouton: 'deconnecter' };
    case 'deconnexion': return { ligne: MESSAGES.agendaDeconnexion, bouton: null };
    case 'revoque': return { ligne: MESSAGES.agendaRevoque, bouton: 'connecter' };
    case 'agenda_supprime': return { ligne: MESSAGES.agendaSupprime, bouton: 'connecter' };
    case 'echec': return { ligne: r.erreur === 'portee_refusee' ? MESSAGES.agendaPorteeRefusee : MESSAGES.agendaEchec, bouton: 'connecter' };
  }
}

/** L'échange avec Google se fait sur le serveur en quelques secondes : on interroge tant qu'il est en cours. */
export async function attendreIssue(
  api: Pick<ClientApi, 'agenda'>, attendre: (ms: number) => Promise<void>, essais = 30, pasMs = 1000,
): Promise<ReponseAgenda> {
  let r = await api.agenda();
  for (let i = 0; i < essais && (r.etat === 'en_cours' || r.etat === 'deconnexion'); i++) {
    await attendre(pasMs);
    r = await api.agenda();
  }
  return r;
}
