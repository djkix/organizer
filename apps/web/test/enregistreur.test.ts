import { describe, expect, it, vi } from 'vitest';
import { EnregistrementVide } from '../src/lib/prive/file.js';
import { creerEnregistreur, DEBIT_PRIVE, DUREE_MAX_S, MIME_PRIVE } from '../src/lib/prive/enregistreur.js';

class FauxRecorder extends EventTarget {
  static accepte = true;
  static muet = false;
  static dernier: FauxRecorder;
  static isTypeSupported = (t: string): boolean => FauxRecorder.accepte && t === MIME_PRIVE;
  state: RecordingState = 'inactive';
  constructor(readonly stream: MediaStream, readonly options: MediaRecorderOptions) {
    super();
    FauxRecorder.dernier = this;
  }
  get mimeType(): string { return this.options.mimeType ?? ''; }
  start(): void { this.state = 'recording'; }
  stop(): void {
    if (FauxRecorder.muet) return; // Un navigateur qui ne dit jamais « stop ».
    this.donnees('fin');
    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  }
  donnees(texte: string): void {
    const e = new Event('dataavailable');
    Object.defineProperty(e, 'data', { value: new Blob([texte]) });
    this.dispatchEvent(e);
  }
}

function monter(surInterruption?: () => void, surLimite?: () => void) {
  const piste = Object.assign(new EventTarget(), { stop: vi.fn() });
  const flux = { getTracks: () => [piste] } as unknown as MediaStream;
  let t = new Date('2026-10-06T21:00:00.000Z');
  const e = creerEnregistreur({
    surInterruption,
    surLimite,
    media: { getUserMedia: async () => flux },
    Recorder: FauxRecorder as unknown as typeof MediaRecorder,
    maintenant: () => t,
  });
  return { e, piste, avancer: (ms: number) => { t = new Date(t.getTime() + ms); } };
}

describe('enregistreur', () => {
  it('Opus dans WebM, débit modéré, heure de début, durée, micro rendu', async () => {
    FauxRecorder.accepte = true;
    const { e, piste, avancer } = monter();
    await e.demarrer();
    expect(FauxRecorder.dernier.options).toEqual({ mimeType: MIME_PRIVE, audioBitsPerSecond: DEBIT_PRIVE });
    FauxRecorder.dernier.donnees('abc');
    avancer(26_400);
    const r = await e.arreter();
    expect(await r.blob.text()).toBe('abcfin');
    expect(r).toMatchObject({ mime: MIME_PRIVE, dureeS: 26, emisLe: '2026-10-06T21:00:00.000Z' });
    expect(piste.stop).toHaveBeenCalled();
  });

  it('sans Opus, le format par défaut du navigateur', async () => {
    FauxRecorder.accepte = false;
    const { e } = monter();
    await e.demarrer();
    expect(FauxRecorder.dernier.options.mimeType).toBe('');
    expect((await e.arreter()).mime).toBe(MIME_PRIVE);
    FauxRecorder.accepte = true;
  });

  it('un arrêt spontané garde ce qui a été dit', async () => {
    const interrompu = vi.fn();
    const { e, piste, avancer } = monter(interrompu);
    await e.demarrer();
    FauxRecorder.dernier.donnees('debut');
    avancer(5_000);
    piste.dispatchEvent(new Event('ended'));
    FauxRecorder.dernier.stop();
    expect(interrompu).toHaveBeenCalled();
    avancer(60_000);
    const r = await e.arreter();
    expect(await r.blob.text()).toBe('debutfin');
    expect(r.dureeS).toBe(5);
  });

  it('arrêter sans avoir commencé : EnregistrementVide', async () => {
    await expect(monter().e.arreter()).rejects.toBeInstanceOf(EnregistrementVide);
  });

  it('micro refusé : demarrer échoue', async () => {
    const e = creerEnregistreur({
      media: { getUserMedia: async () => { throw new DOMException('refusé', 'NotAllowedError'); } },
      Recorder: FauxRecorder as unknown as typeof MediaRecorder,
    });
    await expect(e.demarrer()).rejects.toThrow('refusé');
  });

  it('si le Recorder ne se crée pas, le micro est rendu', async () => {
    const piste = Object.assign(new EventTarget(), { stop: vi.fn() });
    const flux = { getTracks: () => [piste] } as unknown as MediaStream;
    class Casse { static isTypeSupported = (): boolean => true; constructor() { throw new Error('non'); } }
    const e = creerEnregistreur({ media: { getUserMedia: async () => flux }, Recorder: Casse as unknown as typeof MediaRecorder });
    await expect(e.demarrer()).rejects.toThrow('non');
    expect(piste.stop).toHaveBeenCalled();
  });

  it('une heure : la limite est signalée, une seule fois', async () => {
    vi.useFakeTimers();
    try {
      const limite = vi.fn();
      const { e } = monter(undefined, limite);
      await e.demarrer();
      vi.advanceTimersByTime(DUREE_MAX_S * 1000 - 1);
      expect(limite).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(limite).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(10_000);
      expect(limite).toHaveBeenCalledTimes(1);
      FauxRecorder.dernier.stop();
      await e.arreter();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deux demarrer() simultanés : un seul flux, le second ne fait rien', async () => {
    const piste = Object.assign(new EventTarget(), { stop: vi.fn() });
    const flux = { getTracks: () => [piste] } as unknown as MediaStream;
    const ouvrir = vi.fn(async () => flux);
    const e = creerEnregistreur({ media: { getUserMedia: ouvrir }, Recorder: FauxRecorder as unknown as typeof MediaRecorder });
    await Promise.all([e.demarrer(), e.demarrer()]);
    await e.demarrer();
    expect(ouvrir).toHaveBeenCalledTimes(1);
    await e.arreter();
    expect(piste.stop).toHaveBeenCalledTimes(1);
  });

  it('un échec de demarrer() permet de recommencer', async () => {
    let n = 0;
    const piste = Object.assign(new EventTarget(), { stop: vi.fn() });
    const flux = { getTracks: () => [piste] } as unknown as MediaStream;
    const e = creerEnregistreur({
      media: { getUserMedia: async () => { if (n++ === 0) throw new DOMException('pris', 'NotReadableError'); return flux; } },
      Recorder: FauxRecorder as unknown as typeof MediaRecorder,
    });
    await expect(e.demarrer()).rejects.toThrow('pris');
    await e.demarrer();
    expect(n).toBe(2);
    await e.arreter();
  });

  it('si « stop » ne vient jamais, on garde ce qui a été reçu', async () => {
    vi.useFakeTimers();
    try {
      FauxRecorder.muet = true;
      const { e, avancer } = monter();
      await e.demarrer();
      FauxRecorder.dernier.donnees('debut');
      avancer(7_000);
      const p = e.arreter();
      await vi.advanceTimersByTimeAsync(10_000);
      const r = await p;
      expect(await r.blob.text()).toBe('debut');
      expect(r.dureeS).toBe(7);
    } finally {
      FauxRecorder.muet = false;
      vi.useRealTimers();
    }
  });
});
