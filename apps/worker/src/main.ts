import { creerPrisma } from '@organizer/db';
import {
  chargerPrompt, exigerVar, FILE_ALERTES, FILE_CLASSEMENT, lireVar, OPTIONS_JOB_ALERTE,
  type JobAlerte, type JobClassement,
} from '@organizer/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { GeminiProvider } from './classement/gemini.js';
import { PalierNonPaye } from './classement/provider.js';
import { verifierPalierAuDemarrage } from './demarrage.js';
import { demarrerWorker, reprendre } from './worker.js';

const prisma = creerPrisma();
const connexion = new Redis(exigerVar('REDIS_URL'), { maxRetriesPerRequest: null });
const prompt = chargerPrompt(lireVar('PROMPTS_DIR') ?? '../../prompts', lireVar('PROMPT_VERSION') ?? 'tri/v1');
const provider = new GeminiProvider({
  cle: exigerVar('GEMINI_API_KEY'),
  modele: lireVar('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite',
  repli: lireVar('GEMINI_MODEL_FALLBACK') ?? 'gemini-3.8-flash',
  prompt,
  tiersPayes: (lireVar('GEMINI_TIERS_PAYES') ?? 'standard').split(',').map((s) => s.trim()),
});

// Règle n° 8 : pas de palier payé, pas de worker.
try {
  await verifierPalierAuDemarrage(provider, (ms) => new Promise((r) => setTimeout(r, ms)), console.error);
} catch (e) {
  if (!(e instanceof PalierNonPaye)) throw e;
  console.error('Palier Gemini non payé : le worker refuse de démarrer.');
  process.exit(1);
}

const alertes = new Queue<JobAlerte>(FILE_ALERTES, { connection: connexion });
const file = new Queue<JobClassement>(FILE_CLASSEMENT, { connection: connexion });
const worker = demarrerWorker({
  prisma, provider, prompt,
  audioRacine: exigerVar('AUDIO_STORAGE_PATH'),
  connexion,
  concurrence: Number(lireVar('WORKER_CONCURRENCY') ?? '2'),
  alerter: async (message) => { await alertes.add('alerte', { message }, OPTIONS_JOB_ALERTE); },
});

const lancerReprise = (): void => {
  reprendre(prisma, file).catch((e: unknown) => console.error(`Reprise impossible : ${(e as Error).name}`));
};
// Une fois au démarrage (captures orphelines d'un arrêt ou d'une perte de Valkey), puis toutes les heures.
lancerReprise();
const minuterie = setInterval(lancerReprise, 60 * 60_000);

console.log(`Worker démarré. Prompt ${prompt.version}, concurrence ${worker.opts.concurrency}.`);

async function arreter(): Promise<void> {
  clearInterval(minuterie);
  await worker.close();
  await Promise.all([file.close(), alertes.close(), prisma.$disconnect()]);
  connexion.disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void arreter());
process.on('SIGINT', () => void arreter());
