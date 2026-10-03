import type { TriSortie } from '../src/tri.js';

/** Sortie de tri fabriquée, conforme à tri/v1. Aucun énoncé réel. */
export function sortieExemple(): TriSortie {
  return {
    transcription: "rappeler le garage jeudi, et je crois que je dis oui trop vite",
    items: [
      {
        position: 1, texte: 'rappeler le garage jeudi', nature: 'action',
        echeance_type: 'jour', echeance_expr: 'jeudi', echeance_date: '2026-10-08T00:00:00+02:00',
        fenetre_debut: null, fenetre_fin: null, importance: 'normale', effort: 'moins_5min',
        contexte: 'appel', alarme: false, alarme_expr: null, tonalite: null,
        personnes: [], theme: 'Voiture', confiance: { nature: 0.95, echeance: 0.9, theme: 0.8 },
      },
      {
        position: 2, texte: 'je crois que je dis oui trop vite', nature: 'pensee',
        echeance_type: null, echeance_expr: null, echeance_date: null,
        fenetre_debut: null, fenetre_fin: null, importance: null, effort: null,
        contexte: null, alarme: null, alarme_expr: null, tonalite: 'constat',
        personnes: [], theme: 'moi', confiance: { nature: 0.9, echeance: null, theme: 0.85 },
      },
    ],
  };
}
