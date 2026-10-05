import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Reencodeur {
  /**
   * `depuisFichier` : pour une vidéo, dont l'index (moov) peut se trouver en fin de fichier et exige une entrée
   * qu'on peut parcourir ; les octets passent par un fichier temporaire, supprimé ensuite.
   */
  versOpus(donnees: Buffer, depuisFichier?: boolean): Promise<Buffer>;
}

export class AudioIllisible extends Error {
  override name = 'AudioIllisible';
}

/** Réencode n'importe quel audio en Opus 32 kbit/s dans un conteneur Ogg. */
export class ReencodeurFfmpeg implements Reencodeur {
  constructor(private readonly binaire = 'ffmpeg', private readonly delaiMs = 60_000) {}

  async versOpus(donnees: Buffer, depuisFichier = false): Promise<Buffer> {
    if (!depuisFichier) return this.lancer(donnees, null);
    // Nom aléatoire, droits 0600 ; le fichier ne survit jamais à l'appel.
    const chemin = join(tmpdir(), `organizer-${randomBytes(12).toString('hex')}.bin`);
    try {
      await writeFile(chemin, donnees, { mode: 0o600 });
      return await this.lancer(null, chemin);
    } finally {
      await rm(chemin, { force: true });
    }
  }

  private lancer(donnees: Buffer | null, fichier: string | null): Promise<Buffer> {
    return new Promise((resoudre, rejeter) => {
      const p = spawn(this.binaire, [
        '-hide_banner', '-loglevel', 'error',
        // Octets non fiables : aucun protocole hors du tube (ou de ce seul fichier), seuls les conteneurs attendus, pas de métadonnées.
        '-protocol_whitelist', fichier ? 'file' : 'pipe', '-format_whitelist', 'matroska,webm,ogg,mov,mp4,m4a,mp3,wav',
        '-i', fichier ?? 'pipe:0', '-vn', '-map_metadata', '-1', '-t', '3600', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1',
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
      p.stdin.end(donnees ?? undefined);
    });
  }
}

export class ServeurOccupe extends Error {
  override name = 'ServeurOccupe';
}

/**
 * Plafond de ffmpeg simultanés : au plus `max` en cours, `attenteMax` en attente, dans l'ordre d'arrivée.
 * Au-delà, refus immédiat (503) : la PWA garde la capture et réessaie, rien ne se perd.
 */
export class ReencodeurBorne implements Reencodeur {
  private enCours = 0;
  private readonly attente: Array<() => void> = [];

  constructor(private readonly interne: Reencodeur, private readonly max = 2, private readonly attenteMax = 4) {}

  async versOpus(donnees: Buffer, depuisFichier?: boolean): Promise<Buffer> {
    if (this.enCours < this.max) {
      this.enCours++;
    } else {
      if (this.attente.length >= this.attenteMax) throw new ServeurOccupe('ffmpeg saturé');
      // La place est transmise par celui qui sort : enCours ne bouge pas.
      await new Promise<void>((tour) => this.attente.push(tour));
    }
    try {
      return await this.interne.versOpus(donnees, depuisFichier);
    } finally {
      const suivant = this.attente.shift();
      if (suivant) suivant();
      else this.enCours--;
    }
  }
}
