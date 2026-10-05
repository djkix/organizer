import type { ReponseAgenda } from '@organizer/shared/api';
import { describe, expect, it } from 'vitest';
import { attendreIssue, lireRetour, messageRetour, vueAgenda } from '../src/lib/agenda.js';
import { MESSAGES } from '../src/lib/messages.js';

describe('lireRetour', () => {
  it('ne reconnaît que les trois issues de l\'API', () => {
    expect(lireRetour('?agenda=retour')).toBe('retour');
    expect(lireRetour('?agenda=refus')).toBe('refus');
    expect(lireRetour('?agenda=expire')).toBe('expire');
    expect(lireRetour('?agenda=<script>')).toBeNull();
    expect(lireRetour('')).toBeNull();
  });
  it('messages calmes pour un refus et un lien expiré', () => {
    expect(messageRetour('refus')).toBe(MESSAGES.agendaRefus);
    expect(messageRetour('expire')).toBe(MESSAGES.agendaExpire);
    expect(messageRetour('retour')).toBeNull();
  });
});

describe('vueAgenda', () => {
  it.each([
    [{ etat: 'indisponible', erreur: null }, MESSAGES.agendaIndisponible, null],
    [{ etat: 'deconnecte', erreur: null }, MESSAGES.agendaDeconnecte, 'connecter'],
    [{ etat: 'en_cours', erreur: null }, MESSAGES.agendaEnCours, null],
    [{ etat: 'connecte', erreur: null }, MESSAGES.agendaConnecte, 'deconnecter'],
    [{ etat: 'deconnexion', erreur: null }, MESSAGES.agendaDeconnexion, null],
    [{ etat: 'revoque', erreur: null }, MESSAGES.agendaRevoque, 'connecter'],
    [{ etat: 'agenda_supprime', erreur: null }, MESSAGES.agendaSupprime, 'connecter'],
    [{ etat: 'echec', erreur: 'portee_refusee' }, MESSAGES.agendaPorteeRefusee, 'connecter'],
    [{ etat: 'echec', erreur: 'echange' }, MESSAGES.agendaEchec, 'connecter'],
  ] as Array<[ReponseAgenda, string, string | null]>)('%o', (r, ligne, bouton) => {
    expect(vueAgenda(r)).toEqual({ ligne, bouton });
  });
});

describe('attendreIssue', () => {
  it('interroge tant que la connexion est en cours, puis rend l\'issue', async () => {
    const reponses: ReponseAgenda[] = [{ etat: 'en_cours', erreur: null }, { etat: 'en_cours', erreur: null }, { etat: 'connecte', erreur: null }];
    const attentes: number[] = [];
    const r = await attendreIssue({ agenda: async () => reponses.shift()! }, async (ms) => { attentes.push(ms); });
    expect(r.etat).toBe('connecte');
    expect(attentes).toEqual([1000, 1000]);
  });
  it('s\'arrête au bout des essais, encore en cours', async () => {
    const r = await attendreIssue({ agenda: async () => ({ etat: 'en_cours', erreur: null }) }, async () => {}, 3);
    expect(r.etat).toBe('en_cours');
  });
});
