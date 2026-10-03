import { Prisma, type PrismaClient } from '@organizer/db';
import type { CaptureEntrante } from './extraire.js';
import type { StockageAudio } from './stockage.js';

export interface Telechargeur {
  telecharger(fichierId: string): Promise<{ donnees: Buffer; extension: string }>;
}

export interface FileClassement {
  enfiler(captureId: string): Promise<void>;
}

export class IngestionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stockage: StockageAudio,
    private readonly telechargeur: Telechargeur,
    private readonly file: FileClassement,
    private readonly journal: (message: string) => void = (m) => console.error(m),
  ) {}

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
    const f = await this.telechargeur.telecharger(c.sourceFichier);
    const audioPath = await this.stockage.ecrire(c.id, c.emisLe, f.donnees, f.extension, 'prive');
    await this.prisma.capture.update({ where: { id }, data: { audioPath } });
  }

  /** Étape 2, après l'accusé : audio rangé, job enfilé. Rejouable. */
  async finaliser(id: string): Promise<void> {
    const c = await this.prisma.capture.findUniqueOrThrow({ where: { id } });
    if (c.prive) throw new Error(`Capture ${id} privée : jamais enfilée`);
    if (c.etat !== 'recue') return;
    if (c.sourceFichier && !c.audioPath) {
      const f = await this.telechargeur.telecharger(c.sourceFichier);
      const audioPath = await this.stockage.ecrire(c.id, c.emisLe, f.donnees, f.extension, 'ordinaire');
      await this.prisma.capture.update({ where: { id }, data: { audioPath } });
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
