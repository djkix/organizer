// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demanderPersistance, demanderSynchro, installerRelances } from '../src/lib/prive/relances.js';

const visibilite = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};

afterEach(() => visibilite('visible'));

describe('installerRelances', () => {
  it('vide à l\'installation, au retour du réseau et au retour à l\'écran, jusqu\'au démontage', async () => {
    const vider = vi.fn(async () => {});
    const demonter = installerRelances(vider, window, document);
    expect(vider).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(vider).toHaveBeenCalledTimes(2);
    visibilite('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vider).toHaveBeenCalledTimes(2);
    visibilite('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vider).toHaveBeenCalledTimes(3);
    demonter();
    window.dispatchEvent(new Event('online'));
    expect(vider).toHaveBeenCalledTimes(3);
  });

  it('un vidage en échec n\'est jamais remonté comme une erreur', async () => {
    const vider = vi.fn(async () => { throw new Error('base indisponible'); });
    const demonter = installerRelances(vider, window, document);
    await Promise.resolve();
    demonter();
    expect(vider).toHaveBeenCalledTimes(1);
  });
});

describe('demanderPersistance', () => {
  it('ne redemande pas un stockage déjà durable', async () => {
    const persist = vi.fn(async () => true);
    expect(await demanderPersistance({ persisted: async () => true, persist })).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('demande, et tolère l\'absence de l\'API', async () => {
    expect(await demanderPersistance({ persisted: async () => false, persist: async () => true })).toBe(true);
    expect(await demanderPersistance(undefined)).toBe(false);
  });
});

describe('demanderSynchro', () => {
  it('inscrit l\'étiquette organizer-prive quand Background Sync existe', async () => {
    const register = vi.fn(async () => {});
    const sw = { getRegistration: async () => ({ sync: { register } }) as unknown as ServiceWorkerRegistration };
    expect(await demanderSynchro(sw)).toBe(true);
    expect(register).toHaveBeenCalledWith('organizer-prive');
  });

  it('rend false sans service worker ou sans Background Sync', async () => {
    expect(await demanderSynchro(undefined)).toBe(false);
    expect(await demanderSynchro({ getRegistration: async () => undefined })).toBe(false);
    expect(await demanderSynchro({ getRegistration: async () => ({}) as ServiceWorkerRegistration })).toBe(false);
  });
});
