import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

const utilisateur = () => prisma.utilisateur.create({ data: { nom: 'test' } });

describe('garde-fous du mode privé', () => {
  it('accepte une capture privée dans l\'état privee', async () => {
    const u = await utilisateur();
    const c = await prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() },
    });
    expect(c.prive).toBe(true);
  });

  it('refuse une capture privée dans un autre état', async () => {
    const u = await utilisateur();
    await expect(prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'en_file', emisLe: new Date() },
    })).rejects.toThrow();
  });

  it('refuse de faire sortir une capture privée de l\'état privee', async () => {
    const u = await utilisateur();
    const c = await prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() },
    });
    await expect(prisma.capture.update({ where: { id: c.id }, data: { etat: 'en_file' } })).rejects.toThrow();
  });

  it('refuse qu\'une capture privée redevienne ordinaire', async () => {
    const u = await utilisateur();
    const c = await prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() },
    });
    await expect(prisma.capture.update({
      where: { id: c.id }, data: { prive: false, etat: 'recue' },
    })).rejects.toThrow();
  });

  it('refuse l\'état privee pour une capture ordinaire', async () => {
    const u = await utilisateur();
    await expect(prisma.capture.create({
      data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'privee', emisLe: new Date() },
    })).rejects.toThrow();
  });
});

describe('capture', () => {
  it('source_ref est unique', async () => {
    const u = await utilisateur();
    const data = { utilisateurId: u.id, canal: 'telegram' as const, prive: false, etat: 'recue' as const, emisLe: new Date(), sourceRef: 'tg:1:1' };
    await prisma.capture.create({ data });
    await expect(prisma.capture.create({ data })).rejects.toThrow();
  });
});
