import 'reflect-metadata';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { ItemsController } from '../src/items/items.controller.js';
import { ItemsService } from '../src/items/items.service.js';
import { AUTH, CAPTURES, CONFIG, ITEMS, PRIVEES, VUES } from '../src/jetons.js';
import { CapturesController } from '../src/captures/captures.controller.js';
import { CapturesOrdinairesService } from '../src/captures/captures.service.js';
import { PriveesController } from '../src/privees/privees.controller.js';
import { CapturesPriveesService } from '../src/privees/privees.service.js';
import type { Reencodeur } from '../src/privees/reencodeur.js';
import { VuesController } from '../src/vues/vues.controller.js';
import { VuesService } from '../src/vues/vues.service.js';
import { demarrerAppTest } from './aides-http.js';
import { creerAction } from './aides-items.js';

// Décision 25 : chaque compte ne voit et ne modifie que ses données. Deux comptes, toutes les routes.
const prisma = creerPrisma();
const MDP = 'un mot de passe assez long';
const racine = join(mkdtempSync(join(tmpdir(), 'audio-')), 'audio');
class FauxReencodeur implements Reencodeur { async versOpus(): Promise<Buffer> { return Buffer.from('OggS'); } }
const fige = new Date();
const jourIso = `${fige.getUTCFullYear()}-${String(fige.getUTCMonth() + 1).padStart(2, '0')}`;
let app: { url: string; fermer(): Promise<void> };
let cA: string;
let cB: string;
let A: { itemId: string; captureId: string; ambigu: string; priveeId: string };
let B: { itemId: string; captureId: string; ambigu: string; priveeId: string };

afterAll(() => prisma.$disconnect());
afterEach(async () => { await app?.fermer(); });

async function donnees(compte: string) {
  const midi = new Date(); midi.setUTCHours(12, 0, 0, 0);
  const a = await creerAction(prisma, { compte, texte: `action ${compte}`, type: 'jour', date: midi.toISOString() });
  const amb = await creerAction(prisma, { compte, texte: `ambigu ${compte}`, type: null, nature: 'ambigu' });
  const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: compte } });
  await prisma.capture.update({ where: { id: a.captureId }, data: { audioPath: `ordinaire/${compte}.oga`, audioMime: 'audio/ogg' } });
  const p = await prisma.capture.create({
    data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date(), audioPath: `prive/${compte}.ogg`, audioMime: 'audio/ogg', dureeS: 3 },
  });
  await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'a_revoir', emisLe: new Date(), texteBrut: `revoir ${compte}` } });
  return { itemId: a.itemId, captureId: a.captureId, ambigu: amb.itemId, priveeId: p.id };
}

beforeEach(async () => {
  await viderBase(prisma);
  mkdirSync(join(racine, 'ordinaire'), { recursive: true });
  mkdirSync(join(racine, 'prive'), { recursive: true });
  for (const f of ['ordinaire/a.oga', 'ordinaire/b.oga', 'prive/a.ogg', 'prive/b.ogg']) writeFileSync(join(racine, f), 'OggS');
  const auth = new AuthService(prisma);
  for (const n of ['a', 'b']) {
    await prisma.utilisateur.create({ data: { nom: n, fuseau: 'UTC' } });
    await auth.definirMotDePasse(n, MDP);
  }
  cA = `${NOM_COOKIE}=${(await auth.ouvrirSession('a', MDP))!.jeton}`;
  cB = `${NOM_COOKIE}=${(await auth.ouvrirSession('b', MDP))!.jeton}`;
  A = await donnees('a');
  B = await donnees('b');
  const reen = new FauxReencodeur();
  const stockage = new StockageAudio(racine);
  class M {}
  Module({
    controllers: [VuesController, ItemsController, PriveesController, CapturesController],
    providers: [
      { provide: AUTH, useValue: auth }, SessionGuard,
      { provide: VUES, useValue: new VuesService(prisma) },
      { provide: ITEMS, useValue: new ItemsService(prisma, ['datee', 'jour', 'fenetre', 'relative', 'aucune']) },
      { provide: CONFIG, useValue: { audioRacine: racine } },
      { provide: PRIVEES, useValue: new CapturesPriveesService(prisma, stockage, reen) },
      { provide: CAPTURES, useValue: new CapturesOrdinairesService(prisma, stockage, reen, { finaliser: async () => {} }) },
    ],
  })(M);
  app = await demarrerAppTest(M);
});

