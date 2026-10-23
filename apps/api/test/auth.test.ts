import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleIndisponible, type VerificateurGoogle } from '../src/auth/google.js';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, CLIENT_GOOGLE, VERIFICATEUR_GOOGLE } from '../src/jetons.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
let horloge = new Date('2026-10-06T08:00:00Z');
const auth = new AuthService(prisma, () => horloge);

// Faux vérificateur : 'bon' vaut l'adresse reliée, 'autre' une adresse non reliée, le reste est invalide.
const verificateur: VerificateurGoogle = {
  async verifier(jeton) {
    if (jeton === 'bon') return { sub: 'sub-1', email: 'l@exemple.org', emailVerifie: true };
    if (jeton === 'autre') return { sub: 'sub-2', email: 'autre@exemple.org', emailVerifie: true };
    if (jeton === 'jeton-panne') throw new GoogleIndisponible('ERR_JWKS_TIMEOUT');
    return null;
  },
};

class ModuleTest {}
Module({
  controllers: [AuthController],
  providers: [{ provide: AUTH, useValue: auth }, { provide: VERIFICATEUR_GOOGLE, useValue: verificateur }, { provide: CLIENT_GOOGLE, useValue: 'client-essai' }, SessionGuard],
})(ModuleTest);

let app: { url: string; fermer(): Promise<void> };
beforeAll(async () => { app = await demarrerAppTest(ModuleTest); });
afterAll(async () => { await app.fermer(); await prisma.$disconnect(); });
beforeEach(async () => {
  horloge = new Date('2026-10-06T08:00:00Z');
  await viderBase(prisma);
  await prisma.utilisateur.create({ data: { nom: 'l' } });
  await prisma.utilisateur.update({ where: { nom: 'l' }, data: { googleEmail: 'l@exemple.org' } });
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

describe('connexion Google', () => {
  const profil = { sub: 's1', email: 'l@exemple.org', emailVerifie: true };
  beforeEach(async () => { await auth.lierGoogle('l', 'L@Exemple.org'); });

  it('adresse reliée : session de 90 jours, sub mémorisé', async () => {
    const s = await auth.ouvrirSessionGoogle(profil);
    expect(s?.expireLe).toEqual(new Date(horloge.getTime() + 90 * 24 * 3600_000));
    expect((await prisma.utilisateur.findUnique({ where: { nom: 'l' } }))?.googleSub).toBe('s1');
  });
  it('adresse comparée en minuscules', async () => {
    expect(await auth.ouvrirSessionGoogle(profil)).not.toBeNull();
  });
  it('adresse non vérifiée : refusée', async () => {
    expect(await auth.ouvrirSessionGoogle({ ...profil, emailVerifie: false })).toBeNull();
  });
  it('adresse inconnue : refusée', async () => {
    expect(await auth.ouvrirSessionGoogle({ ...profil, email: 'x@exemple.org' })).toBeNull();
  });
  it('sub changé : refusé', async () => {
    expect(await auth.ouvrirSessionGoogle(profil)).not.toBeNull();
    expect(await auth.ouvrirSessionGoogle({ ...profil, sub: 's2' })).toBeNull();
  });
  it('sub déjà pris : refusé sans erreur', async () => {
    await prisma.utilisateur.create({ data: { nom: 'f', googleSub: 's1' } });
    expect(await auth.ouvrirSessionGoogle(profil)).toBeNull();
  });
  it('lierGoogle : adresse déjà reliée à un autre compte refusée', async () => {
    await prisma.utilisateur.create({ data: { nom: 'f' } });
    await expect(auth.lierGoogle('f', 'l@exemple.org')).rejects.toThrow('Adresse déjà reliée');
    await expect(auth.lierGoogle('absent', 'z@exemple.org')).rejects.toThrow('Compte introuvable.');
  });
  it('lierGoogle : remet le sub à vide ; delierGoogle retire adresse et sub', async () => {
    await auth.ouvrirSessionGoogle(profil);
    await auth.lierGoogle('l', 'autre@exemple.org');
    const relie = await prisma.utilisateur.findUnique({ where: { nom: 'l' } });
    expect([relie?.googleEmail, relie?.googleSub]).toEqual(['autre@exemple.org', null]);
    await auth.delierGoogle('l');
    const delie = await prisma.utilisateur.findUnique({ where: { nom: 'l' } });
    expect([delie?.googleEmail, delie?.googleSub]).toEqual([null, null]);
  });
  it('delierGoogle ferme les sessions du compte', async () => {
    await auth.ouvrirSessionGoogle(profil);
    await auth.ouvrirSession('l', 'un mot de passe assez long');
    await prisma.utilisateur.create({ data: { nom: 'f' } });
    const autre = await auth.ouvrirSessionPour((await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'f' } })).id);
    await auth.delierGoogle('l');
    expect(await prisma.session.count({ where: { utilisateur: { nom: 'l' } } })).toBe(0);
    expect(await auth.utilisateurDeSession(autre.jeton)).not.toBeNull();
    await expect(auth.delierGoogle('absent')).rejects.toThrow('Compte introuvable.');
  });
  it('le mot de passe marche toujours après une liaison Google', async () => {
    expect(await auth.ouvrirSession('l', 'un mot de passe assez long')).not.toBeNull();
  });
});

