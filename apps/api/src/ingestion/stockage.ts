import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class StockageAudio {
  constructor(private readonly racine: string) {}

  /**
   * Écrit l'audio et renvoie son chemin relatif à la racine. Réécrire le même fichier est sans effet.
   * Écrit à côté puis renommé : un arrêt en cours d'écriture ne laisse jamais un fichier tronqué à sa place.
   */
  async ecrire(id: string, emisLe: Date, donnees: Buffer, extension: string, type: 'ordinaire' | 'prive'): Promise<string> {
    const ext = /^[a-z0-9]{1,5}$/.test(extension) ? extension : 'bin';
    const mois = String(emisLe.getUTCMonth() + 1).padStart(2, '0');
    const relatif = `${type}/${emisLe.getUTCFullYear()}/${mois}/${id}.${ext}`;
    await mkdir(dirname(join(this.racine, relatif)), { recursive: true });
    const final = join(this.racine, relatif);
    const provisoire = `${final}.${randomUUID()}.tmp`;
    try {
      await writeFile(provisoire, donnees);
      await rename(provisoire, final);
    } catch (e) {
      await rm(provisoire, { force: true });
      throw e;
    }
    return relatif;
  }

  /** Retire un fichier rangé (chemin relatif renvoyé par ecrire), sans erreur s'il manque. */
  async supprimer(relatif: string): Promise<void> {
    await rm(join(this.racine, relatif), { force: true });
  }
}