const appel = (cookie: string, methode: string, chemin: string, corps?: unknown) => fetch(`${app.url}${chemin}`, {
  method: methode, headers: { cookie, ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
  body: corps === undefined ? undefined : JSON.stringify(corps),
});
const json = async (cookie: string, chemin: string) => (await appel(cookie, 'GET', chemin)).json();

describe('décision 25 : vues cloisonnées', () => {
  it('aujourd\'hui : chacun ne voit que ses actions', async () => {
    expect((await json(cA, '/api/vues/aujourdhui')).actions.map((l: { texte: string }) => l.texte)).toEqual(['action a']);
    expect((await json(cB, '/api/vues/aujourdhui')).actions.map((l: { texte: string }) => l.texte)).toEqual(['action b']);
  });
  it('semaine : chacun ne voit que ses actions', async () => {
    const t = async (c: string) => (await json(c, '/api/vues/semaine')).jours.flatMap((j: { actions: { texte: string }[] }) => j.actions.map((l) => l.texte));
    expect(await t(cA)).toEqual(['action a']);
    expect(await t(cB)).toEqual(['action b']);
  });
  it('horizons : chacun ne voit que ses fenêtres', async () => {
    const demain = new Date(Date.now() + 5 * 86_400_000);
    for (const [c, id] of [['a', A.itemId], ['b', B.itemId]] as const) {
      await prisma.action.update({ where: { itemId: id }, data: { echeanceType: 'fenetre', echeanceDate: null, fenetreFin: demain } });
      void c;
    }
    const t = async (c: string) => (await json(c, '/api/vues/horizons')).bornes.flatMap((b: { actions: { texte: string }[] }) => b.actions.map((l) => l.texte));
    expect(await t(cA)).toEqual(['action a']);
    expect(await t(cB)).toEqual(['action b']);
  });
  it('à revoir : items ambigus et captures du seul compte', async () => {
    const v = await json(cA, '/api/vues/a-revoir');
    expect(v.items.map((i: { texte: string }) => i.texte)).toEqual(['ambigu a']);
    expect(v.captures.map((c: { texte: string }) => c.texte)).toEqual(['revoir a']);
    const w = await json(cB, '/api/vues/a-revoir');
    expect(w.items.map((i: { texte: string }) => i.texte)).toEqual(['ambigu b']);
    expect(w.captures.map((c: { texte: string }) => c.texte)).toEqual(['revoir b']);
  });
});

describe('décision 25 : accès croisé en 404', () => {
  it('cocher, décocher, corriger, alarme : 404 et rien ne bouge', async () => {
    expect((await appel(cA, 'POST', `/api/items/${B.itemId}/fait`)).status).toBe(404);
    expect((await appel(cA, 'DELETE', `/api/items/${B.itemId}/fait`)).status).toBe(404);
    expect((await appel(cA, 'PATCH', `/api/items/${B.itemId}`, { nature: 'pensee' })).status).toBe(404);
    expect((await appel(cA, 'PATCH', `/api/items/${B.ambigu}`, { alarme: false })).status).toBe(404);
    const b = await prisma.item.findUniqueOrThrow({ where: { id: B.itemId }, include: { action: true } });
    expect(b.nature).toBe('action');
    expect(b.action!.faitLe).toBeNull();
    expect(await prisma.correction.count()).toBe(0);
    // Le propriétaire, lui, y accède.
    expect((await appel(cB, 'POST', `/api/items/${B.itemId}/fait`)).status).toBe(204);
    expect((await appel(cB, 'PATCH', `/api/items/${B.itemId}`, { nature: 'pensee' })).status).toBe(204);
  });
  it('audio ordinaire et privé d\'un autre compte : 404 ; le sien : 200', async () => {
    await prisma.capture.update({ where: { id: B.captureId }, data: { audioPath: 'ordinaire/b.oga' } });
    await prisma.capture.update({ where: { id: B.priveeId }, data: { audioPath: 'prive/b.ogg' } });
    await prisma.capture.update({ where: { id: A.captureId }, data: { audioPath: 'ordinaire/a.oga' } });
    expect((await appel(cA, 'GET', `/api/captures/${B.captureId}/audio`)).status).toBe(404);
    expect((await appel(cA, 'GET', `/api/captures/${B.priveeId}/audio`)).status).toBe(404);
    expect((await appel(cB, 'GET', `/api/captures/${B.priveeId}/audio`)).status).toBe(200);
    expect((await appel(cA, 'GET', `/api/captures/${A.captureId}/audio`)).status).toBe(200);
  });
  it('étiqueter la capture privée d\'un autre compte : 404, étiquette intacte', async () => {
    expect((await appel(cA, 'PATCH', `/api/captures/privees/${B.priveeId}`, { etiquette: 'piratée' })).status).toBe(404);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: B.priveeId } })).etiquette).toBeNull();
    expect((await appel(cB, 'PATCH', `/api/captures/privees/${B.priveeId}`, { etiquette: 'ok' })).status).toBe(204);
  });
});

describe('décision 25 : captures privées', () => {
  it('la liste du mois ne contient que les siennes', async () => {
    const ids = async (c: string) => (await json(c, `/api/captures/privees?mois=${jourIso}`)).flatMap((j: { captures: { id: string }[] }) => j.captures.map((x) => x.id));
    expect(await ids(cA)).toEqual([A.priveeId]);
    expect(await ids(cB)).toEqual([B.priveeId]);
  });
  it('déposer avec l\'identifiant d\'un autre compte est refusé, rien n\'est rattaché', async () => {
    const dep = (chemin: string, id: string) => fetch(`${app.url}${chemin}`, {
      method: 'POST', headers: { cookie: cA, 'content-type': 'audio/webm', 'x-capture-id': id }, body: Buffer.from('webm'),
    });
    expect((await dep('/api/captures/privees', B.priveeId)).status).toBe(400);
    expect((await dep('/api/captures', B.captureId)).status).toBe(400);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: B.priveeId } })).utilisateurId).not.toBe(
      (await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'a' } })).id,
    );
  });
});
