import { creerPrisma } from '@organizer/db';
import {
  creerFetchSortant, enfilerSynchro, FILE_AGENDA, FILE_ALERTES, OPTIONS_JOB_AGENDA, OPTIONS_JOB_ALERTE,
  type JobAgenda, type JobAlerte,
} from '@organizer/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Jetons } from './agenda/jetons.js';
import { lireConfigScheduler } from './configuration.js';
import { alerteurAgenda, demarrerFileAgenda, planifierBalayage, Signaleur } from './file.js';
import { ClientCalendrier } from './google/calendrier.js';
import { ClientOAuth } from './google/oauth.js';

const config = lireConfigScheduler();
if (!config) {
  console.log('Google Agenda non configuré (GOOGLE_CLIENT_ID absent) : scheduler arrêté.');
  process.exit(0);
}

const prisma = creerPrisma();
const connexion = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const sortant = creerFetchSortant();
const oauth = new ClientOAuth(config.google, sortant);
const calendrier = new ClientCalendrier(config.google.baseCalendrier, sortant);
const file = new Queue<JobAgenda>(FILE_AGENDA, { connection: connexion });
const alertes = new Queue<JobAlerte>(FILE_ALERTES, { connection: connexion });
// Alerte à l'administrateur seul, via la file `alertes` que l'API envoie aux comptes administrateurs.
const alerter = async (message: string): Promise<void> => { await alertes.add('alerte', { message }, OPTIONS_JOB_ALERTE); };
const signaleur = new Signaleur(alerter);
const jetons = new Jetons(prisma, oauth, config.cle, undefined, alerteurAgenda(signaleur, prisma));

// Une seule instance de scheduler, concurrence 1 : voir demarrerFileAgenda.
const worker = demarrerFileAgenda({
  prisma, oauth, calendrier, jetons, cle: config.cle, connexion, alerter, signaleur,
  enfilerSynchro: (itemId) => enfilerSynchro(file, itemId),
  enfilerBalayage: async (utilisateurId) => { await file.add('balayer', { type: 'balayer', utilisateurId }, OPTIONS_JOB_AGENDA); },
});
await planifierBalayage(file);

console.log('Scheduler démarré.');

let arret = false;
async function arreter(): Promise<void> {
  if (arret) return;
  arret = true;
  await worker.close();
  await Promise.all([file.close(), alertes.close(), prisma.$disconnect()]);
  connexion.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void arreter());
process.on('SIGINT', () => void arreter());
