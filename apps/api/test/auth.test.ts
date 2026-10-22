import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, VERROU_CONNEXION } from '../src/jetons.js';
import { FENETRE_VERROU_MS, MAX_ECHECS_COMPTE, VerrouConnexionMemoire } from '../src/auth/verrou.js';
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

  it('ouvrirSessionPour : même session de 90 jours, sans mot de passe à vérifier', async () => {
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    const s = await auth.ouvrirSessionPour(u.id);
    expect(s.expireLe.toISOString()).toBe('2027-01-04T08:00:00.000Z');
    expect(await auth.utilisateurDeSession(s.jeton)).toMatchObject({ nom: 'l' });
  });

  it('ne stocke que l\'empreinte du jeton', async () => {
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    const enBase = await prisma.session.findFirstOrThrow();
    expect(enBase.jetonHash).not.toBe(s!.jeton);
    expect(enBase.jetonHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('changement de mot de passe', () => {
  it('révoque toutes les sessions du compte', async () => {
    const s = await auth.ouvrirSession('l', 'un mot de passe assez long');
    await auth.definirMotDePasse('l', 'un autre mot de passe long');
    expect(await auth.utilisateurDeSession(s!.jeton)).toBeNull();
    expect(await auth.ouvrirSession('l', 'un autre mot de passe long')).not.toBeNull();
  });

  it('un compte inconnu donne une erreur claire', async () => {
    await expect(auth.definirMotDePasse('inconnu', 'un mot de passe assez long')).rejects.toThrow('Compte introuvable.');
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

  it('nomme le cookie avec le préfixe __Host- et efface l\'ancien nom', async () => {
    const r = await connecter('un mot de passe assez long');
    const poses = r.headers.getSetCookie();
    expect(poses[0]).toMatch(/^__Host-organizer_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000$/);
    expect(poses[0]).not.toMatch(/Domain=/i);
    expect(poses[1]).toBe('organizer_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  });

  it('l\'ancien cookie, sans préfixe, n\'ouvre plus de session', async () => {
    const r = await connecter('un mot de passe assez long');
    const jeton = lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE);
    const moi = await fetch(`${app.url}/api/session/moi`, { headers: { cookie: `organizer_session=${jeton}` } });
    expect(moi.status).toBe(401);
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
    expect(await moi.json()).toEqual({ nom: 'l', admin: false, versionServeur: 'dev' });
  });

  it('moi donne la version du serveur aux deux comptes (le bandeau de mise à jour la compare)', async () => {
    await prisma.utilisateur.create({ data: { nom: 'a', admin: true } });
    await auth.definirMotDePasse('a', 'un mot de passe assez long');
    const jeton = async (nom: string) => lireCookie((await connecter('un mot de passe assez long', nom)).headers.get('set-cookie') ?? '', NOM_COOKIE);
    const moi = async (nom: string) => (await fetch(`${app.url}/api/session/moi`, { headers: { cookie: `${NOM_COOKIE}=${await jeton(nom)}` } })).json();
    process.env.ORGANIZER_VERSION = '1.2.1';
    try {
      expect(await moi('a')).toEqual({ nom: 'a', admin: true, versionServeur: '1.2.1' });
      expect(await moi('l')).toEqual({ nom: 'l', admin: false, versionServeur: '1.2.1' });
    } finally { delete process.env.ORGANIZER_VERSION; }
  });

  it('la déconnexion supprime la session et efface le cookie', async () => {
    const r = await connecter('un mot de passe assez long');
    const jeton = lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE);
    const d = await fetch(`${app.url}/api/session`, { method: 'DELETE', headers: { cookie: `${NOM_COOKIE}=${jeton}` } });
    expect(d.status).toBe(204);
    expect(d.headers.getSetCookie()).toEqual([
      '__Host-organizer_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'organizer_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    ]);
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

describe('verrou par compte', () => {
  it('dix échecs sur un compte, d\'adresses toutes différentes, le verrouillent quinze minutes, lui seul', async () => {
    let t = 0;
    class ModuleVerrou {}
    Module({
      controllers: [AuthController],
      providers: [{ provide: AUTH, useValue: auth }, { provide: VERROU_CONNEXION, useValue: new VerrouConnexionMemoire(() => t) }, SessionGuard],
    })(ModuleVerrou);
    await prisma.utilisateur.create({ data: { nom: 'a' } });
    await auth.definirMotDePasse('a', 'un mot de passe assez long');
    // Proxy de confiance : chaque essai vient d'une autre adresse, le limiteur par IP ne joue pas.
    process.env.TRUSTED_PROXY = '127.0.0.1';
    const seule = await demarrerAppTest(ModuleVerrou);
    try {
      let ip = 0;
      const essai = (nom: string, motDePasse: string) => fetch(`${seule.url}/api/session`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${++ip}` },
        body: JSON.stringify({ nom, motDePasse }),
      });
      for (let i = 0; i < MAX_ECHECS_COMPTE; i++) expect((await essai('l', 'mauvais mot de passe !')).status).toBe(401);
      const bloque = await essai('l', 'un mot de passe assez long');
      expect(bloque.status).toBe(429);
      expect((await bloque.json()).message).toBe("Trop d'essais. Réessaie dans un quart d'heure.");
      expect(bloque.headers.get('set-cookie')).toBeNull();
      expect((await essai('a', 'un mot de passe assez long')).status).toBe(204);
      t = FENETRE_VERROU_MS;
      expect((await essai('l', 'un mot de passe assez long')).status).toBe(204);
    } finally {
      delete process.env.TRUSTED_PROXY;
      await seule.fermer();
    }
  });
});

describe('purge des sessions', () => {
  it('supprime les sessions expirées, garde les autres', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'p' } });
    await prisma.session.createMany({ data: [
      { jetonHash: 'a'.repeat(64), utilisateurId: u.id, expireLe: new Date('2026-10-01T00:00:00Z') },
      { jetonHash: 'b'.repeat(64), utilisateurId: u.id, expireLe: new Date('2027-01-01T00:00:00Z') },
    ] });
    expect(await auth.purgerExpirees()).toBe(1);
    expect((await prisma.session.findMany()).map((s) => s.jetonHash)).toEqual(['b'.repeat(64)]);
  });
});
