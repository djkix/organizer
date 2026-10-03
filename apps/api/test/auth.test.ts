import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH } from '../src/jetons.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
let horloge = new Date('2026-10-06T08:00:00Z');
const auth = new AuthService(prisma, () => horloge);

class ModuleTest {}
Module({ controllers: [AuthController], providers: [{ provide: AUTH, useValue: auth }, SessionGuard] })(ModuleTest);

let app: { url: string; fermer(): Promise<void> };
beforeAll(async () => { app = await demarrerAppTest(ModuleTest); });
afterAll(async () => { await app.fermer(); await prisma.$disconnect(); });
beforeEach(async () => {
  horloge = new Date('2026-10-06T08:00:00Z');
  await viderBase(prisma);
  await prisma.utilisateur.create({ data: { nom: 'l' } });
  await auth.definirMotDePasse('l', 'un mot de passe assez long');
});

const connecter = (motDePasse: string, nom = 'l') =>
  fetch(`${app.url}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nom, motDePasse }) });

describe('AuthService', () => {
  it('stocke un haché Argon2id, jamais le mot de passe', async () => {
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    expect(u.motDePasseHash).toMatch(/^\$argon2id\$/);
  });

  it('refuse un mot de passe de moins de 12 caractères', async () => {
    await expect(auth.definirMotDePasse('l', 'court')).rejects.toThrow('12');
  });

  it('une session expire au bout de 90 jours', async () => {
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    expect(s?.expireLe.toISOString()).toBe('2027-01-04T08:00:00.000Z');
    horloge = new Date('2027-01-04T08:00:01Z');
    expect(await auth.utilisateurDeSession(s!.jeton)).toBeNull();
  });

  it('ne stocke que l\'empreinte du jeton', async () => {
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const enBase = await prisma.session.findFirstOrThrow();
    expect(enBase.jetonHash).not.toBe(s!.jeton);
    expect(enBase.jetonHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('/api/session', () => {
  it('pose un cookie de session HttpOnly, Secure, SameSite=Lax, 90 jours', async () => {
    const r = await connecter('un mot de passe assez long');
    expect(r.status).toBe(204);
    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${NOM_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=7776000/);
  });

  it('même réponse pour un mauvais mot de passe et un compte inconnu', async () => {
    const a = await connecter('mauvais mot de passe !');
    const b = await connecter('un mot de passe assez long', 'inconnu');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect((await a.json()).message).toBe('Identifiants invalides.');
    expect((await b.json()).message).toBe('Identifiants invalides.');
  });

  it('moi exige une session valide ; un cookie forgé reçoit 401', async () => {
    const sans = await fetch(`${app.url}/api/session/moi`);
    expect(sans.status).toBe(401);
    expect((await sans.json()).message).toBe('Connecte-toi pour continuer.');
    const forge = await fetch(`${app.url}/api/session/moi`, { headers: { cookie: `${NOM_COOKIE}=faux` } });
    expect(forge.status).toBe(401);

    const r = await connecter('un mot de passe assez long');
    const jeton = lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE);
    const moi = await fetch(`${app.url}/api/session/moi`, { headers: { cookie: `${NOM_COOKIE}=${jeton}` } });
    expect(await moi.json()).toEqual({ nom: 'l' });
  });

  it('la déconnexion supprime la session et efface le cookie', async () => {
    const r = await connecter('un mot de passe assez long');
    const jeton = lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE);
    const d = await fetch(`${app.url}/api/session`, { method: 'DELETE', headers: { cookie: `${NOM_COOKIE}=${jeton}` } });
    expect(d.status).toBe(204);
    expect(d.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await prisma.session.count()).toBe(0);
  });

  it('dix essais par minute et par IP au plus', async () => {
    // Application à part : le limiteur appartient à l'instance du contrôleur, les autres tests l'ont entamé.
    const seule = await demarrerAppTest(ModuleTest);
    try {
      const statuts: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = await fetch(`${seule.url}/api/session`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ nom: 'l', motDePasse: 'mauvais mot de passe !' }),
        });
        statuts.push(r.status);
      }
      expect(statuts.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuts[10]).toBe(429);
    } finally {
      await seule.fermer();
    }
  });
});
