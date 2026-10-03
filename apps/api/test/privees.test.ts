import 'reflect-metadata';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { AUTH, PRIVEES } from '../src/jetons.js';
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

let racine: string;
let reencodeur: FauxReencodeur;
let service: CapturesPriveesService;
let utilisateurId: string;
const ID = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

beforeEach(async () => {
  await viderBase(prisma);
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  reencodeur = new FauxReencodeur();
  service = new CapturesPriveesService(prisma, new StockageAudio(racine), reencodeur);
  utilisateurId = (await prisma.utilisateur.create({ data: { nom: 'l' } })).id;
});

const depot = (o: Partial<{ id: string; mime: string }> = {}) => ({
  id: o.id ?? ID, donnees: Buffer.from('webm'), mime: o.mime ?? 'audio/webm',
  emisLe: new Date('2026-10-06T06:12:00Z'), dureeS: 14,
});

describe('CapturesPriveesService', () => {
  it('crée en une écriture une capture privée, audio réencodé rangé dans prive/', async () => {
    expect(await service.enregistrer(utilisateurId, depot())).toEqual({ id: ID, nouvelle: true });
    const c = await prisma.capture.findUniqueOrThrow({ where: { id: ID } });
    expect(c).toMatchObject({ prive: true, etat: 'privee', canal: 'pwa', audioMime: 'audio/ogg', dureeS: 14, texteBrut: null });
    expect(c.audioPath).toBe(`prive/2026/10/${ID}.ogg`);
    expect(existsSync(join(racine, c.audioPath!))).toBe(true);
  });

  it('rejouer le même identifiant ne crée rien et ne réencode pas', async () => {
    await service.enregistrer(utilisateurId, depot());
    expect(await service.enregistrer(utilisateurId, depot())).toEqual({ id: ID, nouvelle: false });
    expect(reencodeur.appels).toBe(1);
    expect(await prisma.capture.count()).toBe(1);
  });

  it('refuse un format hors liste, avant tout réencodage', async () => {
    await expect(service.enregistrer(utilisateurId, depot({ mime: 'image/png' }))).rejects.toBeInstanceOf(FormatRefuse);
    expect(reencodeur.appels).toBe(0);
  });

  it('refuse un identifiant qui désigne une capture ordinaire', async () => {
    await prisma.capture.create({ data: { id: ID, utilisateurId, canal: 'telegram', prive: false, etat: 'recue', emisLe: new Date() } });
    await expect(service.enregistrer(utilisateurId, depot())).rejects.toThrow();
  });

  it('étiquette, puis liste par jour local, les plus récents d\'abord', async () => {
    await service.enregistrer(utilisateurId, depot());
    await service.enregistrer(utilisateurId, { ...depot({ id: '4a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d' }), emisLe: new Date('2026-10-06T22:30:00Z') });
    await service.etiqueter(ID, 'garage');
    const mois = await service.lister('2026-10', 'Europe/Paris');
    expect(mois.map((j) => j.jour)).toEqual(['2026-10-07', '2026-10-06']);
    expect(mois[1]!.captures).toEqual([{ id: ID, heure: '08:12', dureeS: 14, etiquette: 'garage', aAudio: true }]);
  });
});

describe('lister : indicateur d\'audio', () => {
  it('une capture privée sans fichier audio a aAudio faux', async () => {
    await prisma.capture.create({
      data: { utilisateurId, canal: 'telegram', prive: true, etat: 'privee', emisLe: new Date('2026-10-06T07:00:00Z'), texteEcrit: 'x' },
    });
    const mois = await service.lister('2026-10', 'Europe/Paris');
    expect(mois[0]!.captures[0]).toMatchObject({ aAudio: false });
  });
});

