import type { PrismaClient } from '@organizer/db';
import { ajouterJours, debutJour, isoLocal, jourLocal, type JourPensees, type VuePensees } from '@organizer/shared';
import { MoisInvalide } from '../privees/privees.service.js';

export interface FiltrePensees { theme?: string; personne?: string }

/** Pensées du compte (règle n° 1 : jamais mêlées aux actions, jamais cochables), hors captures privées et effacées. */
export class PenseesService {
  constructor(private readonly prisma: PrismaClient) {}

  async lister(utilisateurId: string, mois: string, fuseau: string, filtre: FiltrePensees): Promise<VuePensees> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) throw new MoisInvalide(mois);
    const premier = `${mois}-01`;
    const suivant = ajouterJours(`${mois}-28`, 4).slice(0, 7) + '-01';
    const toutes = { nature: 'pensee' as const, archiveLe: null, capture: { utilisateurId, prive: false } };
    const items = await this.prisma.item.findMany({
      where: {
        ...toutes,
        capture: { ...toutes.capture, emisLe: { gte: debutJour(premier, fuseau), lt: debutJour(suivant, fuseau) } },
        ...(filtre.theme ? { theme: { libelle: filtre.theme } } : {}),
        ...(filtre.personne ? { personnes: { has: filtre.personne } } : {}),
      },
      select: { id: true, captureId: true, texte: true, personnes: true, theme: { select: { libelle: true } }, capture: { select: { emisLe: true, audioPath: true } } },
      orderBy: [{ capture: { emisLe: 'desc' } }, { position: 'asc' }],
    });
    const jours = new Map<string, JourPensees['pensees']>();
    for (const i of items) {
      const jour = jourLocal(i.capture.emisLe, fuseau);
      jours.set(jour, [...(jours.get(jour) ?? []), {
        itemId: i.id, captureId: i.captureId, texte: i.texte, heure: isoLocal(i.capture.emisLe, fuseau).slice(11, 16),
        theme: i.theme?.libelle ?? null, personnes: i.personnes, aAudio: i.capture.audioPath !== null,
      }]);
    }
    // Les filtres proposés couvrent toutes les pensées du compte, pas seulement le mois affiché.
    const tout = await this.prisma.item.findMany({ where: toutes, select: { personnes: true, theme: { select: { libelle: true } } } });
    const trier = (v: Iterable<string>): string[] => [...new Set(v)].sort((a, b) => a.localeCompare(b, 'fr'));
    return {
      jours: [...jours].map(([jour, pensees]) => ({ jour, pensees })),
      themes: trier(tout.flatMap((i) => (i.theme ? [i.theme.libelle] : []))),
      personnes: trier(tout.flatMap((i) => i.personnes)),
    };
  }
}
