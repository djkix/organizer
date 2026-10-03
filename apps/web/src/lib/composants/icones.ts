/** Tracés SVG 24 × 24, en trait. Jamais d'emoji comme icône (règle n° 7). */
export const TRACES = {
  cadenas: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  liste: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  reglages: ['M4 7h16', 'M4 17h16', 'M9 4v6', 'M15 14v6'],
  retour: ['M15 18l-6-6 6-6'],
  suivant: ['M9 18l6-6-6-6'],
  fermer: ['M6 6l12 12', 'M18 6L6 18'],
  lecture: ['M8 5v14l11-7z'],
  pause: ['M8 5v14', 'M16 5v14'],
  cloche: ['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z', 'M10 21h4'],
  coche: ['M5 12l5 5 9-10'],
} as const satisfies Record<string, readonly string[]>;

export type NomIcone = keyof typeof TRACES;
