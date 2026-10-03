import { describe, expect, it } from 'vitest';
import { ErreurApi, HorsLigne } from '../src/lib/api.js';
import { GardeSession, redirection, type EtatSession } from '../src/lib/session.js';

describe('GardeSession', () => {
  it('connecté : une seule vérification, retenue jusqu\'à oublier()', async () => {
    let n = 0;
    const g = new GardeSession({ moi: async () => { n++; return { nom: 'test' }; } });
    expect(await g.etat()).toEqual({ etat: 'connecte', nom: 'test' });
    await g.etat();
    expect(n).toBe(1);
    g.oublier();
    await g.etat();
    expect(n).toBe(2);
  });

  it('401 : déconnecté, et revérifié la fois suivante', async () => {
    let n = 0;
    const g = new GardeSession({ moi: async () => { n++; throw new ErreurApi(401, 'Connecte-toi pour continuer.'); } });
    expect(await g.etat()).toEqual({ etat: 'deconnecte' });
    await g.etat();
    expect(n).toBe(2);
  });

  it('coupure ou panne du serveur : hors ligne, jamais déconnecté', async () => {
    expect(await new GardeSession({ moi: async () => { throw new HorsLigne(); } }).etat()).toEqual({ etat: 'hors-ligne' });
    expect(await new GardeSession({ moi: async () => { throw new ErreurApi(500, 'x'); } }).etat()).toEqual({ etat: 'hors-ligne' });
  });
});

describe('redirection', () => {
  const D: EtatSession = { etat: 'deconnecte' };
  const C: EtatSession = { etat: 'connecte', nom: 'test' };
  const H: EtatSession = { etat: 'hors-ligne' };

  it('déconnecté : vers la connexion, sauf l\'enregistreur privé', () => {
    expect(redirection('/', D)).toBe('/connexion');
    expect(redirection('/prive', D)).toBe('/connexion');
    expect(redirection('/connexion', D)).toBeNull();
    expect(redirection('/prive/enregistrer', D)).toBeNull();
  });

  it('hors ligne : on reste où on est', () => {
    expect(redirection('/', H)).toBeNull();
    expect(redirection('/prive/enregistrer', H)).toBeNull();
  });

  it('connecté sur la page de connexion : vers l\'accueil', () => {
    expect(redirection('/connexion', C)).toBe('/');
    expect(redirection('/reglages', C)).toBeNull();
  });
});
