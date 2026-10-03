// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { enregistrerSW, type OptionsSW } from '../src/lib/pwa/enregistrement.js';

describe('enregistrerSW', () => {
  it('ne recharge jamais la page à une mise à jour : onNeedReload est transmis et ne fait rien', () => {
    let transmises: OptionsSW | undefined;
    enregistrerSW((o) => { transmises = o; });
    expect(transmises?.immediate).toBe(true);
    expect(typeof transmises?.onNeedReload).toBe('function');
    const recharger = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: recharger });
    transmises!.onNeedReload!();
    expect(recharger).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
