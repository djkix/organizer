import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class StockageAudio {
  constructor(private readonly racine: string) {}

  /** Écrit l'audio et renvoie son chemin relatif à la racine. Réécrire le même fichier est sans effet. */
  async ecrire(id: string, emisLe: Date, donnees: Buffer, extension: string, type: 'ordinaire' | 'prive'): Promise<string> {
    const ext = /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'bin';
    const mois = String(emisLe.getUTCMonth() + 1).padStart(2, '0');
    const relatif = `${type}/${emisLe.getUTCFullYear()}/${mois}/${id}.${ext}`;
    await mkdir(dirname(join(this.racine, relatif)), { recursive: true });
    await writeFile(join(this.racine, relatif), donnees);
    return relatif;
  }

  /** Retire un fichier rangé (chemin relatif renvoyé par ecrire), sans erreur s'il manque. */
  async supprimer(relatif: string): Promise<void> {
    await rm(join(this.racine, relatif), { force: true });
  }
}
