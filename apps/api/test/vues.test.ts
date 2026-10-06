import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, VUES } from '../src/jetons.js';
import { VuesController } from '../src/vues/vues.controller.js';
import { VuesService } from '../src/vues/vues.service.js';
import { demarrerAppTest } from './aides-http.js';
import { compteTest, creerAction } from './aides-items.js';

const prisma = creerPrisma();
const vues = new VuesService(prisma);
const PARIS = 'Europe/Paris';
const MAINTENANT = new Date('2026-10-06T06:00:00Z'); // mardi 6 octobre, 8 h à Paris
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

describe('aujourdhui', () => {
  it('montre les actions du jour civil local, triées, sans les faites ni les passées', async () => {
    await creerAction(prisma, { texte: 'b', type: 'datee', date: '2026-10-06T14:00:00+02:00' });
    await creerAction(prisma, { texte: 'a', type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'faite', type: 'jour', date: '2026-10-06T00:00:00+02:00', faitLe: '2026-10-06T05:00:00Z' });
    await creerAction(prisma, { texte: 'hier', type: 'jour', date: '2026-10-05T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'demain', type: 'jour', date: '2026-10-07T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'pensée', type: null, nature: 'pensee' });
    const v = await vues.aujourdhui(await compteTest(prisma), MAINTENANT, PARIS);
    expect(v.jour).toBe('2026-10-06');
    expect(v.actions.map((a) => a.texte)).toEqual(['a', 'b']);
  });

  it('ajoute au plus 3 suggestions de fenêtres proches, sans dépasser 7 lignes', async () => {
    for (let i = 0; i < 5; i++) await creerAction(prisma, { texte: `jour${i}`, type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    for (let i = 0; i < 4; i++) await creerAction(prisma, { texte: `fen${i}`, type: 'fenetre', fin: `2026-10-1${i}T23:59:00+02:00` });
    await creerAction(prisma, { texte: 'loin', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00' });
    const v = await vues.aujourdhui(await compteTest(prisma), MAINTENANT, PARIS);
    expect(v.actions).toHaveLength(5);
    expect(v.suggestions.map((a) => a.texte)).toEqual(['fen0', 'fen1']);
  });

  it('le jour du passage à l\'heure d\'hiver couvre exactement le jour civil', async () => {
    await creerAction(prisma, { texte: 'minuit', type: 'jour', date: '2026-10-25T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'soir', type: 'datee', date: '2026-10-25T23:30:00+01:00' });
    await creerAction(prisma, { texte: 'lendemain', type: 'jour', date: '2026-10-26T00:00:00+01:00' });
    const v = await vues.aujourdhui(await compteTest(prisma), new Date('2026-10-25T10:00:00Z'), PARIS);
    expect(v.actions.map((a) => a.texte)).toEqual(['minuit', 'soir']);
  });

  it('une ligne porte le thème, l\'audio et aucune mention de retard', async () => {
    await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const [l] = (await vues.aujourdhui(await compteTest(prisma), MAINTENANT, PARIS)).actions;
    expect(Object.keys(l!).sort()).toEqual(['aAudio', 'alarme', 'captureId', 'echeanceDate', 'echeanceExpr', 'echeanceType', 'fenetreFin', 'itemId', 'texte', 'theme']);
  });
});

describe('semaine et horizons', () => {
  it('semaine groupe par jour civil sur 7 jours', async () => {
    await creerAction(prisma, { texte: 'mar', type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await creerAction(prisma, { texte: 'jeu', type: 'datee', date: '2026-10-08T09:00:00+02:00' });
    await creerAction(prisma, { texte: 'lun+', type: 'jour', date: '2026-10-13T00:00:00+02:00' });
    const v = await vues.semaine(await compteTest(prisma), MAINTENANT, PARIS);
    expect(v.jours.map((j) => [j.jour, j.actions.map((a) => a.texte)])).toEqual([['2026-10-06', ['mar']], ['2026-10-08', ['jeu']]]);
  });

  it('horizons groupe les fenêtres par borne, la plus proche d\'abord', async () => {
    await creerAction(prisma, { texte: 'cadeaux', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00', expr: 'avant Noël' });
    await creerAction(prisma, { texte: 'sapin', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00', expr: 'avant Noël' });
    await creerAction(prisma, { texte: 'costume', type: 'fenetre', fin: '2026-10-31T23:59:00+01:00', expr: 'avant Halloween' });
    await creerAction(prisma, { texte: 'passée', type: 'fenetre', fin: '2026-10-01T23:59:00+02:00' });
    const v = await vues.horizons(await compteTest(prisma), MAINTENANT, PARIS);
    expect(v.bornes.map((b) => [b.libelle, b.actions.map((a) => a.texte).sort()])).toEqual([
      ['avant Halloween', ['costume']], ['avant Noël', ['cadeaux', 'sapin']],
    ]);
  });

  it('le libellé d\'une borne est la première expression non nulle du groupe', async () => {
    await creerAction(prisma, { texte: 'a', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00' });
    await creerAction(prisma, { texte: 'b', type: 'fenetre', fin: '2026-12-24T23:59:00+01:00', expr: 'avant Noël' });
    const v = await vues.horizons(await compteTest(prisma), MAINTENANT, PARIS);
    expect(v.bornes.map((b) => b.libelle)).toEqual(['avant Noël']);
  });

  it('une vue ne dépasse jamais 20 lignes', async () => {
    for (let i = 0; i < 25; i++) await creerAction(prisma, { type: 'fenetre', fin: '2026-11-01T00:00:00+01:00' });
    const v = await vues.horizons(await compteTest(prisma), MAINTENANT, PARIS);
    expect(v.bornes.flatMap((b) => b.actions)).toHaveLength(20);
  });
});

describe('a revoir', () => {
  it('liste les items ambigus et les captures ordinaires à revoir, jamais les privées', async () => {
    await creerAction(prisma, { texte: 'vendredi ou samedi', type: null, nature: 'ambigu' });
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'test' } });
    await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'a_revoir', emisLe: new Date(), texteBrut: 'inaudible' } });
    await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    const priv = await creerAction(prisma, { texte: 'ambigu privé', type: null, nature: 'ambigu' });
    await prisma.capture.update({ where: { id: priv.captureId }, data: { prive: true, etat: 'privee' } });
    const v = await vues.aRevoir(await compteTest(prisma));
    expect(v.items.map((i) => i.texte)).toEqual(['vendredi ou samedi']);
    expect(v.captures.map((c) => c.texte)).toEqual(['inaudible']);
  });
});

describe('a revoir : budget commun', () => {
  it('ne dépasse pas 20 lignes en tout, les plus récentes d\'abord', async () => {
    const u = await prisma.utilisateur.upsert({ where: { nom: 'test' }, create: { nom: 'test' }, update: {} });
    // Items aux minutes paires, captures aux minutes impaires : 30 lignes, 20 retenues.
    for (let i = 0; i < 15; i++) {
      await creerAction(prisma, { texte: `i${i}`, type: null, nature: 'ambigu', emisLe: `2026-10-02T08:${String(2 * i).padStart(2, '0')}:00Z` });
      await prisma.capture.create({
        data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'a_revoir', emisLe: new Date(`2026-10-02T08:${String(2 * i + 1).padStart(2, '0')}:00Z`), texteBrut: `c${i}` },
      });
    }
    const v = await vues.aRevoir(await compteTest(prisma));
    expect(v.items.length + v.captures.length).toBe(20);
    const dates = [...v.items, ...v.captures].map((l) => l.emisLe).sort().reverse();
    expect(dates[0]).toBe('2026-10-02T08:29:00.000Z');
    expect(dates[19]).toBe('2026-10-02T08:10:00.000Z');
    expect(v.items.map((i) => i.texte)).toEqual(['i14', 'i13', 'i12', 'i11', 'i10', 'i9', 'i8', 'i7', 'i6', 'i5']);
  });
});

describe('/api/vues', () => {
  it('exige une session', async () => {
    class M {}
    Module({ controllers: [VuesController], providers: [
      { provide: VUES, useValue: vues }, { provide: AUTH, useValue: new AuthService(prisma) }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      expect((await fetch(`${app.url}/api/vues/aujourdhui`)).status).toBe(401);
    } finally {
      await app.fermer();
    }
  });
});
