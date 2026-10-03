import type { Prisma, PrismaClient } from '@organizer/db';
import {
  ajouterJours, debutJour, jourLocal,
  type CaptureARevoir, type ItemARevoir, type LigneAction,
  type VueARevoir, type VueAujourdhui, type VueHorizons, type VueSemaine,
} from '@organizer/shared';

const MAX_AUJOURDHUI = 7;
const MAX_SUGGESTIONS = 3;
const HORIZON_SUGGESTIONS_JOURS = 14;
const MAX_LISTE = 20;
const TYPES_DATES = ['datee', 'jour', 'relative'];

const ouvertes = { nature: 'action', archiveLe: null, action: { is: { faitLe: null } } } satisfies Prisma.ItemWhereInput;
const inclure = { action: true, theme: true, capture: { select: { audioPath: true } } } satisfies Prisma.ItemInclude;
type ItemComplet = Prisma.ItemGetPayload<{ include: typeof inclure }>;

function ligne(it: ItemComplet): LigneAction {
  return {
    itemId: it.id,
    captureId: it.captureId,
    texte: it.texte,
    theme: it.theme?.libelle ?? null,
    echeanceType: it.action?.echeanceType ?? null,
    echeanceExpr: it.action?.echeanceExpr ?? null,
    echeanceDate: it.action?.echeanceDate?.toISOString() ?? null,
    fenetreFin: it.action?.fenetreFin?.toISOString() ?? null,
    alarme: it.action?.alarme ?? false,
    aAudio: it.capture.audioPath !== null,
  };
}

export class VuesService {
  constructor(private readonly prisma: PrismaClient) {}

  private datees(debut: Date, fin: Date, max: number): Promise<ItemComplet[]> {
    return this.prisma.item.findMany({
      where: { ...ouvertes, action: { is: { faitLe: null, echeanceType: { in: TYPES_DATES }, echeanceDate: { gte: debut, lt: fin } } } },
      include: inclure, orderBy: [{ action: { echeanceDate: 'asc' } }, { id: 'asc' }], take: max,
    });
  }

  private fenetres(debut: Date, fin: Date | undefined, max: number): Promise<ItemComplet[]> {
    return this.prisma.item.findMany({
      where: { ...ouvertes, action: { is: { faitLe: null, echeanceType: 'fenetre', fenetreFin: { gte: debut, ...(fin ? { lt: fin } : {}) } } } },
      include: inclure, orderBy: [{ action: { fenetreFin: 'asc' } }, { id: 'asc' }], take: max,
    });
  }

  async aujourdhui(maintenant: Date, fuseau: string): Promise<VueAujourdhui> {
    const jour = jourLocal(maintenant, fuseau);
    const debut = debutJour(jour, fuseau);
    const actions = await this.datees(debut, debutJour(ajouterJours(jour, 1), fuseau), MAX_AUJOURDHUI);
    const place = Math.min(MAX_SUGGESTIONS, MAX_AUJOURDHUI - actions.length);
    const suggestions = place > 0
      ? await this.fenetres(debut, debutJour(ajouterJours(jour, HORIZON_SUGGESTIONS_JOURS), fuseau), place)
      : [];
    return { jour, actions: actions.map(ligne), suggestions: suggestions.map(ligne) };
  }

  async semaine(maintenant: Date, fuseau: string): Promise<VueSemaine> {
    const jour = jourLocal(maintenant, fuseau);
    const items = await this.datees(debutJour(jour, fuseau), debutJour(ajouterJours(jour, 7), fuseau), MAX_LISTE);
    const jours = new Map<string, LigneAction[]>();
    for (const it of items) {
      const j = jourLocal(it.action!.echeanceDate!, fuseau);
      jours.set(j, [...(jours.get(j) ?? []), ligne(it)]);
    }
    return { jours: [...jours].map(([j, actions]) => ({ jour: j, actions })) };
  }

  async horizons(maintenant: Date, fuseau: string): Promise<VueHorizons> {
    const items = await this.fenetres(debutJour(jourLocal(maintenant, fuseau), fuseau), undefined, MAX_LISTE);
    const bornes = new Map<string, { libelle: string | null; actions: LigneAction[] }>();
    for (const it of items) {
      const fin = it.action!.fenetreFin!.toISOString();
      const b = bornes.get(fin) ?? { libelle: null, actions: [] };
      b.libelle ??= it.action!.echeanceExpr;
      b.actions.push(ligne(it));
      bornes.set(fin, b);
    }
    return { bornes: [...bornes].map(([fin, b]) => ({ fin, ...b })) };
  }

  async aRevoir(): Promise<VueARevoir> {
    const items = await this.prisma.item.findMany({
      where: { nature: 'ambigu', archiveLe: null, capture: { prive: false } },
      include: { capture: { select: { emisLe: true, audioPath: true } } },
      orderBy: [{ capture: { emisLe: 'desc' } }, { id: 'asc' }], take: MAX_LISTE,
    });
    const captures = await this.prisma.capture.findMany({
      where: { etat: 'a_revoir', prive: false }, orderBy: [{ emisLe: 'desc' }, { id: 'asc' }], take: MAX_LISTE,
    });
    // Budget commun : les plus récents d'abord, toutes sortes confondues, puis séparés.
    const retenus = [
      ...items.map((i) => ({ emisLe: i.capture.emisLe, id: i.id, item: i })),
      ...captures.map((c) => ({ emisLe: c.emisLe, id: c.id, capture: c })),
    ].sort((a, b) => b.emisLe.getTime() - a.emisLe.getTime() || (a.id < b.id ? -1 : 1)).slice(0, MAX_LISTE);
    return {
      items: retenus.flatMap((r) => (r.item ? [r.item] : [])).map((i): ItemARevoir => ({
        itemId: i.id, captureId: i.captureId, texte: i.texte,
        emisLe: i.capture.emisLe.toISOString(), aAudio: i.capture.audioPath !== null,
      })),
      captures: retenus.flatMap((r) => (r.capture ? [r.capture] : [])).map((c): CaptureARevoir => ({
        captureId: c.id, texte: c.texteBrut ?? c.texteEcrit, emisLe: c.emisLe.toISOString(), aAudio: c.audioPath !== null,
      })),
    };
  }
}
