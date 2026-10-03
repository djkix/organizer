import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { creerCocheur, DELAI_ANNULATION_MS, type EtatCochage } from '../src/lib/cochage.js';
import { MESSAGES } from '../src/lib/messages.js';

function differe() {
  let ok!: () => void;
  let ko!: (e: Error) => void;
  const p = new Promise<void>((a, b) => { ok = a; ko = b; });
  return { p, ok, ko };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function monter(cocher: (id: string) => Promise<void> = async () => {}, decocher: (id: string) => Promise<void> = async () => {}) {
  const etats: EtatCochage[] = [];
  const c = creerCocheur({ cocher, decocher, surChangement: (e) => etats.push(e) });
  return { c, etats };
}

describe('cochage', () => {
  it('écriture optimiste : barré avant la réponse du serveur', () => {
    const post = differe();
    const { c } = monter(() => post.p);
    c.cocher('a');
    expect(c.etat().enCours).toBe('a');
  });

  it('après 10 s sans annulation, la ligne quitte la liste ; aucun décochage', async () => {
    const decocher = vi.fn(async () => {});
    const { c } = monter(undefined, decocher);
    c.cocher('a');
    await vi.advanceTimersByTimeAsync(DELAI_ANNULATION_MS - 1);
    expect(c.etat().enCours).toBe('a');
    await vi.advanceTimersByTimeAsync(1);
    expect(c.etat()).toMatchObject({ enCours: null });
    expect(c.etat().retires.has('a')).toBe(true);
    expect(decocher).not.toHaveBeenCalled();
  });

  it('Annuler dans les 10 s décoche et garde la ligne', async () => {
    const decocher = vi.fn(async () => {});
    const { c } = monter(undefined, decocher);
    c.cocher('a');
    await c.annuler();
    expect(decocher).toHaveBeenCalledWith('a');
    expect(c.etat().enCours).toBeNull();
    expect(c.etat().retires.has('a')).toBe(false);
  });

  it('Annuler avant la réponse du cochage : le décochage part après', async () => {
    const journal: string[] = [];
    const post = differe();
    const { c } = monter(
      async () => { journal.push('post'); await post.p; journal.push('post-ok'); },
      async () => { journal.push('delete'); },
    );
    c.cocher('a');
    const annulation = c.annuler();
    await Promise.resolve();
    expect(journal).toEqual(['post']);
    post.ok();
    await annulation;
    expect(journal).toEqual(['post', 'post-ok', 'delete']);
  });

  it('un cochage refusé fait revenir la ligne, avec un mot court qui s\'efface seul', async () => {
    const decocher = vi.fn(async () => {});
    const { c } = monter(async () => { throw new Error('réseau'); }, decocher);
    c.cocher('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(c.etat()).toMatchObject({ enCours: null, message: MESSAGES.cochageRate });
    expect(c.etat().retires.has('a')).toBe(false);
    await c.annuler();
    expect(decocher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DELAI_ANNULATION_MS);
    expect(c.etat().message).toBeNull();
  });

  it('cocher une deuxième ligne clôt l\'annulation de la première', () => {
    const { c } = monter();
    c.cocher('a');
    c.cocher('b');
    expect(c.etat().enCours).toBe('b');
    expect(c.etat().retires.has('a')).toBe(true);
  });

  it('un décochage refusé laisse la ligne cochée, et le dit', async () => {
    const { c } = monter(undefined, async () => { throw new Error('réseau'); });
    c.cocher('a');
    await c.annuler();
    expect(c.etat().retires.has('a')).toBe(true);
    expect(c.etat().message).toBe(MESSAGES.annulationRatee);
  });

  it('cocher, annuler, recocher pendant le premier envoi : les écritures partent dans l\'ordre des gestes', async () => {
    const journal: string[] = [];
    const serveur = new Set<string>();
    const post1 = differe();
    let n = 0;
    const { c } = monter(
      async (id) => { journal.push(`POST ${id}`); if (++n === 1) await post1.p; serveur.add(id); },
      async (id) => { journal.push(`DELETE ${id}`); serveur.delete(id); },
    );
    c.cocher('a');
    const annulation = c.annuler();
    c.cocher('a');
    await Promise.resolve();
    expect(journal).toEqual(['POST a']);
    post1.ok();
    await annulation;
    await vi.advanceTimersByTimeAsync(0);
    expect(journal).toEqual(['POST a', 'DELETE a', 'POST a']);
    expect(serveur.has('a')).toBe(true);
    expect(c.etat().enCours).toBe('a');
  });

  it('une écriture ajoutée à la file (correction) passe après un cochage en cours', async () => {
    const post = differe();
    const journal: string[] = [];
    const { c } = monter(async (id) => { await post.p; journal.push(`POST ${id}`); });
    c.cocher('a');
    const correction = c.enfiler(async () => { journal.push('PATCH a'); });
    await vi.advanceTimersByTimeAsync(0);
    expect(journal).toEqual([]);
    post.ok();
    await correction;
    expect(journal).toEqual(['POST a', 'PATCH a']);
  });
});
