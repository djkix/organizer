import { afterAll, beforeEach, expect, it } from 'vitest';
import { creerPrisma } from '../src/index.js';
import { viderBase } from '../src/test.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

it('une session disparaît avec son compte, et son empreinte est unique', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  const data = { jetonHash: 'abc', utilisateurId: u.id, expireLe: new Date('2027-01-01T00:00:00Z') };
  await prisma.session.create({ data });
  await expect(prisma.session.create({ data })).rejects.toThrow();
  await prisma.utilisateur.delete({ where: { id: u.id } });
  expect(await prisma.session.count()).toBe(0);
});

it('les nouveaux champs ont leurs valeurs par défaut', async () => {
  const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
  expect(u).toMatchObject({ motDePasseHash: null, prochainePrivee: false });
});