describe('/api/session/google', () => {
  const poster = (url: string, corps: unknown) =>
    fetch(`${url}/api/session/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
  const MESSAGE = "Ce compte Google n'est pas reconnu.";

  it('GET : identifiant du client, sans session', async () => {
    const r = await fetch(`${app.url}/api/session/google`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ clientId: 'client-essai' });
  });

  it('POST : cookie de session pour une adresse reliée', async () => {
    const r = await poster(app.url, { jeton: 'bon' });
    expect(r.status).toBe(204);
    const cookie = r.headers.get('set-cookie') ?? '';
    const jeton = lireCookie(cookie, NOM_COOKIE);
    expect(cookie).toMatch(/HttpOnly/);
    const moi = await fetch(`${app.url}/api/session/moi`, { headers: { cookie: `${NOM_COOKIE}=${jeton}` } });
    expect((await moi.json()).nom).toBe('l');
  });

  it('POST : 401 et message unique sinon', async () => {
    for (const jeton of ['mauvais', 'autre']) {
      const r = await poster(app.url, { jeton });
      expect(r.status).toBe(401);
      expect(await r.json()).toMatchObject({ message: MESSAGE });
    }
  });

  it('POST : corps invalide → 401, jamais 500', async () => {
    // Application à part : le limiteur est partagé, les autres tests l'ont entamé.
    const seule = await demarrerAppTest(ModuleTest);
    try {
      for (const corps of [{}, { jeton: '' }, { jeton: 'x'.repeat(4097) }, { jeton: 5 }, [], { jeton: ['bon'] }]) {
        const r = await poster(seule.url, corps);
        expect(r.status).toBe(401);
        expect(await r.json()).toMatchObject({ message: MESSAGE });
      }
    } finally { await seule.fermer(); }
  });

  it('le limiteur est commun aux deux connexions', async () => {
    const seule = await demarrerAppTest(ModuleTest);
    try {
      const statuts: number[] = [];
      for (let i = 0; i < 11; i++) {
        const r = i % 2 === 0 ? await poster(seule.url, { jeton: 'mauvais' }) : await fetch(`${seule.url}/api/session`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nom: 'l', motDePasse: 'mauvais mot de passe !' }),
        });
        statuts.push(r.status);
      }
      expect(statuts.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(statuts[10]).toBe(429);
    } finally { await seule.fermer(); }
  });

  it('certificats injoignables : 503, message, journal sans jeton', async () => {
    const espion = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const seule = await demarrerAppTest(ModuleTest);
    try {
      const r = await poster(seule.url, { jeton: 'jeton-panne' });
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ message: 'Google indisponible. Utilise ton mot de passe.' });
      const tout = JSON.stringify(espion.mock.calls);
      expect(tout).toContain('Connexion Google : certificats injoignables (ERR_JWKS_TIMEOUT)');
      expect(tout).not.toContain('jeton-panne');
    } finally { espion.mockRestore(); await seule.fermer(); }
  });

  it('aucun jeton ni adresse dans les journaux', async () => {
    const espions = [
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {})),
      ...(['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => vi.spyOn(Logger.prototype, m).mockImplementation(() => {})),
    ];
    try {
      await poster(app.url, { jeton: 'bon' });
      await poster(app.url, { jeton: 'jeton-secret-mauvais' });
      await poster(app.url, { jeton: 'autre' });
      await poster(app.url, { jeton: 'jeton-panne' });
      const tout = JSON.stringify(espions.flatMap((e) => e.mock.calls));
      for (const interdit of ['bon', 'jeton-secret-mauvais', 'jeton-panne', 'l@exemple.org', 'autre@exemple.org']) expect(tout).not.toContain(interdit);
    } finally { espions.forEach((e) => e.mockRestore()); }
  });
});
