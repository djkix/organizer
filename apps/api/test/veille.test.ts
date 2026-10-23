import { describe, expect, it } from 'vitest';
import { constater, Veille, type Mesures } from '../src/veille/veille.js';

const GO = 1024 ** 3;
const T = new Date('2026-10-16T09:00:00Z');
const BASE: Mesures = {
  enAttente: 0, echecsHeure: 0, audioOctets: 0, baseOctets: 0, latenceMoyenneS: null, derniereCapture: new Date('2026-10-16T08:00:00Z'),
  derniereSauvegarde: null, derniereSauvegardeReussie: null,
};
const cles = (m: Partial<Mesures>): string[] => constater({ ...BASE, ...m }, T).map((c) => c.cle);

describe('constater', () => {
  it('rien à signaler en régime normal', () => {
    expect(constater(BASE, T)).toEqual([]);
  });

  it('seuils du cahier : plus de 50 en attente, plus de 3 échecs par heure, base au-delà de 8 Go, latence au-delà de 120 s', () => {
    expect(cles({ enAttente: 50, echecsHeure: 3, baseOctets: 8 * GO, latenceMoyenneS: 120 })).toEqual([]);
    expect(cles({ enAttente: 51 })).toEqual(['file']);
    expect(cles({ echecsHeure: 4 })).toEqual(['echecs']);
    expect(cles({ baseOctets: 8 * GO + 1 })).toEqual(['base']);
    expect(cles({ latenceMoyenneS: 121 })).toEqual(['latence']);
  });

  it('audio au-delà de 42 Go : la rotation (seuil 40 Go) n\'a pas suffi ; jamais d\'alerte pendant un cycle normal', () => {
    expect(cles({ audioOctets: 42 * GO })).toEqual([]);
    const [c] = constater({ ...BASE, audioOctets: 43 * GO }, T);
    expect(c).toEqual({ cle: 'audio', message: 'Audio : 43 Go, au-delà de 42 Go malgré la rotation.' });
  });

  it('dix jours sans capture : une information, pas une alerte ; rien sur une base neuve', () => {
    expect(cles({ derniereCapture: new Date('2026-10-06T08:59:00Z') })).toEqual(['silence']);
    expect(cles({ derniereCapture: new Date('2026-10-06T09:01:00Z') })).toEqual([]);
    expect(cles({ derniereCapture: null })).toEqual([]);
    expect(constater({ ...BASE, derniereCapture: new Date('2026-10-01T00:00:00Z') }, T)[0]!.message).toMatch(/^Information :/);
  });
});

describe('constater : sauvegarde', () => {
  const ok = { fin: new Date('2026-10-16T01:05:00Z'), reussie: true, message: '' };
  it('table vide : rien', () => {
    expect(cles({ derniereSauvegarde: null, derniereSauvegardeReussie: null })).toEqual([]);
  });
  it('dernière tentative en échec : une alerte avec son message', () => {
    const [c] = constater({ ...BASE, derniereSauvegarde: { fin: T, reussie: false, message: 'étape audio (code 23)' }, derniereSauvegardeReussie: ok.fin }, T);
    expect(c).toEqual({ cle: 'sauvegarde-echec', message: 'Sauvegarde en échec : étape audio (code 23).' });
  });
  it('aucune réussite depuis 36 h', () => {
    const il36h = new Date(T.getTime() - 36 * 3600_000);
    expect(cles({ derniereSauvegarde: { ...ok, fin: il36h }, derniereSauvegardeReussie: il36h })).toEqual([]);
    const plus = new Date(il36h.getTime() - 60_000);
    const [c] = constater({ ...BASE, derniereSauvegarde: { ...ok, fin: plus }, derniereSauvegardeReussie: plus }, T);
    expect(c).toEqual({ cle: 'sauvegarde-absente', message: 'Aucune sauvegarde réussie depuis 36 h.' });
  });
  it('échecs répétés sans réussite : les deux constats', () => {
    expect(cles({ derniereSauvegarde: { fin: T, reussie: false, message: 'x' }, derniereSauvegardeReussie: new Date('2026-10-10T00:00:00Z') }))
      .toEqual(['sauvegarde-echec', 'sauvegarde-absente']);
  });
  it('jamais réussie, dernière tentative ratée il y a plus de 36 h', () => {
    const vieux = new Date(T.getTime() - 37 * 3600_000);
    expect(cles({ derniereSauvegarde: { fin: vieux, reussie: false, message: 'x' }, derniereSauvegardeReussie: null }))
      .toEqual(['sauvegarde-echec', 'sauvegarde-absente']);
    expect(cles({ derniereSauvegarde: { fin: T, reussie: false, message: 'x' }, derniereSauvegardeReussie: null }))
      .toEqual(['sauvegarde-echec']);
  });
});

describe('Veille', () => {
  it('alerte une fois par constat, puis de nouveau seulement après un retour à la normale', async () => {
    let m: Mesures = { ...BASE, enAttente: 60 };
    const envoyees: string[] = [];
    const v = new Veille(async () => m, async (x) => { envoyees.push(x); }, () => T);
    await v.passer();
    await v.passer();
    expect(envoyees).toEqual(['File de classement : 60 captures en attente.']);
    m = BASE;
    await v.passer();
    m = { ...BASE, enAttente: 70 };
    await v.passer();
    expect(envoyees).toHaveLength(2);
  });

  it('une alerte en échec est retentée au passage suivant', async () => {
    let panne = true;
    const envoyees: string[] = [];
    const v = new Veille(async () => ({ ...BASE, echecsHeure: 9 }), async (x) => {
      if (panne) throw new Error('file des alertes indisponible');
      envoyees.push(x);
    }, () => T);
    await v.passer();
    panne = false;
    await v.passer();
    expect(envoyees).toEqual(['9 classements en échec depuis une heure.']);
  });
});
