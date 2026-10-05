import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthService } from '../src/auth/auth.service.js';
import { lireCookie, NOM_COOKIE } from '../src/auth/cookies.js';
import { DelaiDepasse, type MagasinDefis, type TypeDefi } from '../src/auth/empreintes/defis.js';
import { EmpreintesController, MESSAGE_INDISPONIBLE, MESSAGE_REFUS, MESSAGE_TROP } from '../src/auth/empreintes/empreintes.controller.js';
import { EmpreintesService } from '../src/auth/empreintes/empreintes.service.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AUTH, EMPREINTES } from '../src/jetons.js';
import { AuthentificateurLogiciel, CONFIG_ESSAI, MagasinDefisMemoire } from './aides-webauthn.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
const auth = new AuthService(prisma, () => new Date('2026-10-06T08:00:00Z'));

/** Magasin que le test peut rendre muet, comme un Valkey arrêté. */
const magasin = new (class implements MagasinDefis {
  muet = false;
  interne = new MagasinDefisMemoire();
  poser(type: TypeDefi, defi: string, valeur: string): Promise<void> {
    return this.muet ? Promise.reject(new DelaiDepasse()) : this.interne.poser(type, defi, valeur);
  }
  prendre(type: TypeDefi, defi: string): Promise<string | null> {
    return this.muet ? Promise.reject(new DelaiDepasse()) : this.interne.prendre(type, defi);
  }
})();
const empreintes = new EmpreintesService(prisma, magasin, CONFIG_ESSAI, undefined, () => {});

class ModuleTest {}
Module({
  controllers: [AuthController, EmpreintesController],
  providers: [{ provide: AUTH, useValue: auth }, { provide: EMPREINTES, useValue: empreintes }, SessionGuard],
})(ModuleTest);

// Une application par test : le limiteur (10 par minute) appartient à l'instance du contrôleur.
let app: { url: string; fermer(): Promise<void> };
let telephone: AuthentificateurLogiciel;
afterAll(() => prisma.$disconnect());
afterEach(() => app.fermer());
beforeEach(async () => {
  app = await demarrerAppTest(ModuleTest);
  magasin.muet = false;
  telephone = new AuthentificateurLogiciel(CONFIG_ESSAI.rpId, CONFIG_ESSAI.origine);
  await viderBase(prisma);
  await prisma.utilisateur.create({ data: { nom: 'l' } });
  await auth.definirMotDePasse('l', 'un mot de passe assez long');
});

const appeler = (methode: string, chemin: string, corps?: unknown, cookie?: string) => fetch(`${app.url}${chemin}`, {
  method: methode,
  headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) },
  body: corps === undefined ? undefined : JSON.stringify(corps),
});
const cookieDe = (r: Response): string => `${NOM_COOKIE}=${lireCookie(r.headers.get('set-cookie') ?? '', NOM_COOKIE)}`;
const parMotDePasse = async (): Promise<string> =>
  cookieDe(await appeler('POST', '/api/session', { nom: 'l', motDePasse: 'un mot de passe assez long' }));

async function activer(cookie: string): Promise<void> {
  const o = await (await appeler('POST', '/api/empreintes/options', undefined, cookie)).json();
  const r = await appeler('POST', '/api/empreintes', telephone.inscrire(o), cookie);
  expect(r.status).toBe(201);
}

