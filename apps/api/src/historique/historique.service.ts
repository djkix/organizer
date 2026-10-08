import type { PrismaClient } from '@organizer/db';
import {
  ajouterJours, debutJour, debutTexte, isoLocal, jourLocal, NATURES,
  type DetailEnvoi, type EnvoiHistorique, type EtatEnvoi, type JourHistorique, type Nature, type StatutElement,
} from '@organizer/shared';
import { MoisInvalide } from '../privees/privees.service.js';

const etatEnvoi = (etat: string): EtatEnvoi => (etat === 'classee' ? 'classee' : etat === 'a_revoir' ? 'a_revoir' : 'en_cours');
const naturesDistinctes = (items: { nature: Nature }[]): Nature[] => NATURES.filter((n) => items.some((i) => i.nature === n));

/**
 * Historique des envois : les captures non privées du compte, en lecture seule. Une capture privée n'y figure
 * jamais, sous aucune forme (règle n° 6), et aucun texte n'est journalisé.
 */
export class HistoriqueService {
  constructor(private readonly prisma: PrismaClient) {}

  async lister(utilisateurId: string, mois: string, fuseau: string): Promise<JourHistorique[]> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) throw new MoisInvalide(mois);
    const premier = `${mois}-01`;
    const suivant = ajouterJours(`${mois}-28`, 4).slice(0, 7) + '-01';
    const captures = await this.prisma.capture.findMany({
      where: { utilisateurId, prive: false, emisLe: { gte: debutJour(premier, fuseau), lt: debutJour(suivant, fuseau) } },
      select: { id: true, canal: true, emisLe: true, dureeS: true, etat: true, texteBrut: true, texteEcrit: true, items: { select: { nature: true } } },
      orderBy: [{ emisLe: 'desc' }, { id: 'asc' }],
    });
    const jours = new Map<string, EnvoiHistorique[]>();
    for (const c of captures) {
      const jour = jourLocal(c.emisLe, fuseau);
      const envoi: EnvoiHistorique = {
        id: c.id, heure: isoLocal(c.emisLe, fuseau).slice(11, 16), source: c.canal, vocal: c.texteEcrit === null,
        dureeS: c.dureeS, debut: debutTexte(c.texteBrut ?? c.texteEcrit), etat: etatEnvoi(c.etat), natures: naturesDistinctes(c.items),
      };
      jours.set(jour, [...(jours.get(jour) ?? []), envoi]);
    }
    return [...jours].map(([jour, envois]) => ({ jour, envois }));
  }

  /** `undefined` : capture privée, inconnue ou d'un autre compte (404 pour tous, décision 25). */
  async detail(utilisateurId: string, captureId: string): Promise<DetailEnvoi | undefined> {
    const c = await this.prisma.capture.findFirst({
      where: { id: captureId, utilisateurId, prive: false },
      select: {
        id: true, canal: true, emisLe: true, dureeS: true, etat: true, texteBrut: true, texteEcrit: true, audioPath: true,
        items: { select: { id: true, texte: true, nature: true, archiveLe: true, action: { select: { faitLe: true } } }, orderBy: { position: 'asc' } },
      },
    });
    if (!c) return undefined;
    const statut = (i: (typeof c.items)[number]): StatutElement =>
      i.archiveLe ? 'efface' : i.action ? (i.action.faitLe ? 'fait' : 'a_faire') : 'note';
    return {
      id: c.id, emisLe: c.emisLe.toISOString(), source: c.canal, vocal: c.texteEcrit === null, dureeS: c.dureeS,
      etat: etatEnvoi(c.etat), texte: c.texteBrut ?? c.texteEcrit, aAudio: c.audioPath !== null,
      elements: c.items.map((i) => ({ itemId: i.id, texte: i.texte, nature: i.nature, statut: statut(i) })),
    };
  }
}
