import 'reflect-metadata';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { JobAgenda } from '@organizer/shared';
import { SignalAgendaFile } from '../src/agenda/signal.js';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { ItemsController } from '../src/items/items.controller.js';
import { AUTH, CONFIG, ITEMS } from '../src/jetons.js';
import { CorrectionInvalide, ItemIntrouvable, ItemsService } from '../src/items/items.service.js';
import { VuesService } from '../src/vues/vues.service.js';
import { demarrerAppTest } from './aides-http.js';
import { compteTest, creerAction } from './aides-items.js';

const prisma = creerPrisma();
const TYPES = ['datee', 'jour', 'fenetre', 'relative', 'aucune'];
const service = new ItemsService(prisma, TYPES, () => new Date('2026-10-06T07:00:00Z'));
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

describe('cocher', () => {
  it('pose faitLe une fois ; décocher l\'efface', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await service.cocher(await compteTest(prisma), itemId);
    await new ItemsService(prisma, TYPES, () => new Date('2026-10-06T09:00:00Z')).cocher(await compteTest(prisma), itemId);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).faitLe?.toISOString()).toBe('2026-10-06T07:00:00.000Z');
    await service.decocher(await compteTest(prisma), itemId);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).faitLe).toBeNull();
  });

  it('refuse un item inconnu ou qui n\'est pas une action', async () => {
    const { itemId } = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(service.cocher(await compteTest(prisma), '00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(ItemIntrouvable);
    await expect(service.cocher(await compteTest(prisma), itemId)).rejects.toBeInstanceOf(ItemIntrouvable);
  });
});

