import { Prisma, type PrismaClient } from '@organizer/db';
import { ajouterJours, debutJour, isoLocal, jourLocal, type JourPrive } from '@organizer/shared';
import type { StockageAudio } from '../ingestion/stockage.js';
import type { Reencodeur } from './reencodeur.js';

export const FORMATS_ACCEPTES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/webm'];

export class FormatRefuse extends Error {
  override name = 'FormatRefuse';
}

export class IdentifiantRefuse extends Error {
  override name = 'IdentifiantRefuse';
}

export class CapturePriveeIntrouvable extends Error {
  override name = 'CapturePriveeIntrouvable';
}

export class MoisInvalide extends Error {
  override name = 'MoisInvalide';
}

export interface DepotPrive { id: string; donnees: Buffer; mime: string; emisLe: Date; dureeS: number | null }

export class CapturesPriveesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stockage: StockageAudio,
    private readonly reencodeur: Reencodeur,
  ) {}

  async enregistrer(utilisateurId: string, d: DepotPrive): Promise<{ id: string; nouvelle: boolean }> {
    if (!FORMATS_ACCEPTES.includes(d.mime)) throw new FormatRefuse(d.mime);
    const existante = await this.prisma.capture.findUnique({ where: { id: d.id }, select: { prive: true } });
    if (existante) {
      if (!existante.prive) throw new IdentifiantRefuse(d.id);
      return { id: d.id, nouvelle: false };
    }
    const opus = await this.reencodeur.versOpus(d.donnees);
    const audioPath = await this.stockage.ecrire(d.id, d.emisLe, opus, 'ogg', 'prive');
    try {
      // Une seule écriture : la capture naît privée (règle n° 6), avec son audio.
      await this.prisma.capture.create({
        data: {
          id: d.id, utilisateurId, canal: 'pwa', prive: true, etat: 'privee',
          audioPath, audioMime: 'audio/ogg', dureeS: d.dureeS, emisLe: d.emisLe,
        },
      });
      return { id: d.id, nouvelle: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { id: d.id, nouvelle: false };
      throw e;
    }
  }

  async etiqueter(id: string, etiquette: string | null): Promise<void> {
    const r = await this.prisma.capture.updateMany({ where: { id, prive: true }, data: { etiquette } });
    if (r.count === 0) throw new CapturePriveeIntrouvable(id);
  }

  async lister(mois: string, fuseau: string): Promise<JourPrive[]> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) throw new MoisInvalide(mois);
    const premier = `${mois}-01`;
    const suivant = ajouterJours(`${mois}-28`, 4).slice(0, 7) + '-01';
    const captures = await this.prisma.capture.findMany({
      where: { prive: true, emisLe: { gte: debutJour(premier, fuseau), lt: debutJour(suivant, fuseau) } },
      orderBy: { emisLe: 'desc' },
      select: { id: true, emisLe: true, dureeS: true, etiquette: true },
    });
    const jours = new Map<string, JourPrive['captures']>();
    for (const c of captures) {
      const jour = jourLocal(c.emisLe, fuseau);
      jours.set(jour, [...(jours.get(jour) ?? []), {
        id: c.id, heure: isoLocal(c.emisLe, fuseau).slice(11, 16), dureeS: c.dureeS, etiquette: c.etiquette,
      }]);
    }
    return [...jours].map(([jour, liste]) => ({ jour, captures: liste }));
  }
}
