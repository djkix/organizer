import type { PrismaClient } from '@organizer/db';
import { FILE_ALERTES, type JobAlerte } from '@organizer/shared';
import { Worker, type ConnectionOptions } from 'bullmq';
import type { Bot } from 'grammy';

/**
 * Envoie l'alerte à chaque admin lié, chacun dans son propre essai. Si un envoi échoue, l'erreur
 * remonte après les autres : BullMQ réessaie le job (un admin déjà servi peut la recevoir deux fois).
 */
export async function envoyerAlerte(message: string, prisma: PrismaClient, bot: Bot): Promise<void> {
  const admins = await prisma.utilisateur.findMany({ where: { admin: true, telegramChatId: { not: null } } });
  // Le texte d'alerte est un message technique, jamais un contenu de capture : il peut être journalisé.
  if (admins.length === 0) {
    console.error(`Alerte sans destinataire : ${message}`);
    return;
  }
  let echecs = 0;
  for (const a of admins) {
    try {
      await bot.api.sendMessage(Number(a.telegramChatId), message);
    } catch (err) {
      echecs++;
      console.error(`Alerte non remise à l'admin ${a.id} (${(err as Error).name})`);
    }
  }
  if (echecs > 0) throw new Error(`Alerte non remise à ${echecs} admin(s)`);
}

/** L'API est le seul point d'envoi de messages : les alertes du worker passent par ici, vers l'admin seul. */
export function demarrerAlertes(connexion: ConnectionOptions, prisma: PrismaClient, bot: Bot): Worker<JobAlerte> {
  return new Worker<JobAlerte>(FILE_ALERTES, (job) => envoyerAlerte(job.data.message, prisma, bot), { connection: connexion });
}
