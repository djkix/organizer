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

  /** Étape 1, avant l'accusé de réception : la capture existe en base. Idempotent. */
  async recevoir(utilisateurId: string, e: CaptureEntrante): Promise<{ id: string; nouvelle: boolean }> {
    try {
      const c = await this.prisma.capture.create({
        data: {
          utilisateurId, canal: 'telegram', prive: false, etat: 'recue',
          sourceRef: e.sourceRef, sourceFichier: e.fichier?.id ?? null, audioMime: e.fichier?.mime ?? null,
          dureeS: e.dureeS, texteEcrit: e.texte, emisLe: e.emisLe,
        },
        select: { id: true },
      });
      return { id: c.id, nouvelle: true };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') throw err;
      const c = await this.prisma.capture.findUniqueOrThrow({ where: { sourceRef: e.sourceRef }, select: { id: true } });
      return { id: c.id, nouvelle: false };
    }
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
    return n;
  }
}
