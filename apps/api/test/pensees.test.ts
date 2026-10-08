import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PenseesService } from '../src/pensees/pensees.service.js';
import { MoisInvalide } from '../src/privees/privees.service.js';
import { compteTest, creerAction } from './aides-items.js';

const prisma = creerPrisma();
const service = new PenseesService(prisma);
const F = 'Europe/Paris';
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

async function pensee(o: { texte: string; emisLe: string; theme?: string; personnes?: string[]; archive?: boolean; compte?: string }) {
  const { captureId, itemId } = await creerAction(prisma, { type: null, nature: 'pensee', texte: o.texte, emisLe: o.emisLe, compte: o.compte });
  const theme = o.theme ? await prisma.theme.upsert({ where: { libelle: o.theme }, create: { libelle: o.theme }, update: {} }) : null;
  await prisma.item.update({ where: { id: itemId }, data: { themeId: theme?.id ?? null, personnes: o.personnes ?? [], archiveLe: o.archive ? new Date() : null } });
  return { captureId, itemId };
}

describe('pensées du mois', () => {
  it('par jour, plus récentes d\'abord ; actions, archivées et autre compte exclus ; thèmes et personnes distincts', async () => {
    const a = await pensee({ texte: 'marcher davantage le soir', emisLe: '2026-10-07T18:00:00Z', theme: 'santé', personnes: [] });
    const b = await pensee({ texte: 'changer de travail', emisLe: '2026-10-07T08:00:00Z', theme: 'travail', personnes: ['Paul'] });
    await pensee({ texte: 'idée effacée', emisLe: '2026-10-06T08:00:00Z', theme: 'loisirs', archive: true });
    await pensee({ texte: 'pensée d\'un autre compte', emisLe: '2026-10-06T08:00:00Z', compte: 'autre-compte' });
    await creerAction(prisma, { type: 'jour', texte: 'une action', emisLe: '2026-10-06T08:00:00Z' });
    await pensee({ texte: 'en septembre', emisLe: '2026-09-20T08:00:00Z', theme: 'famille', personnes: ['Anne', 'Paul'] });
    const moi = await compteTest(prisma);

    const r = await service.lister(moi, '2026-10', F, {});
    expect(r.jours.map((j) => j.jour)).toEqual(['2026-10-07']);
    expect(r.jours[0]!.pensees.map((p) => [p.itemId, p.heure, p.theme, p.personnes])).toEqual([
      [a.itemId, '20:00', 'santé', []], [b.itemId, '10:00', 'travail', ['Paul']],
    ]);
    expect(r.themes).toEqual(['famille', 'santé', 'travail']);
    expect(r.personnes).toEqual(['Anne', 'Paul']);
  });

  it('filtres : par thème, par personne', async () => {
    await pensee({ texte: 'a', emisLe: '2026-10-07T18:00:00Z', theme: 'santé' });
    const b = await pensee({ texte: 'b', emisLe: '2026-10-07T08:00:00Z', theme: 'travail', personnes: ['Paul'] });
    const moi = await compteTest(prisma);
    expect((await service.lister(moi, '2026-10', F, { theme: 'travail' })).jours.flatMap((j) => j.pensees.map((p) => p.itemId))).toEqual([b.itemId]);
    expect((await service.lister(moi, '2026-10', F, { personne: 'Paul' })).jours.flatMap((j) => j.pensees.map((p) => p.itemId))).toEqual([b.itemId]);
    expect((await service.lister(moi, '2026-10', F, { personne: 'Personne' })).jours).toEqual([]);
  });

  it('mois invalide : refusé', async () => {
    await expect(service.lister('00000000-0000-4000-8000-000000000000', '2026-1', F, {})).rejects.toBeInstanceOf(MoisInvalide);
  });
});
