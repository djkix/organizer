import { randomUUID } from 'node:crypto';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { type JobAgenda } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerteurAgenda, demarrerFileAgenda, MESSAGES_ADMIN, Signaleur } from '../src/file.js';
import { actionDatee, CLE, compteConnecte, depsSynchro } from './aides.js';
import { FauxGoogle } from './faux-google.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
let faux: FauxGoogle;
let nomFile: string;
let file: Queue<JobAgenda>;
let worker: Worker<JobAgenda> | undefined;
let alertes: string[];

beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); connexion.disconnect(); });
beforeEach(async () => {
  await viderBase(prisma);
  alertes = [];
  nomFile = `agenda-test-${randomUUID()}`;
  file = new Queue<JobAgenda>(nomFile, { connection: connexion });
});
afterEach(async () => { await worker?.close(); await file.obliterate({ force: true }); await file.close(); });

async function attendre(condition: () => Promise<boolean>, ms = 8000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('délai dépassé');
}

function lancer(): void {
  const alerter = async (m: string): Promise<void> => { alertes.push(m); };
  const signaleur = new Signaleur(alerter);
  const base = { ...depsSynchro(prisma, faux, undefined, alerteurAgenda(signaleur, prisma)) };
  worker = demarrerFileAgenda({
    ...base, cle: CLE, connexion, nomFile, pauseMs: 300, alerter, signaleur,
    enfilerSynchro: async (itemId) => { await file.add('synchroniser', { type: 'synchroniser', itemId }); },
    enfilerBalayage: async (utilisateurId) => { await file.add('balayer', { type: 'balayer', utilisateurId }); },
  });
}
const synchro = (itemId: string, opts: object = {}) => file.add('synchroniser', { type: 'synchroniser', itemId }, opts);
const evenementId = async (itemId: string) => (await prisma.action.findUniqueOrThrow({ where: { itemId } })).evenementId;

describe('Signaleur', () => {
  it('une alerte par clé jusqu\'au rétablissement', async () => {
    const m: string[] = [];
    const s = new Signaleur(async (x) => { m.push(x); });
    await s.une('a', '1'); await s.une('a', '2'); await s.une('b', '3');
    s.retablir('a'); await s.une('a', '4');
    expect(m).toEqual(['1', '3', '4']);
  });
});

describe('demarrerFileAgenda', () => {
  it('synchronise un item enfilé', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    lancer();
    await synchro(itemId);
    await attendre(async () => (await evenementId(itemId)) !== null);
  });

  it('refuse un job aux données invalides sans le rejouer', async () => {
    lancer();
    const j = await file.add('synchroniser', { type: 'synchroniser', itemId: 12 } as never, { attempts: 5 });
    await attendre(async () => (await j.getState()) === 'failed');
    expect((await file.getJob(j.id!))!.attemptsMade).toBe(1);
  });

  it('429 : file en pause, une seule alerte, reprise ensuite', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const a = await actionDatee(prisma, uid, { texte: 'un' });
    const b = await actionDatee(prisma, uid, { texte: 'deux' });
    faux.forcer(/^POST \/calendar\//, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } });
    faux.forcer(/^POST \/calendar\//, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } });
    lancer();
    await synchro(a, { attempts: 5 });
    await synchro(b, { attempts: 5 });
    await attendre(async () => (await evenementId(a)) !== null && (await evenementId(b)) !== null);
    expect(alertes).toEqual([MESSAGES_ADMIN.pause(429, 'rateLimitExceeded')]);
  });

  it('autorisation retirée : une alerte, job terminé sans reprise', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const a = await actionDatee(prisma, uid, { texte: 'un' });
    const b = await actionDatee(prisma, uid, { texte: 'deux' });
    faux.rafraichissements.clear();
    lancer();
    const ja = await synchro(a, { attempts: 5 });
    await attendre(async () => (await ja.getState()) === 'completed');
    const jb = await synchro(b, { attempts: 5 });
    await attendre(async () => (await jb.getState()) === 'completed');
    expect(alertes).toEqual([MESSAGES_ADMIN.revoque('l')]);
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('revoque');
  });

  it('échange impossible (client refusé) : connexion en échec, alerte sur le client', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'l' } });
    await prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'en_cours' } });
    faux.forcer(/^POST \/token$/, 401, { error: 'invalid_client' });
    lancer();
    await file.add('echanger', { type: 'echanger', utilisateurId: u.id, code: 'c', verificateur: 'v' }, { attempts: 3 });
    await attendre(async () => (await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: u.id } })).etat === 'echec');
    expect(alertes).toContain(MESSAGES_ADMIN.client);
  });

  it('trois échecs définitifs dans l\'heure : une alerte de volume', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const items = [await actionDatee(prisma, uid), await actionDatee(prisma, uid), await actionDatee(prisma, uid)];
    for (let i = 0; i < 3; i++) faux.forcer(/^POST \/calendar\//, 500, { error: { code: 500, errors: [{ reason: 'backendError' }] } });
    lancer();
    const jobs = await Promise.all(items.map((i) => synchro(i, { attempts: 1 })));
    await attendre(async () => (await Promise.all(jobs.map((j) => j.getState()))).every((s) => s === 'failed'));
    await attendre(async () => alertes.includes(MESSAGES_ADMIN.echecs(3)));
  });

  it('le balayage périodique est idempotent', async () => {
    const { planifierBalayage } = await import('../src/file.js');
    await planifierBalayage(file); await planifierBalayage(file);
    expect((await file.getJobSchedulers()).length).toBe(1);
  });
});
