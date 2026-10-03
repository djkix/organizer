import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export function creerPrisma(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('Variable manquante : DATABASE_URL');
  return new PrismaClient({ datasources: { db: { url } } });
}
