import type { EnvoiHistorique } from '@organizer/shared/api';
import { describe, expect, it } from 'vitest';
import { libelleSource, libelleStatut, pastillesEnvoi } from '../src/lib/historique.js';

const envoi = (plus: Partial<EnvoiHistorique> = {}): EnvoiHistorique => ({
  id: 'e1', heure: '12:05', source: 'pwa', vocal: true, dureeS: 42, debut: 'Appeler le garage.', etat: 'classee', natures: ['action'], ...plus,
});

describe('historique : présentation', () => {
  it('source : vocal de l\'app, vocal Telegram, écrit ; la durée suit un vocal', () => {
    expect(libelleSource(envoi())).toBe('Vocal · 42 s');
    expect(libelleSource(envoi({ source: 'telegram', dureeS: 75 }))).toBe('Vocal, Telegram · 1 min 15');
    expect(libelleSource(envoi({ source: 'telegram', vocal: false, dureeS: null }))).toBe('Écrit');
    expect(libelleSource(envoi({ dureeS: null }))).toBe('Vocal');
  });

  it('pastilles : une par nature, sans nombre ; « En cours de tri » tant que ce n\'est pas fini', () => {
    expect(pastillesEnvoi(envoi({ natures: ['action', 'pensee', 'information', 'ambigu'] })).map((p) => p.libelle))
      .toEqual(['Action', 'Pensée', 'Info', 'À revoir']);
    expect(pastillesEnvoi(envoi({ etat: 'en_cours', natures: [] })).map((p) => p.libelle)).toEqual(['En cours de tri']);
    expect(pastillesEnvoi(envoi({ etat: 'a_revoir', natures: [] })).map((p) => p.libelle)).toEqual(['À revoir']);
    expect(pastillesEnvoi(envoi({ natures: [] }))).toEqual([]);
  });

  it('statut d\'un élément en mots ; rien pour une pensée ou une information', () => {
    expect(libelleStatut('a_faire')).toBe('À faire');
    expect(libelleStatut('fait')).toBe('Fait');
    expect(libelleStatut('efface')).toBe('Effacé');
    expect(libelleStatut('note')).toBeNull();
  });
});
