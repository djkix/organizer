import { afterAll, beforeEach, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

it('une clé disparaît avec son compte ; son identifiant WebAuthn est unique', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const data = { identifiant: 'AAAA', utilisateurId: u.id, clePublique: new Uint8Array([1, 2, 3]) };
  const c = await prisma.cleAcces.create({ data });
  expect(c).toMatchObject({ compteur: 0n, transports: [], sauvegardee: false, utiliseeLe: null });
  expect(Array.from(c.clePublique)).toEqual([1, 2, 3]);
  await expect(prisma.cleAcces.create({ data })).rejects.toThrow();
  await prisma.utilisateur.delete({ where: { id: u.id } });
  expect(await prisma.cleAcces.count()).toBe(0);
});

it('le compteur tient sur 32 bits non signés', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const c = await prisma.cleAcces.create({
    data: { identifiant: 'BBBB', utilisateurId: u.id, clePublique: new Uint8Array([1]), compteur: 4_294_967_295n },
  });
  expect(c.compteur).toBe(4_294_967_295n);
});
