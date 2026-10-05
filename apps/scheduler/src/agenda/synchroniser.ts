import type { Prisma, PrismaClient } from '@organizer/db';
import type { ClientCalendrier, CorpsEvenement } from '../google/calendrier.js';
import { DejaPresent, Introuvable } from '../google/erreurs.js';
import { contenuEvenement, empreinteContenu, idEvenement, type ActionPourAgenda } from './contenu.js';
import { alerterSansEchec, appelerAvecJeton, type Alerteur, type Jetons } from './jetons.js';
import { planifier, type EtatSynchro } from './plan.js';

export class AgendaSupprime extends Error {
  override name = 'AgendaSupprime';
  constructor(readonly utilisateurId: string) {
    super(`Agenda Organizer supprimé pour ${utilisateurId}`);
  }
}

export interface DepsSynchro { prisma: PrismaClient; calendrier: ClientCalendrier; jetons: Jetons; maintenant?: () => Date; alerter?: Alerteur }
export type IssueSynchro = 'rien' | 'cree' | 'remplace' | 'supprime' | 'sans_agenda';

export const inclusionAction = {
  item: { include: { capture: { include: { utilisateur: { include: { agenda: true } } } } } },
} satisfies Prisma.ActionInclude;
export type ActionChargee = Prisma.ActionGetPayload<{ include: typeof inclusionAction }>;

export function versActionPourAgenda(a: ActionChargee): ActionPourAgenda {
  return {
    itemId: a.itemId, texte: a.item.texte, nature: a.item.nature, prive: a.item.capture.prive, archiveLe: a.item.archiveLe,
    echeanceType: a.echeanceType, echeanceDate: a.echeanceDate, faitLe: a.faitLe, alarme: a.alarme,
    fuseau: a.item.capture.utilisateur.fuseau,
  };
}

export function etatSynchro(a: ActionChargee): EtatSynchro {
  return {
    contenu: contenuEvenement(versActionPourAgenda(a)),
    evenementId: a.evenementId, calendrierId: a.evenementCalendrierId, empreinte: a.evenementEmpreinte,
  };
}

/** Une insertion qui répond 404 : l'agenda a-t-il disparu (supprimé par L) ? */
async function verifierAgenda(d: DepsSynchro, uid: string, agenda: string): Promise<void> {
  if (await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.agendaExiste(j, agenda))) return;
  const { count } = await d.prisma.agendaGoogle.updateMany({
    where: { utilisateurId: uid, calendrierId: agenda, etat: 'connecte' }, data: { etat: 'agenda_supprime' },
  });
  if (count === 1) await alerterSansEchec(d.alerter, { type: 'agenda_supprime', utilisateurId: uid });
  throw new AgendaSupprime(uid);
}

/** Insère sous la génération donnée ; un 409 sur notre propre événement devient un remplacement. Renvoie la génération écrite. */
async function creer(d: DepsSynchro, uid: string, agenda: string, itemId: string, corps: CorpsEvenement, generation: number): Promise<number> {
  for (let g = generation; g < generation + 3; g++) {
    const id = idEvenement(itemId, g);
    try {
      await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.inserer(j, agenda, id, corps));
      return g;
    } catch (e) {
      if (e instanceof Introuvable) {
        await verifierAgenda(d, uid, agenda);
        throw e;
      }
      if (!(e instanceof DejaPresent)) throw e;
      const lu = await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.lire(j, agenda, id));
      if (lu && lu.status !== 'cancelled') {
        await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.remplacer(j, agenda, id, corps));
        return g;
      }
      // Identifiant gardé par Google pour un événement supprimé : génération suivante.
    }
  }
  throw new Error(`Événement de l'item ${itemId} : trois identifiants déjà pris`);
}

/**
 * Réconcilie une action avec son événement : relit l'état en base, ne fait que l'écart, note le résultat.
 * Idempotent : rejoué, il ne fait rien de plus. Jamais un titre ni un jeton dans un journal.
 */
export async function synchroniserAction(itemId: string, d: DepsSynchro): Promise<IssueSynchro> {
  const a = await d.prisma.action.findUnique({ where: { itemId }, include: inclusionAction });
  if (!a) return 'rien';
  const uid = a.item.capture.utilisateurId;
  const g = a.item.capture.utilisateur.agenda;
  if (!g || g.etat !== 'connecte' || !g.calendrierId) return 'sans_agenda';
  const agenda = g.calendrierId;
  if (a.evenementId && !a.evenementCalendrierId) {
    // Calendrier inconnu : on ne sait pas où chercher l'événement. Rien à distance ; on oublie l'ancien identifiant
    // et on passe à la génération suivante pour ne pas retomber sur lui.
    const nettoye = { evenementId: null, evenementCalendrierId: null, evenementEmpreinte: null, evenementGeneration: a.evenementGeneration + 1 };
    await d.prisma.action.update({ where: { itemId }, data: nettoye });
    return synchroniserAction(itemId, d);
  }
  const etat = etatSynchro(a);
  const plan = planifier(etat, agenda, (d.maintenant ?? (() => new Date()))());
  if (plan.type === 'rien') return 'rien';

  if (plan.type === 'supprimer') {
    await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.supprimer(j, a.evenementCalendrierId!, a.evenementId!));
    await d.prisma.action.update({
      where: { itemId },
      data: { evenementId: null, evenementCalendrierId: null, evenementEmpreinte: null, evenementGeneration: a.evenementGeneration + 1 },
    });
    return 'supprime';
  }

  const corps = etat.contenu!;
  let generation = a.evenementGeneration;
  if (plan.type === 'remplacer') {
    const lu = await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.lire(j, agenda, a.evenementId!));
    if (lu && lu.status !== 'cancelled') {
      await appelerAvecJeton(d.jetons, uid, (j) => d.calendrier.remplacer(j, agenda, a.evenementId!, corps));
      await d.prisma.action.update({ where: { itemId }, data: { evenementEmpreinte: empreinteContenu(corps) } });
      return 'remplace';
    }
    // Supprimé par L dans Google, et l'action a changé depuis : un nouvel événement la suit.
    generation += 1;
  }
  const ecrite = await creer(d, uid, agenda, itemId, corps, generation);
  await d.prisma.action.update({
    where: { itemId },
    data: {
      evenementId: idEvenement(itemId, ecrite), evenementCalendrierId: agenda,
      evenementEmpreinte: empreinteContenu(corps), evenementGeneration: ecrite,
    },
  });
  return 'cree';
}
