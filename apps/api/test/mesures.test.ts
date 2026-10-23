import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { formaterMesures, mesurer, tailleDossier } from '../src/veille/mesures.js';

const prisma = creerPrisma();
const connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
afterAll(async () => { await prisma.$disconnect(); connexion.disconnect(); });
beforeEach(() => viderBase(prisma));

describe('mesurer', () => {
  it('file, taille de l\'audio et de la base, latence de l\'heure, dernière capture', async () => {
    const file = new Queue(`veille-test-${randomUUID()}`, { connection: connexion });
    try {
      await file.add('classer', { captureId: 'a' });
      await file.add('classer', { captureId: 'b' }, { delay: 60_000 });
      const racine = mkdtempSync(join(tmpdir(), 'audio-'));
      mkdirSync(join(racine, 'ordinaire', '2026', '10'), { recursive: true });
      writeFileSync(join(racine, 'ordinaire', '2026', '10', 'x.ogg'), Buffer.alloc(1000));
      writeFileSync(join(racine, 'y.ogg'), Buffer.alloc(24));
      const maintenant = new Date();
      const recuLe = new Date(maintenant.getTime() - 30_000);
      const u = await prisma.utilisateur.create({ data: { nom: 'l' } });
      await prisma.capture.create({
        data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', emisLe: recuLe, recuLe, classeLe: maintenant },
      });
      const m = await mesurer({ prisma, file, audioRacine: racine, maintenant: () => maintenant });
      expect(m.enAttente).toBe(2);
      expect(m.echecsHeure).toBe(0);
      expect(m.audioOctets).toBe(1024);
      expect(m.baseOctets).toBeGreaterThan(0);
      expect(m.latenceMoyenneS).toBeCloseTo(30, 0);
      expect(m.derniereCapture?.getTime()).toBe(recuLe.getTime());
      expect(formaterMesures(m)).toContain('en attente : 2');
    } finally {
      await file.obliterate({ force: true });
      await file.close();
    }
  });

  it('sauvegarde : dernière tentative et dernière réussite ; rien sans ligne', async () => {
    const file = new Queue(`veille-test-${randomUUID()}`, { connection: connexion });
    const racine = mkdtempSync(join(tmpdir(), 'audio-'));
    try {
      const t = new Date();
      let m = await mesurer({ prisma, file, audioRacine: racine, maintenant: () => t });
      expect(m.derniereSauvegarde).toBeNull();
      expect(m.derniereSauvegardeReussie).toBeNull();
      expect(formaterMesures(m)).toContain('dernière sauvegarde réussie : -');
      const h = (n: number): Date => new Date(t.getTime() - n * 3600_000);
      await prisma.sauvegarde.create({ data: { debut: h(2.1), fin: h(2), reussie: true, message: '' } });
      await prisma.sauvegarde.create({ data: { debut: h(1.1), fin: h(1), reussie: false, message: 'x' } });
      m = await mesurer({ prisma, file, audioRacine: racine, maintenant: () => t });
      expect(m.derniereSauvegarde).toEqual({ fin: h(1), reussie: false, message: 'x' });
      expect(m.derniereSauvegardeReussie?.getTime()).toBe(h(2).getTime());
      expect(formaterMesures(m)).toContain(`dernière sauvegarde réussie : ${h(2).toISOString()}`);
    } finally {
      await file.obliterate({ force: true });
      await file.close();
    }
  });

  it('un dossier audio absent pèse zéro', async () => {
    expect(await tailleDossier(join(tmpdir(), `absent-${randomUUID()}`))).toBe(0);
  });
});
