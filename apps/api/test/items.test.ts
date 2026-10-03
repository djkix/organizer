import 'reflect-metadata';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { ItemsController } from '../src/items/items.controller.js';
import { AUTH, CONFIG, ITEMS } from '../src/jetons.js';
import { CorrectionInvalide, ItemIntrouvable, ItemsService } from '../src/items/items.service.js';
import { VuesService } from '../src/vues/vues.service.js';
import { demarrerAppTest } from './aides-http.js';
import { creerAction } from './aides-items.js';

const prisma = creerPrisma();
const TYPES = ['datee', 'jour', 'fenetre', 'relative', 'aucune'];
const service = new ItemsService(prisma, TYPES, () => new Date('2026-10-06T07:00:00Z'));
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

describe('cocher', () => {
  it('pose faitLe une fois ; décocher l\'efface', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await service.cocher(itemId);
    await new ItemsService(prisma, TYPES, () => new Date('2026-10-06T09:00:00Z')).cocher(itemId);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).faitLe?.toISOString()).toBe('2026-10-06T07:00:00.000Z');
    await service.decocher(itemId);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).faitLe).toBeNull();
  });

  it('refuse un item inconnu ou qui n\'est pas une action', async () => {
    const { itemId } = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(service.cocher('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(ItemIntrouvable);
    await expect(service.cocher(itemId)).rejects.toBeInstanceOf(ItemIntrouvable);
  });
});

describe('corriger', () => {
  it('une pensée corrigée en action puis datée apparaît dans Aujourd\'hui, avec deux corrections', async () => {
    const { itemId } = await creerAction(prisma, { texte: 'rappeler', type: null, nature: 'pensee' });
    await service.corriger(itemId, { nature: 'action' });
    await service.corriger(itemId, { echeance: { type: 'jour', date: '2026-10-06T00:00:00+02:00' } });
    const v = await new VuesService(prisma).aujourdhui(new Date('2026-10-06T06:00:00Z'), 'Europe/Paris');
    expect(v.actions.map((a) => a.texte)).toEqual(['rappeler']);
    const corrections = await prisma.correction.findMany({ where: { itemId } });
    expect(corrections.map((c) => c.champ).sort()).toEqual(['echeance', 'nature']);
    expect(corrections.find((c) => c.champ === 'nature')).toMatchObject({ ancienneValeur: 'pensee', nouvelleValeur: 'action' });
  });

  it('une fenêtre exige une fin ; aucune vide les dates', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await expect(service.corriger(itemId, { echeance: { type: 'fenetre' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await service.corriger(itemId, { echeance: { type: 'aucune' } });
    expect(await prisma.action.findUniqueOrThrow({ where: { itemId } })).toMatchObject({
      echeanceType: 'aucune', echeanceDate: null, fenetreDebut: null, fenetreFin: null,
    });
  });

  it('refuse un type absent du schéma, une échéance sur une pensée, une date sans fuseau', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const pensee = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(service.corriger(itemId, { echeance: { type: 'bientot' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(service.corriger(pensee.itemId, { echeance: { type: 'jour', date: '2026-10-07T00:00:00+02:00' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(service.corriger(itemId, { echeance: { type: 'jour', date: '2026-10-07T00:00:00' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    expect(await prisma.correction.count()).toBe(0);
  });
});

describe('cheminAudio', () => {
  it('renvoie le fichier et son type, ou null si l\'audio est purgé', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'audio-'));
    const { captureId } = await creerAction(prisma, { type: null, nature: 'pensee' });
    expect(await service.cheminAudio(captureId, racine)).toBeNull();
    mkdirSync(join(racine, 'ordinaire'), { recursive: true });
    writeFileSync(join(racine, 'ordinaire', 'a.oga'), 'OggS');
    await prisma.capture.update({ where: { id: captureId }, data: { audioPath: 'ordinaire/a.oga', audioMime: 'audio/ogg' } });
    expect(await service.cheminAudio(captureId, racine)).toEqual({ chemin: 'ordinaire/a.oga', mime: 'audio/ogg' });
  });
});

describe('/api/items', () => {
  it('echeanceExpr est effacée par une correction d\'échéance', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-08T00:00:00+02:00', expr: 'jeudi' });
    await service.corriger(itemId, { echeance: { type: 'jour', date: '2026-10-09T00:00:00+02:00' } });
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).echeanceExpr).toBeNull();
  });

  it('l\'historique d\'une correction d\'échéance garde l\'expression d\'origine', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-08T00:00:00+02:00', expr: 'jeudi' });
    await service.corriger(itemId, { echeance: { type: 'jour', date: '2026-10-09T00:00:00+02:00' } });
    const c = await prisma.correction.findFirstOrThrow({ where: { itemId, champ: 'echeance' } });
    expect(c.ancienneValeur).toMatchObject({ type: 'jour', expr: 'jeudi' });
    expect(c.nouvelleValeur).toMatchObject({ type: 'jour', expr: null });
  });

  it('sert l\'audio sous un dossier caché, 404 si purgé ou hors racine', async () => {
    const racine = join(mkdtempSync(join(tmpdir(), 'audio-')), '.cache', 'audio');
    mkdirSync(join(racine, 'ordinaire'), { recursive: true });
    writeFileSync(join(racine, 'ordinaire', 'a.oga'), 'OggS');
    const auth = new AuthService(prisma);
    await prisma.utilisateur.create({ data: { nom: 'l' } });
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const { captureId } = await creerAction(prisma, { type: null, nature: 'pensee' });
    class M {}
    Module({ controllers: [ItemsController], providers: [
      { provide: ITEMS, useValue: service }, { provide: CONFIG, useValue: { audioRacine: racine } },
      { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    const get = () => fetch(`${app.url}/api/captures/${captureId}/audio`, { headers: { cookie: `${NOM_COOKIE}=${s!.jeton}` } });
    try {
      await prisma.capture.update({ where: { id: captureId }, data: { audioPath: 'ordinaire/a.oga', audioMime: 'audio/ogg' } });
      const ok = await get();
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toContain('audio/ogg');
      expect(await ok.text()).toBe('OggS');
      await prisma.capture.update({ where: { id: captureId }, data: { audioPath: null } });
      const purge = await get();
      expect(purge.status).toBe(404);
      expect((await purge.json()).message).toBe('Audio indisponible.');
      await prisma.capture.update({ where: { id: captureId }, data: { audioPath: '../x', audioMime: 'audio/ogg' } });
      expect((await get()).status).toBe(404);
    } finally {
      await app.fermer();
    }
  });

  it('cocher exige une session et traduit un item inconnu en 404', async () => {
    const auth = new AuthService(prisma);
    await prisma.utilisateur.create({ data: { nom: 'l' } });
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    class M {}
    Module({ controllers: [ItemsController], providers: [
      { provide: ITEMS, useValue: service }, { provide: CONFIG, useValue: { audioRacine: tmpdir() } },
      { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      const url = `${app.url}/api/items/00000000-0000-4000-8000-000000000000/fait`;
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      const r = await fetch(url, { method: 'POST', headers: { cookie: `${NOM_COOKIE}=${s!.jeton}` } });
      expect(r.status).toBe(404);
      expect((await r.json()).message).toBe('Élément introuvable.');
    } finally {
      await app.fermer();
    }
  });
});
