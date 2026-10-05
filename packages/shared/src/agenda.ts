/**
 * Portée OAuth demandée à Google : seulement les agendas créés par l'application.
 * Définie ici une seule fois ; l'API et le scheduler l'importent.
 */
export const PORTEE_AGENDA = 'https://www.googleapis.com/auth/calendar.app.created';

/** Titre court d'un événement ou d'un message : le texte de l'action, coupé à un mot, « … » final. */
export function titreCourt(texte: string, max = 60): string {
  const t = texte.trim().replace(/\s+/g, ' ');
  if (t.length === 0) return 'Rendez-vous';
  if (t.length <= max) return t;
  const coupe = t.slice(0, max - 1);
  const espace = coupe.lastIndexOf(' ');
  return `${espace > 0 ? coupe.slice(0, espace) : coupe}…`;
}