describe('/api/captures/privees', () => {
  it('reçoit l\'audio brut, rejoue sans doublon, refuse un format inconnu', async () => {
    const auth = new AuthService(prisma);
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    class M {}
    Module({ controllers: [PriveesController], providers: [
      { provide: PRIVEES, useValue: service }, { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    const app = await demarrerAppTest(M);
    try {
      const envoyer = (type: string) => fetch(`${app.url}/api/captures/privees`, {
        method: 'POST',
        headers: { cookie: `${NOM_COOKIE}=${s!.jeton}`, 'content-type': type, 'x-capture-id': ID, 'x-duree-s': '14' },
        body: Buffer.from('webm'),
      });
      const a = await envoyer('audio/webm;codecs=opus');
      expect(a.status).toBe(201);
      expect(await a.json()).toEqual({ id: ID });
      expect((await envoyer('audio/webm')).status).toBe(200);
      const c = await envoyer('image/png');
      expect(c.status).toBe(415);
      expect((await c.json()).message).toBe('Format audio non pris en charge.');
    } finally {
      await app.fermer();
    }
  });
});

describe('/api/captures/privees : erreurs et paramètres', () => {
  let app: Awaited<ReturnType<typeof demarrerAppTest>>;
  let cookie: string;

  beforeEach(async () => {
    const auth = new AuthService(prisma);
    await auth.definirMotDePasse('l', 'un mot de passe assez long');
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    cookie = `${NOM_COOKIE}=${s!.jeton}`;
    class M {}
    Module({ controllers: [PriveesController], providers: [
      { provide: PRIVEES, useValue: service }, { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    app = await demarrerAppTest(M);
  });
  afterEach(async () => {
    await app.fermer();
  });

  const post = (en: Record<string, string> = {}, corps: Buffer = Buffer.from('webm')) => fetch(`${app.url}/api/captures/privees`, {
    method: 'POST', headers: { cookie, 'content-type': 'audio/webm', 'x-capture-id': ID, ...en }, body: new Uint8Array(corps),
  });
  const patch = (id: string, corps: unknown) => fetch(`${app.url}/api/captures/privees/${id}`, {
    method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(corps),
  });

  it('422 si l\'audio est illisible', async () => {
    service = new CapturesPriveesService(prisma, new StockageAudio(racine), {
      async versOpus(): Promise<Buffer> { throw new AudioIllisible('x'); },
    });
    await app.fermer();
    const auth = new AuthService(prisma);
    class M {}
    Module({ controllers: [PriveesController], providers: [
      { provide: PRIVEES, useValue: service }, { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    app = await demarrerAppTest(M);
    const r = await post();
    expect(r.status).toBe(422);
    expect((await r.json()).message).toBe('Enregistrement illisible.');
  });

  it('400 si l\'identifiant fourni n\'est pas un UUID, sans rien créer', async () => {
    const r = await post({ 'x-capture-id': 'pas-un-uuid' });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toBe('Identifiant refusé.');
    expect(await prisma.capture.count()).toBe(0);
  });

  it('sans identifiant, la capture reçoit un identifiant aléatoire', async () => {
    const r = await fetch(`${app.url}/api/captures/privees`, {
      method: 'POST', headers: { cookie, 'content-type': 'audio/webm' }, body: new Uint8Array(Buffer.from('webm')),
    });
    expect(r.status).toBe(201);
    expect(await prisma.capture.count()).toBe(1);
  });

  it('400 si le corps est vide', async () => {
    const r = await post({}, Buffer.alloc(0));
    expect(r.status).toBe(400);
    expect((await r.json()).message).toBe('Enregistrement vide.');
  });

  it('400 si l\'identifiant désigne une capture ordinaire', async () => {
    await prisma.capture.create({ data: { id: ID, utilisateurId, canal: 'telegram', prive: false, etat: 'recue', emisLe: new Date() } });
    const r = await post();
    expect(r.status).toBe(400);
    expect((await r.json()).message).toBe('Identifiant refusé.');
  });

  it('PATCH : 204, étiquette vide devient nulle, 404, plus de 80 caractères refusés', async () => {
    await post();
    expect((await patch(ID, { etiquette: 'garage' })).status).toBe(204);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: ID } })).etiquette).toBe('garage');
    expect((await patch(ID, { etiquette: '' })).status).toBe(204);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: ID } })).etiquette).toBeNull();
    expect((await patch('4a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d', { etiquette: 'x' })).status).toBe(404);
    expect((await patch(ID, { etiquette: 'x'.repeat(81) })).status).toBe(400);
  });

  it('GET : 400 sur un mois invalide', async () => {
    const r = await fetch(`${app.url}/api/captures/privees?mois=2026-13`, { headers: { cookie } });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toBe('Mois attendu au format AAAA-MM.');
  });

  it('un X-Emis-Le futur devient l\'heure de réception', async () => {
    const avant = Date.now();
    await post({ 'x-emis-le': new Date(Date.now() + 3_600_000).toISOString() });
    const c = await prisma.capture.findUniqueOrThrow({ where: { id: ID } });
    expect(Math.abs(c.emisLe.getTime() - avant)).toBeLessThan(10_000);
  });

  it.each(['3601', '-1', '', '1e3', '0x10', 'abc'])('un X-Duree-S « %s » devient nul', async (v) => {
    await post({ 'x-duree-s': v });
    expect((await prisma.capture.findUniqueOrThrow({ where: { id: ID } })).dureeS).toBeNull();
  });

  it('une panne inattendue reste une erreur 500, pas un 404 ni un 400', async () => {
    const casse = new Proxy(service, { get: (c, n) => (n === 'etiqueter' || n === 'lister'
      ? async () => { throw new Error('base injoignable'); } : Reflect.get(c, n)) });
    await app.fermer();
    const auth = new AuthService(prisma);
    class M {}
    Module({ controllers: [PriveesController], providers: [
      { provide: PRIVEES, useValue: casse }, { provide: AUTH, useValue: auth }, SessionGuard,
    ] })(M);
    app = await demarrerAppTest(M);
    expect((await patch(ID, { etiquette: 'x' })).status).toBe(500);
    expect((await fetch(`${app.url}/api/captures/privees?mois=2026-10`, { headers: { cookie } })).status).toBe(500);
  });
});
