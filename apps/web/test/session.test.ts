import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('GardeSession sur un réseau lent', () => {
  afterEach(() => vi.useRealTimers());
  /** Une vérification qui ne répond qu'à la demande. */
  const lente = () => {
    let repondre!: (v: { nom: string } | Error) => void;
    let appels = 0;
    const moi = () => { appels++; return new Promise<{ nom: string }>((ok, ko) => { repondre = (v) => (v instanceof Error ? ko(v) : ok(v)); }); };
    return { moi, repondre: (v: { nom: string } | Error) => repondre(v), appels: () => appels };
  };

  it('réponse lente : hors ligne après 2,5 s, l\'écran s\'affiche', async () => {
    vi.useFakeTimers();
    const l = lente();
    const g = new GardeSession({ moi: l.moi });
    let rendu: EtatSession | null = null;
    void g.etat().then((e) => { rendu = e; });
    await vi.advanceTimersByTimeAsync(2_400);
    expect(rendu).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(rendu).toEqual({ etat: 'hors-ligne' });
  });

  it('401 tardif : la redirection vers la connexion est demandée', async () => {
    vi.useFakeTimers();
    const l = lente();
    const surDeconnecte = vi.fn();
    const g = new GardeSession({ moi: l.moi }, { surDeconnecte });
    void g.etat();
    await vi.advanceTimersByTimeAsync(2_600);
    expect(surDeconnecte).not.toHaveBeenCalled();
    l.repondre(new ErreurApi(401, 'x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(surDeconnecte).toHaveBeenCalledTimes(1);
  });

  it('réponse tardive positive : connecté retenu, plus de vérification', async () => {
    vi.useFakeTimers();
    const l = lente();
    const g = new GardeSession({ moi: l.moi });
    void g.etat();
    await vi.advanceTimersByTimeAsync(2_600);
    l.repondre({ nom: 'test' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await g.etat()).toEqual({ etat: 'connecte', nom: 'test' });
    expect(l.appels()).toBe(1);
  });

  it('le dernier état « hors ligne » est rendu aussitôt et reconfirmé en arrière-plan, sans empiler les appels', async () => {
    vi.useFakeTimers();
    const l = lente();
    const g = new GardeSession({ moi: l.moi });
    void g.etat();
    await vi.advanceTimersByTimeAsync(2_600);
    const avant = Date.now();
    expect(await g.etat()).toEqual({ etat: 'hors-ligne' });
    expect(Date.now()).toBe(avant);
    expect(l.appels()).toBe(1);
  });

  it('un 401 reçu pendant l\'attente d\'un écran est rendu tel quel, sans double redirection', async () => {
    vi.useFakeTimers();
    const l = lente();
    const surDeconnecte = vi.fn();
    const g = new GardeSession({ moi: l.moi }, { surDeconnecte });
    const p = g.etat();
    l.repondre(new ErreurApi(401, 'x'));
    expect(await p).toEqual({ etat: 'deconnecte' });
    expect(surDeconnecte).not.toHaveBeenCalled();
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
