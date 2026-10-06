import type { PrismaClient } from '@organizer/db';

/** Crée une capture ordinaire classée et un item, sans passer par Gemini. Données fabriquées. */
export async function creerAction(
  prisma: PrismaClient,
  o: { texte?: string; type: string | null; date?: string; fin?: string; faitLe?: string; expr?: string; nature?: 'action' | 'pensee' | 'ambigu'; emisLe?: string; compte?: string },
): Promise<{ itemId: string; captureId: string }> {
  const u = await prisma.utilisateur.upsert({ where: { nom: o.compte ?? 'test' }, create: { nom: o.compte ?? 'test' }, update: {} });
  const c = await prisma.capture.create({
    data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', emisLe: new Date(o.emisLe ?? '2026-10-01T08:00:00Z'), texteEcrit: 'x' },
  });
  const nature = o.nature ?? 'action';
  const item = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: o.texte ?? 'appeler le garage', nature,
      confiance: { nature: 0.9, echeance: 0.9, theme: 0.9 }, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
      action: nature === 'action' ? {
        create: {
          echeanceType: o.type, echeanceExpr: o.expr ?? null,
          echeanceDate: o.date ? new Date(o.date) : null,
          fenetreFin: o.fin ? new Date(o.fin) : null,
          faitLe: o.faitLe ? new Date(o.faitLe) : null,
        },
      } : undefined,
      pensee: nature === 'pensee' ? { create: {} } : undefined,
    },
  });
  return { itemId: item.id, captureId: c.id };
}

/** Identifiant du compte de test par défaut (celui de `creerAction`). */
export async function compteTest(prisma: PrismaClient, nom = 'test'): Promise<string> {
  return (await prisma.utilisateur.upsert({ where: { nom }, create: { nom }, update: {} })).id;
}
