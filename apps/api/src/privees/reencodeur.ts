import { spawn } from 'node:child_process';

export interface Reencodeur {
  versOpus(donnees: Buffer): Promise<Buffer>;
}

export class AudioIllisible extends Error {
  override name = 'AudioIllisible';
}

/** Réencode n'importe quel audio en Opus 32 kbit/s dans un conteneur Ogg. */
export class ReencodeurFfmpeg implements Reencodeur {
  constructor(private readonly binaire = 'ffmpeg', private readonly delaiMs = 60_000) {}

  versOpus(donnees: Buffer): Promise<Buffer> {
    return new Promise((resoudre, rejeter) => {
      const p = spawn(this.binaire, [
        '-hide_banner', '-loglevel', 'error',
        // Octets non fiables : aucun protocole hors du tube, seuls les conteneurs attendus, pas de métadonnées.
        '-protocol_whitelist', 'pipe', '-format_whitelist', 'matroska,webm,ogg,mov,mp4,m4a,mp3,wav',
        '-i', 'pipe:0', '-vn', '-map_metadata', '-1', '-t', '3600', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
      const morceaux: Buffer[] = [];
      const minuterie = setTimeout(() => p.kill('SIGKILL'), this.delaiMs);
      p.stdout.on('data', (b: Buffer) => morceaux.push(b));
      p.on('error', (e) => {
        clearTimeout(minuterie);
        rejeter(e);
      });
      p.on('close', (code) => {
        clearTimeout(minuterie);
        if (code === 0 && morceaux.length > 0) resoudre(Buffer.concat(morceaux));
        else rejeter(new AudioIllisible(`ffmpeg : code ${code}`));
      });
      // EPIPE si ffmpeg abandonne avant la fin de l'entrée : l'erreur arrive par « close ».
      p.stdin.on('error', () => undefined);
      p.stdin.end(donnees);
    });
  }
}
