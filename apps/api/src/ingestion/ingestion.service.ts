import { Prisma, type PrismaClient } from '@organizer/db';
import type { CaptureEntrante } from './extraire.js';
import type { StockageAudio } from './stockage.js';
import type { Reencodeur } from '../privees/reencodeur.js';
import { FichierTropGros } from './telechargeur.js';

export interface Telechargeur {
  telecharger(fichierId: string): Promise<{ donnees: Buffer; extension: string }>;
}

export interface FileClassement {
  enfiler(captureId: string): Promise<void>;
}

/** Le son seul d'un média Telegram. Une vidéo (bulle ronde) est réduite à sa piste audio : l'image n'est jamais rangée. */
export interface AudioPret { donnees: Buffer; extension: string; mime: string | null }

export class IngestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stockage: StockageAudio,
    private readonly telechargeur: Telechargeur,
    private readonly file: FileClassement,
    private readonly journal: (message: string) => void = (m) => console.error(m),
    private readonly reencodeur: Reencodeur,
  ) {}

  /**
   * Gemini ne doit jamais recevoir d'image : une vidéo est réencodée en audio Ogg/Opus (ffmpeg borné) avant tout rangement.
   * Si ffmpeg échoue, l'erreur remonte : rien n'est écrit, la capture reste reprenable.
   */
  private async versAudio(f: { donnees: Buffer; extension: string }, mimeCapture: string | null): Promise<AudioPret> {
    if (!mimeCapture?.startsWith('video/')) return { ...f, mime: null };
    return { donnees: await this.reencodeur.versOpus(f.donnees, true), extension: 'ogg', mime: 'audio/ogg' };
  }

  /**
   * Étape 1, avant l'accusé de réception : la capture existe en base. Idempotent.
   * Si « prochaine capture privée » est armé, le drapeau est consommé dans la même transaction
   * que la création : un échec le rend, la relivraison retrouve le même mode (règle n° 6).
   */
  async recevoir(utilisateurId: string, e: CaptureEntrante): Promise<{ id: string; nouvelle: boolean; prive: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const consomme = await tx.utilisateur.updateMany({
          where: { id: utilisateurId, prochainePrivee: true }, data: { prochainePrivee: false },
        });
        const prive = consomme.count === 1;
        const c = await tx.capture.create({
          data: {
            utilisateurId, canal: 'telegram', prive, etat: prive ? 'privee' : 'recue',
            sourceRef: e.sourceRef, sourceFichier: e.fichier?.id ?? null, audioMime: e.fichier?.mime ?? null,
            dureeS: e.dureeS, texteEcrit: e.texte, emisLe: e.emisLe,
          },
          select: { id: true },
        });
        return { id: c.id, nouvelle: true, prive };
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      const c = await this.prisma.capture.findUniqueOrThrow({ where: { sourceRef: e.sourceRef }, select: { id: true, prive: true } });
      return { id: c.id, nouvelle: false, prive: c.prive };
    }
  }

  async armerPrivee(utilisateurId: string): Promise<void> {
    await this.prisma.utilisateur.update({ where: { id: utilisateurId }, data: { prochainePrivee: true } });
  }

  /** Range l'audio d'une capture privée Telegram dans prive/. Jamais enfilée. Rejouable. */
  async finaliserPrivee(id: string): Promise<void> {
    const c = await this.prisma.capture.findUniqueOrThrow({ where: { id } });
    if (!c.prive) throw new Error(`Capture ${id} ordinaire : pas de rangement privé`);
    if (c.audioPath || !c.sourceFichier) return;
    const f = await this.versAudio(await this.telechargeur.telecharger(c.sourceFichier), c.audioMime);
    const audioPath = await this.stockage.ecrire(c.id, c.emisLe, f.donnees, f.extension, 'prive');
    await this.prisma.capture.update({ where: { id }, data: { audioPath, ...(f.mime ? { audioMime: f.mime } : {}) } });
  }

  /** Étape 2, après l'accusé : audio rangé, job enfilé. Rejouable. */
  async finaliser(id: string): Promise<void> {
    const c = await this.prisma.capture.findUniqueOrThrow({ where: { id } });
    if (c.prive) throw new Error(`Capture ${id} privée : jamais enfilée`);
    if (c.etat !== 'recue') return;
    // Jamais de job dont le fichier rangé serait une vidéo (reliquat d'avant ce correctif) : visible dans À revoir.
    if (c.audioPath && c.audioMime?.startsWith('video/')) {
      await this.prisma.capture.updateMany({ where: { id, etat: 'recue' }, data: { etat: 'a_revoir', erreur: 'media_video' } });
      return;
    }
    if (c.sourceFichier && !c.audioPath) {
      let f: AudioPret;
      try {
        f = await this.versAudio(await this.telechargeur.telecharger(c.sourceFichier), c.audioMime);
      } catch (e) {
        if (!(e instanceof FichierTropGros)) throw e;
        // Telegram ne livrera jamais ce fichier : visible dans À revoir, plus jamais retenté.
        await this.prisma.capture.updateMany({ where: { id, etat: 'recue' }, data: { etat: 'a_revoir', erreur: 'audio_trop_gros' } });
        return;
      }
      const audioPath = await this.stockage.ecrire(c.id, c.emisLe, f.donnees, f.extension, 'ordinaire');
      await this.prisma.capture.update({ where: { id }, data: { audioPath, ...(f.mime ? { audioMime: f.mime } : {}) } });
    }
    await this.file.enfiler(id);
    // updateMany : le worker a pu classer la capture entre-temps.
    await this.prisma.capture.updateMany({ where: { id, etat: 'recue' }, data: { etat: 'en_file' } });
  }

  /** Reprend les captures restées en recue (téléchargement en échec, redémarrage). */
  async reprendre(maintenant: Date = new Date()): Promise<number> {
    const enAttente = await this.prisma.capture.findMany({
      where: { etat: 'recue', prive: false, recuLe: { lt: new Date(maintenant.getTime() - 2 * 60_000) } },
      orderBy: { emisLe: 'asc' }, select: { id: true },
    });
    let n = 0;
    for (const { id } of enAttente) {
      try {
        await this.finaliser(id);
        n++;
      } catch (e) {
        this.journal(`Capture ${id} : finalisation reportée (${(e as Error).name})`);
      }
    }
    const privees = await this.prisma.capture.findMany({
      where: {
        prive: true, canal: 'telegram', audioPath: null, sourceFichier: { not: null },
        recuLe: { lt: new Date(maintenant.getTime() - 2 * 60_000) },
      },
      orderBy: { emisLe: 'asc' }, select: { id: true },
    });
    for (const { id } of privees) {
      try {
        await this.finaliserPrivee(id);
        n++;
      } catch (e) {
        this.journal(`Capture ${id} : rangement privé reporté (${(e as Error).name})`);
      }
    }
    return n;
  }
}
