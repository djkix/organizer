import { resolve, sep } from 'node:path';
import { Prisma, type PrismaClient } from '@organizer/db';
import { DELAI_SYNCHRO_COCHAGE_MS, type CorpsCorrection } from '@organizer/shared';
import { SANS_AGENDA, type SignalAgenda } from '../agenda/signal.js';

export type CorrectionItem = CorpsCorrection;

export class ItemIntrouvable extends Error {
  override name = 'ItemIntrouvable';
}

export class CorrectionInvalide extends Error {
  override name = 'CorrectionInvalide';
}

export const MESSAGE_ALARME_SANS_HEURE = "L'alarme demande un jour et une heure.";

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
    private readonly agenda: SignalAgenda = SANS_AGENDA,
  ) {}

  async cocher(itemId: string): Promise<void> {
    await this.exigerAction(itemId);
    await this.prisma.action.updateMany({ where: { itemId, faitLe: null }, data: { faitLe: this.maintenant() } });
    await this.agenda.signaler(itemId, DELAI_SYNCHRO_COCHAGE_MS);
  }

  async decocher(itemId: string): Promise<void> {
    await this.exigerAction(itemId);
    await this.prisma.action.update({ where: { itemId }, data: { faitLe: null } });
    await this.agenda.signaler(itemId);
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
        // Hors action, plus d'événement : l'alarme ne survit pas au changement de nature.
        if (c.nature !== 'action' && it.action?.alarme) await tx.action.update({ where: { itemId }, data: { alarme: false, alarmeExpr: null } });
        if (c.nature === 'pensee' && !it.pensee) await tx.pensee.create({ data: { itemId } });
      }
      if (c.echeance) {
        if (nature !== 'action') throw new CorrectionInvalide('Seule une action a une échéance.');
        if (!this.typesEcheance.includes(c.echeance.type)) throw new CorrectionInvalide("Type d'échéance inconnu.");
        const nouvelle = colonnes(c.echeance);
        const a = await tx.action.findUnique({ where: { itemId } });
        const sansHeure = nouvelle.echeanceType !== 'datee' ? { alarme: false, alarmeExpr: null } : {};
        await tx.action.upsert({ where: { itemId }, create: { itemId, ...nouvelle }, update: { ...nouvelle, echeanceExpr: null, ...sansHeure } });
        await tx.correction.create({
          data: {
            itemId, champ: 'echeance',
            ancienneValeur: a
              ? { type: a.echeanceType, expr: a.echeanceExpr, date: iso(a.echeanceDate), debut: iso(a.fenetreDebut), fin: iso(a.fenetreFin) }
              : Prisma.JsonNull,
            nouvelleValeur: {
              type: nouvelle.echeanceType, expr: null, date: iso(nouvelle.echeanceDate),
              debut: iso(nouvelle.fenetreDebut), fin: iso(nouvelle.fenetreFin),
            },
          },
        });
      }
      if (c.alarme !== undefined) {
        const a = nature === 'action' ? await tx.action.findUnique({ where: { itemId } }) : null;
        if (!a) throw new CorrectionInvalide('Seule une action a une alarme.');
        if (c.alarme && (a.echeanceType !== 'datee' || !a.echeanceDate)) throw new CorrectionInvalide(MESSAGE_ALARME_SANS_HEURE);
        if (a.alarme !== c.alarme) {
          await tx.action.update({ where: { itemId }, data: { alarme: c.alarme } });
          // Historisée : les bascules serviront à trouver les formulations qui demandent l'alarme.
          await tx.correction.create({ data: { itemId, champ: 'alarme', ancienneValeur: a.alarme, nouvelleValeur: c.alarme } });
        }
      }
    });
    await this.agenda.signaler(itemId);
  }

  definirAlarme(itemId: string, alarme: boolean): Promise<void> {
    return this.corriger(itemId, { alarme });
  }

  async cheminAudio(captureId: string, racine: string): Promise<{ chemin: string; mime: string } | null> {
    // `chemin` est relatif à la racine.
    const c = await this.prisma.capture.findUnique({ where: { id: captureId }, select: { audioPath: true, audioMime: true } });
    if (!c?.audioPath) return null;
    if (!resolve(racine, c.audioPath).startsWith(resolve(racine) + sep)) return null;
    return { chemin: c.audioPath, mime: c.audioMime ?? 'application/octet-stream' };
  }

  private async exigerAction(itemId: string): Promise<void> {
    const it = await this.prisma.item.findUnique({ where: { id: itemId }, include: { action: true } });
    if (!it || it.nature !== 'action' || !it.action) throw new ItemIntrouvable(itemId);
  }
}
