import type { Prisma, PrismaClient } from '@organizer/db';

export interface BilanReclassement { reclassees: number; gardees: number }

/** Un élément que la personne a touché (coché, effacé, corrigé) ou envoyé à son agenda : sa capture reste telle quelle. */
const TOUCHE: Prisma.ItemWhereInput = {
  OR: [
    { archiveLe: { not: null } },
    { corrections: { some: {} } },
    { action: { is: { OR: [{ faitLe: { not: null } }, { evenementId: { not: null } }] } } },
  ],
};

/**
 * Remet en file les captures ordinaires d'un compte classées par une autre version du prompt, quand aucun de
 * leurs éléments n'a été touché. Le worker réécrit alors leurs éléments avec la version courante.
 * ponytail: un cochage fait entre la sélection et le passage du worker serait perdu ; lancer hors usage.
 */
export async function reclasser(
  prisma: PrismaClient, nom: string, version: string, enfiler: (captureId: string) => Promise<void>, essai = false,
): Promise<BilanReclassement> {
  const u = await prisma.utilisateur.findUnique({ where: { nom } });
  if (!u) throw new Error(`Compte ${nom} introuvable.`);
  const base: Prisma.CaptureWhereInput = {
    utilisateurId: u.id, prive: false, etat: { in: ['classee', 'a_revoir'] },
    OR: [{ versionPrompt: null }, { versionPrompt: { not: version } }],
  };
  const candidates = await prisma.capture.count({ where: base });
  const ids = (await prisma.capture.findMany({
    where: { ...base, items: { none: TOUCHE } }, orderBy: { emisLe: 'asc' }, select: { id: true },
  })).map((c) => c.id);
  if (!essai) {
    for (const id of ids) {
      const { count } = await prisma.capture.updateMany({ where: { id, ...base, items: { none: TOUCHE } }, data: { etat: 'en_file', erreur: null } });
      if (count === 1) await enfiler(id);
    }
  }
  return { reclassees: ids.length, gardees: candidates - ids.length };
}
