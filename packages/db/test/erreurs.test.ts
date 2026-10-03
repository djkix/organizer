import { afterAll, describe, expect, it } from 'vitest';
import { creerPrisma, Prisma } from '../src/index.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

const donneesInvalides = { texteEcrit: 'secret de L', utilisateurId: 42 } as never;

async function echec(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('la requête aurait dû échouer');
}

describe('creerPrisma', () => {
  it('une erreur de validation ne recopie pas les valeurs de la requête', async () => {
    const e = await echec(prisma.capture.create({ data: donneesInvalides }));
    expect(e).toBeInstanceOf(Prisma.PrismaClientValidationError);
    expect(e.message).not.toContain('secret');
    expect(e.message).toContain('canal');
  });

  it('de même dans une transaction interactive', async () => {
    const e = await echec(prisma.$transaction(async (tx) => tx.capture.create({ data: donneesInvalides })));
    expect(e).toBeInstanceOf(Prisma.PrismaClientValidationError);
    expect(e.message).not.toContain('secret');
  });
});