describe('corriger', () => {
  it('une pensée corrigée en action puis datée apparaît dans Aujourd\'hui, avec deux corrections', async () => {
    const { itemId } = await creerAction(prisma, { texte: 'rappeler', type: null, nature: 'pensee' });
    await service.corriger(await compteTest(prisma), itemId, { nature: 'action' });
    await service.corriger(await compteTest(prisma), itemId, { echeance: { type: 'jour', date: '2026-10-06T00:00:00+02:00' } });
    const v = await new VuesService(prisma).aujourdhui(await compteTest(prisma), new Date('2026-10-06T06:00:00Z'), 'Europe/Paris');
    expect(v.actions.map((a) => a.texte)).toEqual(['rappeler']);
    const corrections = await prisma.correction.findMany({ where: { itemId } });
    expect(corrections.map((c) => c.champ).sort()).toEqual(['echeance', 'nature']);
    expect(corrections.find((c) => c.champ === 'nature')).toMatchObject({ ancienneValeur: 'pensee', nouvelleValeur: 'action' });
  });

  it('une fenêtre exige une fin ; aucune vide les dates', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    await expect(service.corriger(await compteTest(prisma), itemId, { echeance: { type: 'fenetre' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await service.corriger(await compteTest(prisma), itemId, { echeance: { type: 'aucune' } });
    expect(await prisma.action.findUniqueOrThrow({ where: { itemId } })).toMatchObject({
      echeanceType: 'aucune', echeanceDate: null, fenetreDebut: null, fenetreFin: null,
    });
  });

  it('refuse un type absent du schéma, une échéance sur une pensée, une date sans fuseau', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const pensee = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(service.corriger(await compteTest(prisma), itemId, { echeance: { type: 'bientot' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(service.corriger(await compteTest(prisma), pensee.itemId, { echeance: { type: 'jour', date: '2026-10-07T00:00:00+02:00' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(service.corriger(await compteTest(prisma), itemId, { echeance: { type: 'jour', date: '2026-10-07T00:00:00' } })).rejects.toBeInstanceOf(CorrectionInvalide);
    expect(await prisma.correction.count()).toBe(0);
  });
});

describe('cheminAudio', () => {
  it('renvoie le fichier et son type, ou null si l\'audio est purgé', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'audio-'));
    const { captureId } = await creerAction(prisma, { type: null, nature: 'pensee' });
    expect(await service.cheminAudio(await compteTest(prisma), captureId, racine)).toBeNull();
    mkdirSync(join(racine, 'ordinaire'), { recursive: true });
    writeFileSync(join(racine, 'ordinaire', 'a.oga'), 'OggS');
    await prisma.capture.update({ where: { id: captureId }, data: { audioPath: 'ordinaire/a.oga', audioMime: 'audio/ogg' } });
    expect(await service.cheminAudio(await compteTest(prisma), captureId, racine)).toEqual({ chemin: 'ordinaire/a.oga', mime: 'audio/ogg' });
  });
});

describe('/api/items', () => {
  it('echeanceExpr est effacée par une correction d\'échéance', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-08T00:00:00+02:00', expr: 'jeudi' });
    await service.corriger(await compteTest(prisma), itemId, { echeance: { type: 'jour', date: '2026-10-09T00:00:00+02:00' } });
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).echeanceExpr).toBeNull();
  });

  it('l\'historique d\'une correction d\'échéance garde l\'expression d\'origine', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-08T00:00:00+02:00', expr: 'jeudi' });
    await service.corriger(await compteTest(prisma), itemId, { echeance: { type: 'jour', date: '2026-10-09T00:00:00+02:00' } });
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
    const { captureId } = await creerAction(prisma, { type: null, nature: "pensee", compte: "l" });
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
      // L'audio, privé compris, ne doit jamais finir dans le cache HTTP du téléphone.
      expect(ok.headers.get('cache-control')).toBe('no-store');
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

describe('alarme et agenda', () => {
  const signaux: Array<[string, number | undefined]> = [];
  const avecSignal = new ItemsService(prisma, TYPES, () => new Date('2026-10-06T07:00:00Z'), {
    signaler: async (itemId, delaiMs) => { signaux.push([itemId, delaiMs]); },
  });
  beforeEach(() => { signaux.length = 0; });

  it('alarme sur un rendez-vous daté : posée, historisée, signalée sans délai ; rien si inchangée', async () => {
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await avecSignal.definirAlarme(itemId, true);
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).alarme).toBe(true);
    expect(await prisma.correction.findMany({ where: { itemId, champ: 'alarme' } })).toMatchObject([{ ancienneValeur: false, nouvelleValeur: true }]);
    expect(signaux).toEqual([[itemId, undefined]]);
    await avecSignal.definirAlarme(itemId, true);
    expect(await prisma.correction.count({ where: { itemId, champ: 'alarme' } })).toBe(1);
  });

  it('alarme refusée sans jour et heure, ou sur une pensée', async () => {
    const jour = await creerAction(prisma, { type: 'jour', date: '2026-10-14T00:00:00+02:00', compte: "l" });
    await expect(avecSignal.definirAlarme(jour.itemId, true)).rejects.toThrow("L'alarme demande un jour et une heure.");
    const pensee = await creerAction(prisma, { type: null, nature: 'pensee' });
    await expect(avecSignal.definirAlarme(pensee.itemId, true)).rejects.toBeInstanceOf(CorrectionInvalide);
    await expect(avecSignal.definirAlarme(jour.itemId, false)).resolves.toBeUndefined();
  });

  it('un rendez-vous daté devenu « un jour » perd son alarme', async () => {
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await avecSignal.definirAlarme(itemId, true);
    await avecSignal.corriger(await compteTest(prisma), itemId, { echeance: { type: 'jour', date: '2026-10-14T00:00:00+02:00' } });
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).alarme).toBe(false);
  });

  it('un rendez-vous avec alarme devenu pensée perd son alarme', async () => {
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await avecSignal.definirAlarme(itemId, true);
    await avecSignal.corriger(await compteTest(prisma), itemId, { nature: 'pensee' });
    expect((await prisma.action.findUniqueOrThrow({ where: { itemId } })).alarme).toBe(false);
  });

  it('cocher signale avec 15 s de délai, décocher et corriger tout de suite', async () => {
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await avecSignal.cocher(await compteTest(prisma), itemId);
    await avecSignal.decocher(await compteTest(prisma), itemId);
    await avecSignal.corriger(await compteTest(prisma), itemId, { nature: 'pensee' });
    expect(signaux).toEqual([[itemId, 15_000], [itemId, undefined], [itemId, undefined]]);
  });

  it('de bout en bout : cocher met en file un job retardé de 15 s, décocher un job immédiat, via la vraie file', async () => {
    const appels: Array<[string, number]> = [];
    const add = async (_nom: string, job: JobAgenda, opts?: object): Promise<void> => {
      appels.push([(job as { itemId: string }).itemId, (opts as { delay: number }).delay]);
    };
    const reel = new ItemsService(prisma, TYPES, undefined, new SignalAgendaFile({ add }));
    const { itemId } = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00' });
    await reel.cocher(await compteTest(prisma), itemId);
    await reel.decocher(await compteTest(prisma), itemId);
    await reel.definirAlarme(itemId, true);
    expect(appels).toEqual([[itemId, 15_000], [itemId, 0], [itemId, 0]]);
  });

  it('PATCH { alarme } : 204 sur un daté, 400 sur une valeur illisible ou hors datee', async () => {
    const auth = new AuthService(prisma);
    await prisma.utilisateur.create({ data: { nom: 'l' } });
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const date = await creerAction(prisma, { type: 'datee', date: '2026-10-14T10:00:00+02:00', compte: "l" });
    const jour = await creerAction(prisma, { type: 'jour', date: '2026-10-14T00:00:00+02:00', compte: "l" });
    class M {}
    Module({ controllers: [ItemsController], providers: [
      { provide: ITEMS, useValue: avecSignal }, { provide: CONFIG, useValue: { audioRacine: tmpdir() } },
      { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    const patch = (id: string, corps: unknown) => fetch(`${app.url}/api/items/${id}`, {
      method: 'PATCH', headers: { cookie: `${NOM_COOKIE}=${s!.jeton}`, 'content-type': 'application/json' }, body: JSON.stringify(corps),
    });
    try {
      expect((await patch(date.itemId, { alarme: true })).status).toBe(204);
      expect((await patch(date.itemId, { alarme: 'oui' })).status).toBe(400);
      const r = await patch(jour.itemId, { alarme: true });
      expect(r.status).toBe(400);
      expect((await r.json()).message).toBe("L'alarme demande un jour et une heure.");
    } finally {
      await app.fermer();
    }
  });
});

describe('effacer', () => {
  const signaux: Array<[string, number | undefined]> = [];
  const svc = new ItemsService(prisma, TYPES, () => new Date('2026-10-06T07:00:00Z'), {
    signaler: async (itemId, delaiMs) => { signaux.push([itemId, delaiMs]); },
  });
  beforeEach(() => { signaux.length = 0; });

  it('archive l\'item, garde la capture, le retire des vues, signale l\'agenda, idempotent', async () => {
    const { itemId, captureId } = await creerAction(prisma, { type: 'datee', date: '2026-10-06T10:00:00+02:00' });
    const moi = await compteTest(prisma);
    await svc.effacer(moi, itemId);
    await svc.effacer(moi, itemId);
    const it = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(it.archiveLe).toEqual(new Date('2026-10-06T07:00:00Z'));
    expect(await prisma.capture.count({ where: { id: captureId } })).toBe(1);
    expect((await new VuesService(prisma).aujourdhui(moi, new Date('2026-10-06T06:00:00Z'), 'Europe/Paris')).actions).toEqual([]);
    expect(signaux.map(([i]) => i)).toEqual([itemId, itemId]);
  });

  it('une action effacée refuse cocher et corriger (introuvable)', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const moi = await compteTest(prisma);
    await svc.effacer(moi, itemId);
    await expect(svc.cocher(moi, itemId)).rejects.toBeInstanceOf(ItemIntrouvable);
    await expect(svc.corriger(moi, itemId, { nature: 'pensee' })).rejects.toBeInstanceOf(ItemIntrouvable);
    await expect(svc.definirAlarme(itemId, false)).rejects.toBeInstanceOf(ItemIntrouvable);
  });

  it('l\'item d\'un autre compte : introuvable, rien ne change, aucun signal', async () => {
    const { itemId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00', compte: 'autre' });
    await expect(svc.effacer(await compteTest(prisma), itemId)).rejects.toBeInstanceOf(ItemIntrouvable);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).archiveLe).toBeNull();
    expect(signaux).toEqual([]);
  });
});

describe('transcription', () => {
  it('rend texte_brut, sinon texte_ecrit, sinon null', async () => {
    const { captureId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const moi = await compteTest(prisma);
    await prisma.capture.update({ where: { id: captureId }, data: { texteBrut: 'Appeler le garage jeudi.', texteEcrit: 'écrit' } });
    expect(await service.transcription(moi, captureId)).toBe('Appeler le garage jeudi.');
    await prisma.capture.update({ where: { id: captureId }, data: { texteBrut: null } });
    expect(await service.transcription(moi, captureId)).toBe('écrit');
    await prisma.capture.update({ where: { id: captureId }, data: { texteEcrit: null } });
    expect(await service.transcription(moi, captureId)).toBeNull();
  });

  it('ne rend jamais une capture privée, inconnue ou d\'un autre compte', async () => {
    const { captureId } = await creerAction(prisma, { type: 'jour', date: '2026-10-06T00:00:00+02:00' });
    const moi = await compteTest(prisma);
    // Une capture privée n'a jamais de texte (garde-fou SQL) : la route la refuse quand même.
    const privee = await prisma.capture.create({ data: { utilisateurId: moi, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    expect(await service.transcription(moi, privee.id)).toBeUndefined();
    const autre = (await prisma.utilisateur.create({ data: { nom: 'autre-compte' } })).id;
    expect(await service.transcription(autre, captureId)).toBeUndefined();
    expect(await service.transcription(moi, '00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });
});
