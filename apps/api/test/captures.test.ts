import 'reflect-metadata';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { CapturesController } from '../src/captures/captures.controller.js';
import { CapturesOrdinairesService } from '../src/captures/captures.service.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { IngestionService, type FileClassement } from '../src/ingestion/ingestion.service.js';
import { AUTH, CAPTURES, PRIVEES } from '../src/jetons.js';
import { PriveesController } from '../src/privees/privees.controller.js';
import { CapturesPriveesService, FormatRefuse } from '../src/privees/privees.service.js';
import { AudioIllisible, type Reencodeur } from '../src/privees/reencodeur.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

class FauxReencodeur implements Reencodeur {
  appels = 0;
  async versOpus(): Promise<Buffer> {
    this.appels++;
    return Buffer.from('OggS-faux');
  }
}

const ID = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
let racine: string;
let reencodeur: FauxReencodeur;
let enfiles: string[];
let service: CapturesOrdinairesService;
let utilisateurId: string;

beforeEach(async () => {
  await viderBase(prisma);
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  reencodeur = new FauxReencodeur();
  enfiles = [];
  const file: FileClassement = { enfiler: async (id) => { enfiles.push(id); } };
  const ingestion = new IngestionService(prisma, new StockageAudio(racine), { telecharger: async () => { throw new Error('jamais'); } }, file, () => {}, reencodeur);
  service = new CapturesOrdinairesService(prisma, new StockageAudio(racine), reencodeur, ingestion, () => {});
  utilisateurId = (await prisma.utilisateur.create({ data: { nom: 'l' } })).id;
});

const depot = (o: Partial<{ id: string; mime: string }> = {}) => ({
  id: o.id ?? ID, donnees: Buffer.from('webm'), mime: o.mime ?? 'audio/webm',
  emisLe: new Date('2026-10-06T06:12:00Z'), dureeS: 14,
});

describe('CapturesOrdinairesService', () => {
  it('crée une capture ordinaire canal pwa, audio rangé dans ordinaire/, job de classement enfilé', async () => {
    expect(await service.enregistrer(utilisateurId, depot())).toEqual({ id: ID, nouvelle: true });
    const c = await prisma.capture.findUniqueOrThrow({ where: { id: ID } });
    expect(c).toMatchObject({ prive: false, etat: 'en_file', canal: 'pwa', audioMime: 'audio/ogg', dureeS: 14 });
    expect(c.audioPath).toBe(`ordinaire/2026/10/${ID}.ogg`);
    expect(existsSync(join(racine, c.audioPath!))).toBe(true);
    expect(enfiles).toEqual([ID]);
  });

  it('rejouer le même identifiant ne crée rien, ne réencode pas, n\'enfile pas deux fois', async () => {
    await service.enregistrer(utilisateurId, depot());
    expect(await service.enregistrer(utilisateurId, depot())).toEqual({ id: ID, nouvelle: false });
    expect(reencodeur.appels).toBe(1);
    expect(enfiles).toEqual([ID]);
    expect(await prisma.capture.count()).toBe(1);
  });

  it('refuse un format hors liste, avant tout réencodage', async () => {
    await expect(service.enregistrer(utilisateurId, depot({ mime: 'image/png' }))).rejects.toBeInstanceOf(FormatRefuse);
    expect(reencodeur.appels).toBe(0);
  });

  it('une panne d\'enfilage ne perd rien : la capture reste « recue », la reprise l\'enfilera', async () => {
    const ingestion = { finaliser: async () => { throw new Error('valkey'); } };
    const s = new CapturesOrdinairesService(prisma, new StockageAudio(racine), reencodeur, ingestion, () => {});
    expect(await s.enregistrer(utilisateurId, depot())).toEqual({ id: ID, nouvelle: true });
    expect(await prisma.capture.findUniqueOrThrow({ where: { id: ID } })).toMatchObject({ etat: 'recue', prive: false });
  });

  it('INVARIANT : un identifiant de capture privée est refusé, rien n\'est enfilé ni réécrit', async () => {
    await prisma.capture.create({ data: { id: ID, utilisateurId, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    await expect(service.enregistrer(utilisateurId, depot())).rejects.toThrow();
    expect(enfiles).toEqual([]);
    expect(reencodeur.appels).toBe(0);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id: ID } })).toMatchObject({ prive: true, etat: 'privee' });
  });
});

describe('POST /api/captures et /api/captures/privees : deux routes, deux modes', () => {
  async function demarrer(r: Reencodeur = reencodeur) {
    const auth = new AuthService(prisma);
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const cookie = `${NOM_COOKIE}=${s!.jeton}`;
    const privees = new CapturesPriveesService(prisma, new StockageAudio(racine), r);
    class M {}
    Module({ controllers: [CapturesController, PriveesController], providers: [
      { provide: CAPTURES, useValue: service }, { provide: PRIVEES, useValue: privees }, { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    return { app: await demarrerAppTest(M), cookie };
  }
  const post = (u: string, cookie: string, id = ID, type = 'audio/webm') => fetch(u, {
    method: 'POST', headers: { cookie, 'content-type': type, 'x-capture-id': id, 'x-duree-s': '14' }, body: Buffer.from('webm'),
  });

  it('201 puis 200, sans session 401, format 415, identifiant invalide 400', async () => {
    const { app, cookie } = await demarrer();
    try {
      const a = await post(`${app.url}/api/captures`, cookie, ID, 'audio/webm;codecs=opus');
      expect(a.status).toBe(201);
      expect(await a.json()).toEqual({ id: ID });
      expect((await post(`${app.url}/api/captures`, cookie)).status).toBe(200);
      expect((await post(`${app.url}/api/captures`, cookie, ID, 'image/png')).status).toBe(415);
      expect((await post(`${app.url}/api/captures`, cookie, 'pas-un-uuid')).status).toBe(400);
      expect((await post(`${app.url}/api/captures`, '')).status).toBe(401);
      expect(enfiles).toEqual([ID]);
    } finally {
      await app.fermer();
    }
  });

  it('422 si l\'audio est illisible', async () => {
    service = new CapturesOrdinairesService(prisma, new StockageAudio(racine), {
      async versOpus(): Promise<Buffer> { throw new AudioIllisible('x'); },
    }, { finaliser: async () => {} }, () => {});
    const { app, cookie } = await demarrer();
    try {
      expect((await post(`${app.url}/api/captures`, cookie)).status).toBe(422);
      expect(await prisma.capture.count()).toBe(0);
    } finally {
      await app.fermer();
    }
  });

  it('INVARIANT : la route privée crée du privé jamais enfilé ; la route ordinaire refuse cet identifiant', async () => {
    const { app, cookie } = await demarrer();
    try {
      expect((await post(`${app.url}/api/captures/privees`, cookie)).status).toBe(201);
      expect(await prisma.capture.findUniqueOrThrow({ where: { id: ID } })).toMatchObject({ prive: true, etat: 'privee' });
      const r = await post(`${app.url}/api/captures`, cookie);
      expect(r.status).toBe(400);
      expect(enfiles).toEqual([]);
      // Et l'inverse : un identifiant ordinaire n'est pas repris par la route privée.
      const autre = '4a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
      expect((await post(`${app.url}/api/captures`, cookie, autre)).status).toBe(201);
      expect((await post(`${app.url}/api/captures/privees`, cookie, autre)).status).toBe(400);
      expect(enfiles).toEqual([autre]);
    } finally {
      await app.fermer();
    }
  });
});
