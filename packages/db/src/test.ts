import type { PrismaClient } from '@prisma/client';

/** Tests uniquement : vide toutes les tables métier. */
export async function viderBase(p: PrismaClient): Promise<void> {
  await p.$executeRawUnsafe(
    'TRUNCATE cle_acces, session, correction, action, pensee, item, theme, capture, code_liaison, utilisateur CASCADE',
  );
}