describe('/api/session/empreinte', () => {
  it('activer, se déconnecter, se reconnecter : la même session que le mot de passe', async () => {
    const cookie = await parMotDePasse();
    await activer(cookie);
    expect((await appeler('DELETE', '/api/session', undefined, cookie)).status).toBe(204);

    const o = await appeler('POST', '/api/session/empreinte/options');
    expect(o.status).toBe(200);
    const r = await appeler('POST', '/api/session/empreinte', telephone.authentifier(await o.json()));
    expect(r.status).toBe(204);
    const pose = r.headers.get('set-cookie') ?? '';
    expect(pose).toContain(`${NOM_COOKIE}=`);
    for (const attribut of [/HttpOnly/, /Secure/, /SameSite=Lax/, /Max-Age=7776000/]) expect(pose).toMatch(attribut);
    expect(await (await appeler('GET', '/api/session/moi', undefined, cookieDe(r))).json()).toEqual({ nom: 'l' });
  });

  it('une empreinte refusée : 401, message court, aucun cookie', async () => {
    for (const corps of [{}, { id: 'abc', rawId: 'abc', type: 'public-key', clientExtensionResults: {}, response: {} }]) {
      const r = await appeler('POST', '/api/session/empreinte', corps);
      expect(r.status).toBe(401);
      expect((await r.json()).message).toBe(MESSAGE_REFUS);
      expect(r.headers.get('set-cookie')).toBeNull();
    }
    const cookie = await parMotDePasse();
    await activer(cookie);
    await prisma.cleAcces.deleteMany();
    const o = await (await appeler('POST', '/api/session/empreinte/options')).json();
    expect((await appeler('POST', '/api/session/empreinte', telephone.authentifier(o))).status).toBe(401);
  });

  it('dix essais par minute et par IP au plus', async () => {
    const statuts: number[] = [];
    for (let i = 0; i < 11; i++) statuts.push((await appeler('POST', '/api/session/empreinte/options')).status);
    expect(statuts.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuts[10]).toBe(429);
  });

  it('Valkey muet : 503 et message court sur l\'empreinte, le mot de passe marche toujours', async () => {
    magasin.muet = true;
    const r = await appeler('POST', '/api/session/empreinte/options');
    expect(r.status).toBe(503);
    expect((await r.json()).message).toBe(MESSAGE_INDISPONIBLE);
    const cookie = await parMotDePasse();
    expect((await appeler('POST', '/api/empreintes/options', undefined, cookie)).status).toBe(503);
    const m = await appeler('POST', '/api/session', { nom: 'l', motDePasse: 'un mot de passe assez long' });
    expect(m.status).toBe(204);
  });
});

describe('/api/empreintes', () => {
  it('sans session : ni options, ni activation, ni liste, ni retrait', async () => {
    for (const [methode, chemin] of [
      ['POST', '/api/empreintes/options'], ['POST', '/api/empreintes'], ['GET', '/api/empreintes'],
      ['DELETE', '/api/empreintes/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      expect((await appeler(methode, chemin, methode === 'POST' ? {} : undefined)).status, chemin).toBe(401);
    }
  });

  it('liste et retrait : seulement ses clés ; identifiant d\'autrui ou mal formé : 404', async () => {
    const cookie = await parMotDePasse();
    await activer(cookie);
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const sienne = await prisma.cleAcces.create({ data: { identifiant: 'cle-autre', utilisateurId: autre.id, clePublique: new Uint8Array([1]) } });
    const liste = await (await appeler('GET', '/api/empreintes', undefined, cookie)).json();
    expect(liste).toHaveLength(1);
    expect(Object.keys(liste[0]).sort()).toEqual(['creeLe', 'id', 'identifiant', 'utiliseeLe']);
    expect((await appeler('DELETE', `/api/empreintes/${sienne.id}`, undefined, cookie)).status).toBe(404);
    expect((await appeler('DELETE', '/api/empreintes/pas-un-uuid', undefined, cookie)).status).toBe(404);
    expect((await appeler('DELETE', `/api/empreintes/${liste[0].id}`, undefined, cookie)).status).toBe(204);
    expect(await (await appeler('GET', '/api/empreintes', undefined, cookie)).json()).toEqual([]);
  });

  it('activation refusée : 400 ; dix clés au plus : 409 avec un message court', async () => {
    const cookie = await parMotDePasse();
    const o = await (await appeler('POST', '/api/empreintes/options', undefined, cookie)).json();
    const faussee = telephone.inscrire(o, { origine: 'https://exemple.net' });
    expect((await appeler('POST', '/api/empreintes', faussee, cookie)).status).toBe(400);
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    await prisma.cleAcces.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({ identifiant: `cle-${i}`, utilisateurId: u.id, clePublique: new Uint8Array([1]) })),
    });
    const r = await appeler('POST', '/api/empreintes/options', undefined, cookie);
    expect(r.status).toBe(409);
    expect((await r.json()).message).toBe(MESSAGE_TROP);
  });
});
