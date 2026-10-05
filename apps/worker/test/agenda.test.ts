import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { chargerPrompt, OPTIONS_JOB_PROPOSITION, type JobClassement } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apresClassement } from '../src/agenda.js';
import { demarrerWorker } from '../src/worker.js';
import { creerCaptureTexte, FauxProvider } from './aides.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');
afterAll(async () => { await prisma.$disconnect(); connexion.disconnect(); });
beforeEach(() => viderBase(prisma));

function files() {
  const agenda: unknown[][] = [];
  const propositions: unknown[][] = [];
  return {
    agenda, propositions,
    f: { agenda: { add: async (...a: unknown[]) => { agenda.push(a); } }, propositions: { add: async (...a: unknown[]) => { propositions.push(a); } } },
  };
}

async function captureAvec(canal: 'telegram' | 'pwa', types: Array<string | null>, prive = false): Promise<{ captureId: string; ids: string[] }> {
  const u = await prisma.utilisateur.upsert({ where: { nom: 'test' }, create: { nom: 'test' }, update: {} });
  const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal, prive, etat: prive ? 'privee' : 'classee', emisLe: new Date(), texteEcrit: 'x' } });
  const ids: string[] = [];
  for (const [i, type] of types.entries()) {
    const nature = type === null ? 'pensee' : 'action';
    const it = await prisma.item.create({
      data: {
        captureId: c.id, position: i + 1, texte: `item ${i}`, nature, confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
        action: type === null ? undefined : { create: { echeanceType: type, echeanceDate: new Date('2026-10-14T08:00:00Z') } },
      },
    });
    ids.push(it.id);
  }
  return { captureId: c.id, ids };
}

describe('apresClassement', () => {
  it('capture Telegram : chaque rendez-vous daté part vers l\'agenda, une proposition par capture', async () => {
    const { captureId, ids } = await captureAvec('telegram', ['datee', 'jour', null, 'datee']);
    const { agenda, propositions, f } = files();
    await apresClassement(prisma, f, captureId);
    expect(agenda.map((a) => (a[1] as { itemId: string }).itemId).sort()).toEqual([ids[0], ids[3]].sort());
    expect(propositions).toEqual([['proposer', { captureId }, { ...OPTIONS_JOB_PROPOSITION, jobId: `proposer-${captureId}` }]]);
  });

  it('sans rendez-vous daté : rien ; capture de la PWA : l\'agenda, sans proposition ; privée : rien', async () => {
    const sans = await captureAvec('telegram', ['jour']);
    const pwa = await captureAvec('pwa', ['datee']);
    const privee = await captureAvec('telegram', ['datee'], true);
    const { agenda, propositions, f } = files();
    await apresClassement(prisma, f, sans.captureId);
    await apresClassement(prisma, f, pwa.captureId);
    await apresClassement(prisma, f, privee.captureId);
    expect(agenda).toHaveLength(1);
    expect(propositions).toHaveLength(0);
  });
});

describe('demarrerWorker et l\'agenda', () => {
  let file: Queue<JobClassement>;
  let worker: Worker<JobClassement> | undefined;
  const nomFile = `classement-agenda-${randomUUID()}`;
  beforeEach(() => { file = new Queue<JobClassement>(nomFile, { connection: connexion }); });
  afterEach(async () => { await worker?.close(); await file.obliterate({ force: true }); await file.close(); });

  it('appelle la suite après le classement ; son échec ne défait pas le classement', async () => {
    const { id } = await creerCaptureTexte(prisma);
    const appels: string[] = [];
    worker = demarrerWorker({
      prisma, provider: new FauxProvider(), prompt, audioRacine: tmpdir(), connexion, concurrence: 1, nomFile,
      alerter: async () => {}, apresClassement: async (captureId) => { appels.push(captureId); throw new Error('valkey'); },
    });
    const job = await file.add('classer', { captureId: id }, { jobId: id });
    const fin = Date.now() + 8000;
    while ((await job.getState()) !== 'completed' && Date.now() < fin) await new Promise((r) => setTimeout(r, 100));
    expect(await job.getState()).toBe('completed');
    expect(appels).toEqual([id]);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('classee');
  });
});
