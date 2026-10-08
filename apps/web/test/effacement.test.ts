import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerEffaceur, DELAI_EFFACEMENT_MS, type EtatEffacement } from '../src/lib/effacement.js';

function monter(effacer: (id: string) => Promise<void> = async () => {}) {
  const envoyes: string[] = [];
  const echecs: string[] = [];
  const etats: EtatEffacement[] = [];
  const e = creerEffaceur({
    effacer: (id) => { envoyes.push(id); return effacer(id); },
    surChangement: (x) => etats.push(x),
    surEchec: (id) => echecs.push(id),
  });
  return { e, envoyes, echecs, etats };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('effaceur différé', () => {
  it('cinq secondes', () => {
    expect(DELAI_EFFACEMENT_MS).toBe(5_000);
  });

  it('rien ne part avant l\'échéance, un seul envoi à l\'échéance', () => {
    const { e, envoyes, etats } = monter();
    e.planifier('a');
    expect(etats.at(-1)).toEqual({ enAttente: 'a' });
    vi.advanceTimersByTime(DELAI_EFFACEMENT_MS - 1);
    expect(envoyes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(envoyes).toEqual(['a']);
    expect(etats.at(-1)).toEqual({ enAttente: null });
    vi.advanceTimersByTime(60_000);
    expect(envoyes).toEqual(['a']);
  });

  it('annuler dans le délai : aucune requête, l\'id est rendu', () => {
    const { e, envoyes, etats } = monter();
    e.planifier('a');
    expect(e.annuler()).toBe('a');
    expect(etats.at(-1)).toEqual({ enAttente: null });
    vi.advanceTimersByTime(60_000);
    expect(envoyes).toEqual([]);
    expect(e.annuler()).toBeNull();
  });

  it('un second effacement fait partir le premier tout de suite', () => {
    const { e, envoyes, etats } = monter();
    e.planifier('a');
    vi.advanceTimersByTime(1_000);
    e.planifier('b');
    expect(envoyes).toEqual(['a']);
    expect(etats.at(-1)).toEqual({ enAttente: 'b' });
    vi.advanceTimersByTime(DELAI_EFFACEMENT_MS);
    expect(envoyes).toEqual(['a', 'b']);
  });

  it('vider envoie maintenant, et plus rien ensuite', () => {
    const { e, envoyes } = monter();
    e.planifier('a');
    e.vider();
    expect(envoyes).toEqual(['a']);
    vi.advanceTimersByTime(60_000);
    expect(envoyes).toEqual(['a']);
    e.vider();
    expect(envoyes).toEqual(['a']);
  });

  it('un échec rend la ligne', async () => {
    const { e, echecs } = monter(() => Promise.reject(new Error('réseau')));
    e.planifier('a');
    await vi.advanceTimersByTimeAsync(DELAI_EFFACEMENT_MS);
    expect(echecs).toEqual(['a']);
  });
});
