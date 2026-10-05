import type { PrismaClient } from '@organizer/db';
import { AutorisationRetiree, type Jetons } from './jetons.js';
import { planifier } from './plan.js';
import { etatSynchro, inclusionAction } from './synchroniser.js';

/** Un jeton de rafraîchissement inutilisé six mois expire chez Google : on le fait servir au moins chaque semaine. */
export const ENTRETIEN_MS = 7 * 24 * 3600_000;

export interface DepsBalayage {
  prisma: PrismaClient;
  jetons: Pick<Jetons, 'rafraichir'>;
  enfiler(itemId: string): Promise<void>;
  surRevocation?(uid: string): Promise<void>;
  maintenant?: () => Date;
  /** Taille des lots de lecture (comptes et actions) : la mémoire reste bornée quel que soit le volume. */
  lot?: number;
}

export const LOT_BALAYAGE = 200;

/**
 * Filet de sécurité : recalcule l'écart de chaque action datée ou déjà synchronisée des comptes connectés
 * et n'enfile que les divergentes. Aucun appel à l'agenda ici ; seul l'entretien du jeton touche Google.
 */
export async function balayer(d: DepsBalayage, utilisateurId?: string): Promise<number> {
  const maintenant = (d.maintenant ?? (() => new Date()))();
  const lot = d.lot ?? LOT_BALAYAGE;
  let n = 0;
  let apresCompte: string | undefined;
  for (;;) {
    const comptes = await d.prisma.agendaGoogle.findMany({
      where: { etat: 'connecte', calendrierId: { not: null }, ...(utilisateurId ? { utilisateurId } : {}) },
      orderBy: { utilisateurId: 'asc' }, take: lot, ...(apresCompte ? { cursor: { utilisateurId: apresCompte }, skip: 1 } : {}),
    });
    if (comptes.length === 0) break;
    apresCompte = comptes[comptes.length - 1]!.utilisateurId;
    for (const g of comptes) n += await balayerCompte(d, g, maintenant, lot);
    if (comptes.length < lot) break;
  }
  return n;
}

type Compte = { utilisateurId: string; calendrierId: string | null; rafraichiLe: Date | null };

async function balayerCompte(d: DepsBalayage, g: Compte, maintenant: Date, lot: number): Promise<number> {
  let n = 0;
  let apres: string | undefined;
  for (;;) {
    const actions = await d.prisma.action.findMany({
      where: { item: { capture: { utilisateurId: g.utilisateurId } }, OR: [{ echeanceType: 'datee' }, { evenementId: { not: null } }] },
      include: inclusionAction, orderBy: { itemId: 'asc' }, take: lot, ...(apres ? { cursor: { itemId: apres }, skip: 1 } : {}),
    });
    if (actions.length === 0) break;
    apres = actions[actions.length - 1]!.itemId;
    for (const a of actions) {
      if (planifier(etatSynchro(a), g.calendrierId!, maintenant).type === 'rien') continue;
      try {
        await d.enfiler(a.itemId);
        n++;
      } catch (e) {
        // Le balayage suivant rattrape ; un enfilage en panne ne doit pas priver les autres comptes.
        console.error(`Agenda : enfilage reporté (${(e as Error).name})`);
      }
    }
    if (actions.length < lot) break;
  }
  if (!g.rafraichiLe || g.rafraichiLe.getTime() < maintenant.getTime() - ENTRETIEN_MS) {
    try {
      await d.jetons.rafraichir(g.utilisateurId);
    } catch (e) {
      if (e instanceof AutorisationRetiree) await d.surRevocation?.(g.utilisateurId);
      else console.error(`Agenda : entretien du jeton de ${g.utilisateurId} reporté (${(e as Error).name})`);
    }
  }
  return n;
}
