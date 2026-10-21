// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { enregistrerSW, type OptionsSW } from '../src/lib/pwa/enregistrement.js';
import { DELAI_RECHARGE_MS, rechargerMaintenant, suivreMaj } from '../src/lib/pwa/maj.js';

function cible(): EventTarget & { visibilityState: DocumentVisibilityState } {
  const t = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  t.visibilityState = 'visible';
  return t;
}

describe('suivreMaj', () => {
  it('revérifie périodiquement et à chaque retour au premier plan', async () => {
    vi.useFakeTimers();
    const doc = cible();
    const verifierSW = vi.fn();
    const surVersion = vi.fn();
    const arreter = suivreMaj({ verifierSW, versionServeur: async () => '1.2.1', surVersion, doc, intervalleMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(verifierSW).toHaveBeenCalledTimes(1);
    expect(surVersion).toHaveBeenLastCalledWith('1.2.1');

    doc.dispatchEvent(new Event('visibilitychange'));
    expect(verifierSW).toHaveBeenCalledTimes(2);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(verifierSW).toHaveBeenCalledTimes(2);

    arreter();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(verifierSW).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('un serveur injoignable ne change rien et ne jette pas', async () => {
    vi.useFakeTimers();
    const surVersion = vi.fn();
    const arreter = suivreMaj({
      verifierSW: () => undefined, versionServeur: () => Promise.reject(new Error('hors ligne')),
      surVersion, doc: cible(), intervalleMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(surVersion).not.toHaveBeenCalled();
    arreter();
    vi.useRealTimers();
  });
});

describe('rechargerMaintenant', () => {
  it('active la version en attente, puis recharge quand même après le délai', async () => {
    vi.useFakeTimers();
    const activer = vi.fn(async () => undefined);
    const recharger = vi.fn();
    rechargerMaintenant(activer, recharger);
    expect(activer).toHaveBeenCalled();
    expect(recharger).not.toHaveBeenCalled();
    // Sans ce filet, rien ne se passerait quand le bandeau vient du seul écart de version.
    await vi.advanceTimersByTimeAsync(DELAI_RECHARGE_MS);
    expect(recharger).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('recharge même si l\'activation échoue', async () => {
    vi.useFakeTimers();
    const recharger = vi.fn();
    rechargerMaintenant(() => Promise.reject(new Error('aucun worker')), recharger);
    await vi.advanceTimersByTimeAsync(DELAI_RECHARGE_MS);
    expect(recharger).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('enregistrerSW', () => {
  function options(suivi = { surEnAttente: vi.fn(), surEnregistre: vi.fn() }): { o: OptionsSW; suivi: typeof suivi } {
    let o: OptionsSW | undefined;
    enregistrerSW((p) => { o = p; return async () => undefined; }, suivi);
    return { o: o!, suivi };
  }

  it('ne recharge jamais la page de lui-même : onNeedReload est transmis et ne fait rien', () => {
    const { o } = options();
    expect(o.immediate).toBe(true);
    const recharger = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: recharger });
    o.onNeedReload!();
    expect(recharger).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('signale une coquille en attente et donne de quoi revérifier', () => {
    const { o, suivi } = options();
    o.onNeedRefresh!();
    expect(suivi.surEnAttente).toHaveBeenCalled();

    const update = vi.fn(async () => undefined);
    o.onRegisteredSW!('/sw.js', { update } as unknown as ServiceWorkerRegistration);
    const verifier = suivi.surEnregistre.mock.calls[0][0] as () => void;
    verifier();
    expect(update).toHaveBeenCalled();
  });

  it('sans enregistrement, rien à revérifier', () => {
    const { o, suivi } = options();
    o.onRegisteredSW!('/sw.js', undefined);
    expect(suivi.surEnregistre).not.toHaveBeenCalled();
  });
});
