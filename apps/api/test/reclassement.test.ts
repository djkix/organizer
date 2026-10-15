import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reclasser } from '../src/reclassement/reclasser.js';
import { creerAction } from './aides-items.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

const enfilees: string[] = [];
const lancer = (essai = false) => {
  enfilees.length = 0;
  return reclasser(prisma, 'test', 'tri/v2', async (id) => { enfilees.push(id); }, essai);
};

describe('reclasser', () => {
  it('remet en file les captures intactes classées par une autre version, garde celles qui ont été touchées', async () => {
    const intacte = await creerAction(prisma, { type: null });
    const cochee = await creerAction(prisma, { type: null, faitLe: '2026-10-02T08:00:00Z' });
    const corrigee = await creerAction(prisma, { type: null });
    await prisma.correction.create({ data: { itemId: corrigee.itemId, champ: 'nature' } });
    const effacee = await creerAction(prisma, { type: null });
    await prisma.item.update({ where: { id: effacee.itemId }, data: { archiveLe: new Date() } });
    const agenda = await creerAction(prisma, { type: 'datee', date: '2026-10-09T08:00:00Z' });
    await prisma.action.update({ where: { itemId: agenda.itemId }, data: { evenementId: 'ev' } });
    const dejaV2 = await creerAction(prisma, { type: null });
    await prisma.capture.update({ where: { id: dejaV2.captureId }, data: { versionPrompt: 'tri/v2' } });
    const privee = await creerAction(prisma, { type: null });
    await prisma.capture.update({ where: { id: privee.captureId }, data: { prive: true, etat: 'privee' } });
    await creerAction(prisma, { type: null, compte: 'autre' });

    expect(await lancer()).toEqual({ reclassees: 1, gardees: 4 });
    expect(enfilees).toEqual([intacte.captureId]);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: intacte.captureId } })).etat).toBe('en_file');
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: cochee.captureId } })).etat).toBe('classee');
  });

  it('en essai, compte sans rien changer ni enfiler', async () => {
    const c = await creerAction(prisma, { type: null });
    expect(await lancer(true)).toEqual({ reclassees: 1, gardees: 0 });
    expect(enfilees).toEqual([]);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: c.captureId } })).etat).toBe('classee');
  });

  it('refuse un compte inconnu', async () => {
    await expect(reclasser(prisma, 'personne', 'tri/v2', async () => {})).rejects.toThrow('introuvable');
  });
});
