import type { PrismaClient } from '@organizer/db';
import { dateHeureEnClair, FILE_PROPOSITIONS, MINUTES_ALARME, titreCourt, type JobProposition } from '@organizer/shared';
import { Worker, type ConnectionOptions } from 'bullmq';
import { InlineKeyboard, type Bot } from 'grammy';
import type { ItemsService } from '../items/items.service.js';

/** Au-delà, le bouton arriverait à contretemps (classement en rattrapage) : rien n'est proposé. */
export const FRAICHEUR_PROPOSITION_MS = 15 * 60_000;
export const LIBELLE_AVEC_ALARME = 'Avec alarme';
export const LIBELLE_SANS_ALARME = 'Sans alarme';
export const MOTIF_ALARME = /^alarme:([01]):([0-9a-f-]{36})$/;

const majuscule = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** « Dentiste : mercredi 14 octobre, 10:00. », et la phrase de l'alarme quand elle est posée. */
export function texteRendezVous(texte: string, date: Date, fuseau: string, alarme: boolean): string {
  // Moins de 12 mots, alarme comprise : titre de 24 caractères et 3 mots au plus.
  const titre = titreCourt(texte, 24).split(/\s+/).slice(0, 3).join(' ');
  const base = `${majuscule(titre)}, ${dateHeureEnClair(date, fuseau)}.`;
  return alarme ? `${base} Alarme ${MINUTES_ALARME} minutes avant.` : base;
}

/** Le bouton porte la valeur voulue, jamais « basculer » : un appui relivré par Telegram ne défait rien. */
export function clavierAlarme(itemId: string, alarme: boolean): InlineKeyboard {
  return alarme
    ? new InlineKeyboard().text(LIBELLE_SANS_ALARME, `alarme:0:${itemId}`)
    : new InlineKeyboard().text(LIBELLE_AVEC_ALARME, `alarme:1:${itemId}`);
}

export interface DepsPropositions { prisma: PrismaClient; bot: Bot; maintenant?: () => Date }

/**
 * Juste après le classement d'une capture Telegram : un message silencieux par rendez-vous daté à venir, en réponse
 * au vocal, avec le bouton. Seulement si l'agenda du compte est connecté, si la capture est fraîche, et une seule fois.
 */
export async function proposerAlarmes(captureId: string, d: DepsPropositions): Promise<number> {
  const maintenant = (d.maintenant ?? (() => new Date()))();
  const c = await d.prisma.capture.findUnique({
    where: { id: captureId },
    include: { utilisateur: { include: { agenda: true } }, items: { include: { action: true }, orderBy: { position: 'asc' } } },
  });
  if (!c || c.prive || c.canal !== 'telegram' || !c.utilisateur.telegramChatId) return 0;
  if (c.utilisateur.agenda?.etat !== 'connecte') return 0;
  if (maintenant.getTime() - c.recuLe.getTime() > FRAICHEUR_PROPOSITION_MS) return 0;
  const messageId = /^tg:-?\d+:(\d+)$/.exec(c.sourceRef ?? '')?.[1];
  let n = 0;
  for (const it of c.items) {
    const a = it.action;
    if (it.nature !== 'action' || !a || a.echeanceType !== 'datee' || !a.echeanceDate || a.faitLe || a.alarmeProposeeLe) continue;
    if (a.echeanceDate.getTime() <= maintenant.getTime()) continue;
    // Marqué AVANT l'envoi : au plus une proposition, même si l'envoi échoue ou si le job est rejoué.
    const { count } = await d.prisma.action.updateMany({ where: { itemId: it.id, alarmeProposeeLe: null }, data: { alarmeProposeeLe: maintenant } });
    if (count === 0) continue;
    await d.bot.api.sendMessage(Number(c.utilisateur.telegramChatId), texteRendezVous(it.texte, a.echeanceDate, c.utilisateur.fuseau, a.alarme), {
      disable_notification: true,
      reply_markup: clavierAlarme(it.id, a.alarme),
      ...(messageId ? { reply_parameters: { message_id: Number(messageId), allow_sending_without_reply: true } } : {}),
    });
    n++;
  }
  return n;
}

/** L'appui sur le bouton : seulement le compte du chat, une action datée à venir et non cochée. */
export class Alarmes {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly items: Pick<ItemsService, 'definirAlarme'>,
    private readonly maintenant: () => Date = () => new Date(),
  ) {}

  async definir(utilisateurId: string, itemId: string, alarme: boolean): Promise<{ texte: string; alarme: boolean } | null> {
    const it = await this.prisma.item.findUnique({ where: { id: itemId }, include: { action: true, capture: { include: { utilisateur: true } } } });
    const a = it?.action;
    if (!it || it.capture.utilisateurId !== utilisateurId || it.nature !== 'action' || !a || it.capture.prive || it.archiveLe) return null;
    if (a.echeanceType !== 'datee' || !a.echeanceDate || a.faitLe || a.echeanceDate.getTime() <= this.maintenant().getTime()) return null;
    await this.items.definirAlarme(itemId, alarme);
    return { texte: texteRendezVous(it.texte, a.echeanceDate, it.capture.utilisateur.fuseau, alarme), alarme };
  }
}

export function demarrerPropositions(connexion: ConnectionOptions, prisma: PrismaClient, bot: Bot): Worker<JobProposition> {
  return new Worker<JobProposition>(FILE_PROPOSITIONS, (job) => proposerAlarmes(job.data.captureId, { prisma, bot }), { connection: connexion });
}
