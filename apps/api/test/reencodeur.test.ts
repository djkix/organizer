import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { AudioIllisible, ReencodeurFfmpeg } from '../src/privees/reencodeur.js';

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
