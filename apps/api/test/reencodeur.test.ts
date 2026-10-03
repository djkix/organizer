import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AudioIllisible, ReencodeurBorne, ReencodeurFfmpeg, ServeurOccupe, type Reencodeur } from '../src/privees/reencodeur.js';

/** Une seconde de bip, en WebM/Opus comme MediaRecorder sur Chrome Android. Fabriquée, aucune voix. */
const webm = (): Buffer => execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
  '-c:a', 'libopus', '-f', 'webm', 'pipe:1',
]);

describe('ReencodeurFfmpeg', () => {
  it('produit de l\'Opus dans un conteneur Ogg', async () => {
    const sortie = await new ReencodeurFfmpeg().versOpus(webm());
    expect(sortie.subarray(0, 4).toString()).toBe('OggS');
  });

  it('refuse des octets qui ne sont pas de l\'audio', async () => {
    await expect(new ReencodeurFfmpeg().versOpus(Buffer.from('pas de l\'audio'))).rejects.toBeInstanceOf(AudioIllisible);
  });

  it('signale un binaire absent', async () => {
    await expect(new ReencodeurFfmpeg('ffmpeg-inexistant').versOpus(webm())).rejects.toThrow();
  });

  it('ne suit pas un fichier de concaténation ni une référence locale', async () => {
    const piege = Buffer.from('ffconcat version 1.0\nfile x.wav\n');
    await expect(new ReencodeurFfmpeg().versOpus(piege)).rejects.toBeInstanceOf(AudioIllisible);
  });

  it('retire les métadonnées de la source', async () => {
    const avec = execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-metadata', 'title=SECRET-TITRE', '-metadata', 'location=48.85+2.35/', '-c:a', 'libopus', '-f', 'webm', 'pipe:1',
    ]);
    expect(avec.includes('SECRET-TITRE')).toBe(true);
    const sortie = await new ReencodeurFfmpeg().versOpus(avec);
    expect(sortie.includes('SECRET-TITRE')).toBe(false);
  });
});

class Lent implements Reencodeur {
  enCours = 0;
  max = 0;
  liberer: Array<(erreur?: Error) => void> = [];
  async versOpus(d: Buffer): Promise<Buffer> {
    this.enCours++;
    this.max = Math.max(this.max, this.enCours);
    try {
      await new Promise<void>((ok, ko) => this.liberer.push((e) => (e ? ko(e) : ok())));
      return d;
    } finally {
      this.enCours--;
    }
  }
}

const tour = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('ReencodeurBorne', () => {
  it('jamais plus de deux ffmpeg à la fois ; les suivants attendent leur tour, dans l\'ordre', async () => {
    const lent = new Lent();
    const borne = new ReencodeurBorne(lent, 2, 4);
    const envois = [1, 2, 3, 4].map((n) => borne.versOpus(Buffer.from([n])));
    await tour();
    expect(lent.enCours).toBe(2);
    while (lent.liberer.length > 0) {
      lent.liberer.shift()!();
      await tour();
    }
    expect((await Promise.all(envois)).map((b) => b[0])).toEqual([1, 2, 3, 4]);
    expect(lent.max).toBe(2);
  });

  it('au-delà de quatre en attente, refuse tout de suite', async () => {
    const lent = new Lent();
    const borne = new ReencodeurBorne(lent, 2, 4);
    const envois = Array.from({ length: 6 }, () => borne.versOpus(Buffer.from('x')));
    await tour();
    await expect(borne.versOpus(Buffer.from('y'))).rejects.toBeInstanceOf(ServeurOccupe);
    while (lent.liberer.length > 0) {
      lent.liberer.shift()!();
      await tour();
    }
    await Promise.all(envois);
  });

  it('une erreur de ffmpeg libère sa place', async () => {
    const lent = new Lent();
    const borne = new ReencodeurBorne(lent, 1, 4);
    const premier = borne.versOpus(Buffer.from('a'));
    const second = borne.versOpus(Buffer.from('b'));
    await tour();
    lent.liberer.shift()!(new AudioIllisible('ffmpeg : code 1'));
    await expect(premier).rejects.toBeInstanceOf(AudioIllisible);
    await tour();
    lent.liberer.shift()!();
    expect((await second).toString()).toBe('b');
  });
});
