import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, PRISMA } from '../src/jetons.js';
import { SauvegardeController } from '../src/veille/sauvegarde.controller.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
const MDP = 'un mot de passe assez long';
let app: { url: string; fermer(): Promise<void> };
let admin: string;
let simple: string;

afterAll(() => prisma.$disconnect());
afterEach(async () => { await app?.fermer(); });

beforeEach(async () => {
  await viderBase(prisma);
  const auth = new AuthService(prisma);
  await prisma.utilisateur.create({ data: { nom: 'f', admin: true } });
  await prisma.utilisateur.create({ data: { nom: 'l' } });
  for (const n of ['f', 'l']) await auth.definirMotDePasse(n, MDP);
  admin = `${NOM_COOKIE}=${(await auth.ouvrirSession('f', MDP))!.jeton}`;
  simple = `${NOM_COOKIE}=${(await auth.ouvrirSession('l', MDP))!.jeton}`;
  class M {}
  Module({ controllers: [SauvegardeController], providers: [{ provide: AUTH, useValue: auth }, SessionGuard, { provide: PRISMA, useValue: prisma }] })(M);
  app = await demarrerAppTest(M);
});

const appel = (cookie: string, methode: string, chemin: string) => fetch(`${app.url}${chemin}`, { method: methode, headers: { cookie } });

describe('sauvegarde à la demande', () => {
  it('l\'admin voit la dernière réussie, et deux demandes n\'en font qu\'une', async () => {
    const fin = new Date('2026-10-23T01:05:00Z');
    await prisma.sauvegarde.create({ data: { debut: fin, fin, reussie: true, message: '' } });
    await prisma.sauvegarde.create({ data: { debut: new Date(), fin: new Date(), reussie: false, message: 'étape audio (code 23)' } });
    expect(await (await appel(admin, 'GET', '/api/sauvegarde')).json()).toEqual({ derniereReussie: fin.toISOString(), demandee: false });
    expect((await appel(admin, 'POST', '/api/sauvegarde/demande')).status).toBe(204);
    expect((await appel(admin, 'POST', '/api/sauvegarde/demande')).status).toBe(204);
    expect(await prisma.demandeSauvegarde.count()).toBe(1);
    expect((await (await appel(admin, 'GET', '/api/sauvegarde')).json()).demandee).toBe(true);
  });

  it('sans sauvegarde réussie : derniereReussie nulle', async () => {
    expect(await (await appel(admin, 'GET', '/api/sauvegarde')).json()).toEqual({ derniereReussie: null, demandee: false });
  });

  it('un compte non admin : 404, rien n\'est demandé ; sans session : 401', async () => {
    expect((await appel(simple, 'GET', '/api/sauvegarde')).status).toBe(404);
    expect((await appel(simple, 'POST', '/api/sauvegarde/demande')).status).toBe(404);
    expect(await prisma.demandeSauvegarde.count()).toBe(0);
    expect((await appel('', 'POST', '/api/sauvegarde/demande')).status).toBe(401);
  });
});
