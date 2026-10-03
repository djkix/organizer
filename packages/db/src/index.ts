import { Prisma, PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Une erreur de validation Prisma recopie les arguments de la requête (texte de capture compris),
 * quel que soit `errorFormat`. On ne garde que la dernière phrase, qui nomme le champ fautif.
 */
function sansArguments(e: Prisma.PrismaClientValidationError): Prisma.PrismaClientValidationError {
  const morceaux = e.message.trim().split('\n\n');
  const raison = morceaux[morceaux.length - 1] ?? 'Requête invalide';
  return new Prisma.PrismaClientValidationError(raison, { clientVersion: e.clientVersion });
}

export function creerPrisma(url: string | undefined = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error('Variable manquante : DATABASE_URL');
  // « minimal » : pas d'extrait de code source dans les messages d'erreur.
  const client = new PrismaClient({ datasources: { db: { url } }, errorFormat: 'minimal' });
  const filtre = client.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (e) {
          if (e instanceof Prisma.PrismaClientValidationError) throw sansArguments(e);
          throw e;
        }
      },
    },
  });
  // Même interface à l'usage ; seul $on/$use disparaissent, inutilisés ici.
  return filtre as unknown as PrismaClient;
}
