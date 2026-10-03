import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@organizer/db';
import type { Nature } from '@organizer/shared';

export interface CorrectionItem {
  nature?: Nature;
  echeance?: { type: string; date?: string | null; debut?: string | null; fin?: string | null };
}

export class ItemIntrouvable extends Error {
  override name = 'ItemIntrouvable';
}

export class CorrectionInvalide extends Error {
  override name = 'CorrectionInvalide';
}

const TYPES_DATES = ['datee', 'jour', 'relative'];

function date(valeur: string | null | undefined): Date | null {
  if (valeur === null || valeur === undefined) return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(valeur) || Number.isNaN(Date.parse(valeur))) {
    throw new CorrectionInvalide('Date attendue au format ISO, avec fuseau.');
  }
  return new Date(valeur);
}

function colonnes(e: NonNullable<CorrectionItem['echeance']>) {
  if (e.type === 'aucune') return { echeanceType: 'aucune', echeanceDate: null, fenetreDebut: null, fenetreFin: null };
  const c = { echeanceType: e.type, echeanceDate: date(e.date), fenetreDebut: date(e.debut), fenetreFin: date(e.fin) };
  if (TYPES_DATES.includes(e.type) && !c.echeanceDate) throw new CorrectionInvalide('Cette échéance demande une date.');
  if (e.type === 'fenetre' && !c.fenetreFin) throw new CorrectionInvalide('Une fenêtre demande une date de fin.');
  return c;
}

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

export class ItemsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly typesEcheance: string[],
    private readonly maintenant: () => Date = () => new Date(),
  ) {}

  async cocher(itemId: string): Promise<void> {
    await this.exigerAction(itemId);
    await this.prisma.action.updateMany({ where: { itemId, faitLe: null }, data: { faitLe: this.maintenant() } });
  }

  async decocher(itemId: string): Promise<void> {
    await this.exigerAction(itemId);
    await this.prisma.action.update({ where: { itemId }, data: { faitLe: null } });
  }

  async corriger(itemId: string, c: CorrectionItem): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const it = await tx.item.findUnique({ where: { id: itemId }, include: { action: true, pensee: true } });
      if (!it) throw new ItemIntrouvable(itemId);
      const nature = c.nature ?? it.nature;
      if (c.nature && c.nature !== it.nature) {
        await tx.item.update({ where: { id: itemId }, data: { nature: c.nature } });
        await tx.correction.create({ data: { itemId, champ: 'nature', ancienneValeur: it.nature, nouvelleValeur: c.nature } });
        if (c.nature === 'action' && !it.action) await tx.action.create({ data: { itemId } });
        if (c.nature === 'pensee' && !it.pensee) await tx.pensee.create({ data: { itemId } });
      }
      if (c.echeance) {
        if (nature !== 'action') throw new CorrectionInvalide('Seule une action a une échéance.');
        if (!this.typesEcheance.includes(c.echeance.type)) throw new CorrectionInvalide("Type d'échéance inconnu.");
        const nouvelle = colonnes(c.echeance);
        const a = await tx.action.findUnique({ where: { itemId } });
        await tx.action.upsert({ where: { itemId }, create: { itemId, ...nouvelle }, update: nouvelle });
        await tx.correction.create({
          data: {
            itemId, champ: 'echeance',
            ancienneValeur: a
              ? { type: a.echeanceType, date: iso(a.echeanceDate), debut: iso(a.fenetreDebut), fin: iso(a.fenetreFin) }
              : Prisma.JsonNull,
            nouvelleValeur: {
              type: nouvelle.echeanceType, date: iso(nouvelle.echeanceDate),
              debut: iso(nouvelle.fenetreDebut), fin: iso(nouvelle.fenetreFin),
            },
          },
        });
      }
    });
  }

  async cheminAudio(captureId: string, racine: string): Promise<{ chemin: string; mime: string } | null> {
    const c = await this.prisma.capture.findUnique({ where: { id: captureId }, select: { audioPath: true, audioMime: true } });
    if (!c?.audioPath) return null;
    return { chemin: join(racine, c.audioPath), mime: c.audioMime ?? 'application/octet-stream' };
  }

  private async exigerAction(itemId: string): Promise<void> {
    const it = await this.prisma.item.findUnique({ where: { id: itemId }, include: { action: true } });
    if (!it || it.nature !== 'action' || !it.action) throw new ItemIntrouvable(itemId);
  }
}
