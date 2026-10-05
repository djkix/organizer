import { afterAll, beforeEach, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

it('une connexion Google par compte, effacée avec le compte', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const a = await prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'en_cours' } });
  expect(a).toMatchObject({ erreur: null, jetonChiffre: null, calendrierId: null, connecteLe: null, rafraichiLe: null });
  await expect(prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'connecte' } })).rejects.toThrow();
  await prisma.utilisateur.delete({ where: { id: u.id } });
  expect(await prisma.agendaGoogle.count()).toBe(0);
});

it("l'action naît sans événement, génération zéro, sans proposition", async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', emisLe: new Date() } });
  const it = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: 'dentiste', nature: 'action', confiance: {}, personnes: [],
      versionPrompt: 'tri/v1', modele: 'test', action: { create: { echeanceType: 'datee' } },
    },
    include: { action: true },
  });
  expect(it.action).toMatchObject({
    evenementId: null, evenementCalendrierId: null, evenementEmpreinte: null, evenementGeneration: 0, alarmeProposeeLe: null,
  });
});
