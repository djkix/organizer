import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlertesController } from '../src/alertes/alertes.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, PRISMA } from '../src/jetons.js';
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
  Module({ controllers: [AlertesController], providers: [{ provide: AUTH, useValue: auth }, SessionGuard, { provide: PRISMA, useValue: prisma }] })(M);
  app = await demarrerAppTest(M);
});

const appel = (cookie: string, methode: string, chemin: string) => fetch(`${app.url}${chemin}`, { method: methode, headers: { cookie } });

describe('alertes techniques', () => {
  it('l\'admin voit les alertes récentes, plus récentes d\'abord, et peut les marquer comme vues', async () => {
    const il = (j: number) => new Date(Date.now() - j * 86_400_000);
    await prisma.alerte.create({ data: { cle: 'a', message: 'Crédit Gemini épuisé.', creeLe: il(2) } });
    await prisma.alerte.create({ data: { cle: 'b', message: 'File : 60 captures en attente.', creeLe: il(1) } });
    await prisma.alerte.create({ data: { cle: 'c', message: 'Vieille alerte.', creeLe: il(40) } });
    const r = await (await appel(admin, 'GET', '/api/alertes')).json();
    expect(r.nonVues).toBe(true);
    expect(r.alertes.map((a: { message: string }) => a.message)).toEqual(['File : 60 captures en attente.', 'Crédit Gemini épuisé.']);
    expect((await appel(admin, 'POST', '/api/alertes/vues')).status).toBe(204);
    const apres = await (await appel(admin, 'GET', '/api/alertes')).json();
    expect(apres.nonVues).toBe(false);
    expect(apres.alertes.every((a: { vue: boolean }) => a.vue)).toBe(true);
  });

  it('un compte non admin : 404 sur la liste et sur « vues », rien n\'est marqué', async () => {
    await prisma.alerte.create({ data: { cle: 'a', message: 'Crédit Gemini épuisé.' } });
    expect((await appel(simple, 'GET', '/api/alertes')).status).toBe(404);
    expect((await appel(simple, 'POST', '/api/alertes/vues')).status).toBe(404);
    expect((await prisma.alerte.findFirstOrThrow()).vueLe).toBeNull();
  });

  it('sans session : 401', async () => {
    expect((await appel('', 'GET', '/api/alertes')).status).toBe(401);
  });
});
