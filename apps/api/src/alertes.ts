import type { PrismaClient } from '@organizer/db';
import { FILE_ALERTES, type JobAlerte } from '@organizer/shared';
import { Worker, type ConnectionOptions } from 'bullmq';
import type { Bot } from 'grammy';

/** L'API est le seul point d'envoi de messages : les alertes du worker passent par ici, vers l'admin seul. */
export function demarrerAlertes(connexion: ConnectionOptions, prisma: PrismaClient, bot: Bot): Worker<JobAlerte> {
  return new Worker<JobAlerte>(FILE_ALERTES, async (job) => {
    const admins = await prisma.utilisateur.findMany({ where: { admin: true, telegramChatId: { not: null } } });
    for (const a of admins) await bot.api.sendMessage(Number(a.telegramChatId), job.data.message);
  }, { connection: connexion });
}
