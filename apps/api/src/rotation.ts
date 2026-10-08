import { rm, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { PrismaClient } from '@organizer/db';
import { tailleDossier } from './veille/mesures.js';

const GO = 1024 ** 3;
const LOT = 50;

/** Cahier, « Rotation de l'audio » : au-delà de 40 Go, purger jusqu'à 35 Go, captures de plus de 30 jours. */
export const SEUILS_ROTATION = { haut: 40 * GO, bas: 35 * GO, ageJours: 30 } as const;
export interface SeuilsRotation { haut: number; bas: number; ageJours: number }

/**
 * Purge l'audio ordinaire déjà transcrit, du plus ancien au plus récent, jamais l'audio privé (seule trace de la capture).
 * Idempotent : sous le seuil haut, rien ne se passe. La transcription et les éléments restent ; rien n'est dit à L.
 */
export class RotationAudio {
  private alerteActive = false;
  private enCours = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly racine: string,
    private readonly alerter: (message: string) => Promise<void>,
    private readonly seuils: SeuilsRotation = SEUILS_ROTATION,
    private readonly maintenant: () => Date = () => new Date(),
    private readonly mesurer: (dossier: string) => Promise<number> = tailleDossier,
  ) {}

  /** Un seul passage à la fois : un second, lancé pendant le premier, ne fait rien (sinon il purgerait au-delà du seuil bas). */
  async passer(): Promise<{ purges: number; liberes: number }> {
    if (this.enCours) return { purges: 0, liberes: 0 };
    this.enCours = true;
    try {
      return await this.tourner();
    } finally {
      this.enCours = false;
    }
  }

  private async tourner(): Promise<{ purges: number; liberes: number }> {
    let taille = await this.mesurer(this.racine);
    if (taille <= this.seuils.haut) { this.alerteActive = false; return { purges: 0, liberes: 0 }; }
    const avant = new Date(this.maintenant().getTime() - this.seuils.ageJours * 86_400_000);
    // Seuls les échecs sont exclus : une capture purgée sort d'elle-même de la requête (audio_path vidé).
    const echecs: string[] = [];
    let purges = 0;
    let liberes = 0;
    while (taille > this.seuils.bas) {
      const lot = await this.prisma.capture.findMany({
        where: {
          prive: false, audioPath: { not: null }, emisLe: { lt: avant }, etat: { in: ['classee', 'a_revoir'] },
          OR: [{ texteBrut: { not: null } }, { texteEcrit: { not: null } }], id: { notIn: echecs },
        },
        orderBy: [{ emisLe: 'asc' }, { id: 'asc' }], take: LOT, select: { id: true, audioPath: true },
      });
      if (lot.length === 0) break;
      for (const c of lot) {
        if (taille <= this.seuils.bas) break;
        const octets = await this.supprimer(c.audioPath!);
        if (octets === null) { echecs.push(c.id); continue; }
        await this.prisma.capture.update({ where: { id: c.id }, data: { audioPath: null, audioPurgeLe: this.maintenant() } });
        taille -= octets;
        liberes += octets;
        purges++;
      }
    }
    if (purges > 0) console.log(`Rotation de l'audio : ${purges} fichier(s) purgé(s), ${(liberes / GO).toFixed(2)} Go libérés.`);
    if (taille > this.seuils.haut) {
      if (!this.alerteActive) {
        this.alerteActive = true;
        await this.alerter('Audio au-delà du seuil de rotation, rien de plus à purger.');
      }
    } else {
      this.alerteActive = false;
    }
    return { purges, liberes };
  }

  /** Octets libérés ; 0 si le fichier n'existait plus ; null s'il n'a pas pu être supprimé (on n'efface pas la trace). */
  private async supprimer(chemin: string): Promise<number | null> {
    const absolu = resolve(this.racine, chemin);
    if (!absolu.startsWith(resolve(this.racine) + sep)) return null;
    try {
      const { size } = await stat(absolu);
      await rm(absolu);
      return size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      console.error(`Rotation de l'audio : fichier non supprimé (${(e as NodeJS.ErrnoException).code ?? 'erreur'})`);
      return null;
    }
  }
}
