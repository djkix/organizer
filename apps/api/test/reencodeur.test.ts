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
});
