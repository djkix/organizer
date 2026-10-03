import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { chargerPrompt, OPTIONS_JOB_CLASSEMENT, type JobClassement } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CreditEpuise } from '../src/classement/provider.js';
import { demarrerWorker, reprendre } from '../src/worker.js';
import { creerCaptureTexte, FauxProvider, resultatExemple } from './aides.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');
let nomFile: string;
let file: Queue<JobClassement>;
let worker: Worker<JobClassement> | undefined;

beforeEach(async () => {
  await viderBase(prisma);
  nomFile = `classement-test-${randomUUID()}`;
  file = new Queue<JobClassement>(nomFile, { connection: connexion });
});
afterEach(async () => {
  await worker?.close();
  await file.obliterate({ force: true });
  await file.close();
});
afterAll(async () => {
  await prisma.$disconnect();
  connexion.disconnect();
});

async function attendre(condition: () => Promise<boolean>, ms = 8000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('délai dépassé');
}

const etat = async (id: string) => (await prisma.capture.findUniqueOrThrow({ where: { id } })).etat;

function lancer(provider: FauxProvider, alertes: string[] = [], pauseCreditMs = 300) {
  worker = demarrerWorker({
    prisma, provider, prompt, audioRacine: tmpdir(), connexion, concurrence: 1, nomFile, pauseCreditMs,
    alerter: async (m) => { alertes.push(m); },
  });
}

describe('demarrerWorker', () => {
  it('classe une capture enfilée', async () => {
    const { id } = await creerCaptureTexte(prisma);
    lancer(new FauxProvider());
    await file.add('classer', { captureId: id }, { jobId: id });
    await attendre(async () => (await etat(id)) === 'classee');
  });

  it('crédit épuisé : garde les captures en file, alerte une seule fois, reprend ensuite', async () => {
    const a = await creerCaptureTexte(prisma, 'un');
    const b = await creerCaptureTexte(prisma, 'deux');
    const alertes: string[] = [];
    const p = new FauxProvider([new CreditEpuise('402'), new CreditEpuise('402'), resultatExemple()]);
    lancer(p, alertes);
    await file.add('classer', { captureId: a.id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: a.id });
    await file.add('classer', { captureId: b.id }, { ...OPTIONS_JOB_CLASSEMENT, jobId: b.id });
    await attendre(async () => (await etat(a.id)) === 'classee' && (await etat(b.id)) === 'classee');
    expect(alertes).toHaveLength(1);
    expect(await prisma.capture.count({ where: { etat: 'a_revoir' } })).toBe(0);
  });

  it('passe en a_transcrire quand les essais sont épuisés', async () => {
    const { id } = await creerCaptureTexte(prisma);
    lancer(new FauxProvider([new Error('HTTP 503')]));
    await file.add('classer', { captureId: id }, { jobId: id, attempts: 1 });
    await attendre(async () => (await etat(id)) === 'a_transcrire');
  });

  it('rejette un job pointant une capture privée sans appeler le fournisseur', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
    const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    const p = new FauxProvider();
    lancer(p);
    const job = await file.add('classer', { captureId: c.id }, { jobId: c.id, attempts: 3 });
    await attendre(async () => (await job.getState()) === 'failed');
    expect(p.appels).toHaveLength(0);
    expect(await etat(c.id)).toBe('privee');
  });
});

describe('reprendre', () => {
  it('réenfile les captures a_transcrire, jamais les privées', async () => {
    const { id } = await creerCaptureTexte(prisma);
    await prisma.capture.update({ where: { id }, data: { etat: 'a_transcrire' } });
    expect(await reprendre(prisma, file)).toBe(1);
    expect(await etat(id)).toBe('en_file');
    expect(await file.count()).toBe(1);
  });
});
