import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { debutTexte } from '@organizer/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { HistoriqueService } from '../src/historique/historique.service.js';
import { MoisInvalide } from '../src/privees/privees.service.js';
import { compteTest, creerAction } from './aides-items.js';

const prisma = creerPrisma();
const service = new HistoriqueService(prisma);
const F = 'Europe/Paris';
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

describe('debutTexte', () => {
  it('court : inchangé, espaces resserrés ; vide : null', () => {
    expect(debutTexte('  Appeler   le garage. ')).toBe('Appeler le garage.');
    expect(debutTexte('   ')).toBeNull();
    expect(debutTexte(null)).toBeNull();
  });
  it('long : coupé au dernier espace, avec « … »', () => {
    const t = 'mot '.repeat(60);
    const d = debutTexte(t)!;
    expect(d.length).toBeLessThanOrEqual(140);
    expect(d.endsWith('mot…')).toBe(true);
  });
  it('un seul mot trop long : coupé net', () => {
    expect(debutTexte('a'.repeat(300))).toBe(`${'a'.repeat(139)}…`);
  });
});

describe('historique du mois', () => {
  it('captures non privées du compte, par jour, plus récentes d\'abord, natures sans doublon', async () => {
    const a = await creerAction(prisma, { type: 'jour', texte: 'garage', emisLe: '2026-10-07T10:05:00Z' });
    const moi = await compteTest(prisma);
    await prisma.capture.update({ where: { id: a.captureId }, data: { canal: 'pwa', texteEcrit: null, texteBrut: 'Appeler le garage jeudi.', audioPath: 'ordinaire/x.oga', dureeS: 12 } });
    await prisma.item.create({ data: { captureId: a.captureId, position: 2, texte: 'pensée', nature: 'pensee', confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test', pensee: { create: {} } } });
    await prisma.item.create({ data: { captureId: a.captureId, position: 3, texte: 'autre action', nature: 'action', confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test', action: { create: {} } } });
    await prisma.capture.create({ data: { utilisateurId: moi, canal: 'telegram', prive: false, etat: 'en_file', emisLe: new Date('2026-10-07T12:00:00Z') } });
    await prisma.capture.create({ data: { utilisateurId: moi, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date('2026-10-07T11:00:00Z') } });
    await prisma.capture.create({ data: { utilisateurId: moi, canal: 'telegram', prive: false, etat: 'a_revoir', emisLe: new Date('2026-10-06T09:00:00Z'), texteEcrit: 'Truc à voir avec Paul.' } });

    const j = await service.lister(moi, '2026-10', F);
    expect(j.map((x) => x.jour)).toEqual(['2026-10-07', '2026-10-06']);
    expect(j[0]!.envois.map((e) => e.heure)).toEqual(['14:00', '12:05']);
    expect(j[0]!.envois[0]).toMatchObject({ source: 'telegram', vocal: true, etat: 'en_cours', debut: null, natures: [] });
    expect(j[0]!.envois[1]).toMatchObject({ id: a.captureId, source: 'pwa', vocal: true, dureeS: 12, etat: 'classee', debut: 'Appeler le garage jeudi.', natures: ['action', 'pensee'] });
    expect(j[1]!.envois[0]).toMatchObject({ source: 'telegram', vocal: false, etat: 'a_revoir', debut: 'Truc à voir avec Paul.' });
    expect(j.flatMap((x) => x.envois)).toHaveLength(3);
  });

  it('jour et mois dans le fuseau du compte (23 h 30 à Paris le 31)', async () => {
    const moi = (await prisma.utilisateur.create({ data: { nom: 'test' } })).id;
    await prisma.capture.create({ data: { utilisateurId: moi, canal: 'telegram', prive: false, etat: 'classee', emisLe: new Date('2026-10-31T22:30:00Z'), texteEcrit: 'x' } });
    expect((await service.lister(moi, '2026-10', F)).map((x) => x.jour)).toEqual(['2026-10-31']);
    expect(await service.lister(moi, '2026-11', F)).toEqual([]);
  });

  it('mois invalide : refusé', async () => {
    await expect(service.lister('00000000-0000-4000-8000-000000000000', '2026-13', F)).rejects.toBeInstanceOf(MoisInvalide);
  });

  it('un autre compte ne voit rien', async () => {
    await creerAction(prisma, { type: 'jour', emisLe: '2026-10-07T10:05:00Z' });
    const autre = (await prisma.utilisateur.create({ data: { nom: 'autre-compte' } })).id;
    expect(await service.lister(autre, '2026-10', F)).toEqual([]);
  });
});

describe('détail d\'un envoi', () => {
  it('texte entier, audio, éléments et leurs statuts', async () => {
    const a = await creerAction(prisma, { type: 'jour', texte: 'garage', emisLe: '2026-10-07T10:05:00Z' });
    const moi = await compteTest(prisma);
    await prisma.capture.update({ where: { id: a.captureId }, data: { texteEcrit: null, texteBrut: 'Texte entier.', audioPath: 'ordinaire/x.oga' } });
    const faite = await prisma.item.create({ data: { captureId: a.captureId, position: 2, texte: 'faite', nature: 'action', confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test', action: { create: { faitLe: new Date() } } } });
    const effacee = await prisma.item.create({ data: { captureId: a.captureId, position: 3, texte: 'effacée', nature: 'action', archiveLe: new Date(), confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test', action: { create: {} } } });
    const pensee = await prisma.item.create({ data: { captureId: a.captureId, position: 4, texte: 'pensée', nature: 'pensee', confiance: {}, personnes: [], versionPrompt: 'tri/v1', modele: 'test', pensee: { create: {} } } });

    const d = (await service.detail(moi, a.captureId))!;
    expect(d).toMatchObject({ id: a.captureId, source: 'telegram', vocal: true, etat: 'classee', texte: 'Texte entier.', aAudio: true, emisLe: '2026-10-07T10:05:00.000Z' });
    expect(d.elements.map((e) => [e.itemId, e.statut])).toEqual([[a.itemId, 'a_faire'], [faite.id, 'fait'], [effacee.id, 'efface'], [pensee.id, 'note']]);
  });

  it('privée, inconnue ou d\'un autre compte : rien', async () => {
    const a = await creerAction(prisma, { type: 'jour' });
    const moi = await compteTest(prisma);
    const privee = await prisma.capture.create({ data: { utilisateurId: moi, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    expect(await service.detail(moi, privee.id)).toBeUndefined();
    expect(await service.detail(moi, '00000000-0000-4000-8000-000000000000')).toBeUndefined();
    const autre = (await prisma.utilisateur.create({ data: { nom: 'autre-compte' } })).id;
    expect(await service.detail(autre, a.captureId)).toBeUndefined();
  });
});
