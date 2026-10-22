import 'reflect-metadata';
import { createServer } from 'node:http';
import { Controller, HttpCode, Module, Post } from '@nestjs/common';
import { DELAI_ENVOI_PRIVE_MAX_MS } from '@organizer/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { configurerServeur, lireConfianceProxy } from '../src/http.js';
import { AUTH } from '../src/jetons.js';
import { demarrerAppTest } from './aides-http.js';

class ModuleTest {}
Module({ controllers: [AuthController], providers: [{ provide: AUTH, useValue: { ouvrirSession: async () => null } }] })(ModuleTest);

afterEach(() => { delete process.env.TRUSTED_PROXY; });

async function essais(xff: (i: number) => string): Promise<number[]> {
  const app = await demarrerAppTest(ModuleTest);
  try {
    const statuts: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await fetch(`${app.url}/api/session`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff(i) },
        // Un compte par essai : le verrou par compte (dix échecs) ne se mêle pas au limiteur par IP.
        body: JSON.stringify({ nom: `l${i}`, motDePasse: 'x' }),
      });
      statuts.push(r.status);
    }
    return statuts;
  } finally {
    await app.fermer();
  }
}

it('un X-Forwarded-For venu d\'un appelant non fiable ne change pas la clé du limiteur', async () => {
  process.env.TRUSTED_PROXY = '10.9.9.9';
  const statuts = await essais((i) => `1.2.3.${i}`);
  expect(statuts[10]).toBe(429);
});

it('un proxy de confiance fait foi : chaque client a son budget', async () => {
  process.env.TRUSTED_PROXY = '127.0.0.1';
  const statuts = await essais((i) => `1.2.3.${i}`);
  expect(statuts.every((s) => s === 401)).toBe(true);
});

describe('production', () => {
  it('TRUSTED_PROXY est obligatoire en production', () => {
    expect(() => lireConfianceProxy({ NODE_ENV: 'production' })).toThrow('TRUSTED_PROXY obligatoire en production');
    expect(lireConfianceProxy({ NODE_ENV: 'production', TRUSTED_PROXY: '10.201.1.0/24, 192.168.1.10' }))
      .toBe('10.201.1.0/24, 192.168.1.10');
    expect(lireConfianceProxy({ NODE_ENV: 'test' })).toBe('loopback');
  });

  it('une capture d\'une heure n\'est jamais coupée par le serveur HTTP (5 min par défaut dans Node)', () => {
    const serveur = createServer();
    configurerServeur(serveur);
    expect(serveur.requestTimeout).toBeGreaterThan(DELAI_ENVOI_PRIVE_MAX_MS);
    expect(serveur.keepAliveTimeout).toBeGreaterThan(120_000);
    expect(serveur.headersTimeout).toBeGreaterThan(serveur.keepAliveTimeout);
  });
});

describe('origine des requêtes qui modifient (CSRF)', () => {
  @Controller('telegram')
  class FauxWebhook {
    @Post('webhook')
    @HttpCode(204)
    recevoir(): void {}
  }
  class ModuleOrigine {}
  Module({
    controllers: [AuthController, FauxWebhook],
    providers: [{ provide: AUTH, useValue: { ouvrirSession: async () => null, utilisateurDeSession: async () => null } }, SessionGuard],
  })(ModuleOrigine);

  const ORIGINE_PWA = 'http://localhost:5173';

  async function statut(chemin: string, methode: string, entetes: Record<string, string>): Promise<number> {
    const app = await demarrerAppTest(ModuleOrigine);
    try {
      const r = await fetch(`${app.url}${chemin}`, {
        method: methode,
        headers: { 'content-type': 'application/json', ...entetes },
        body: methode === 'GET' ? undefined : JSON.stringify({ nom: 'l', motDePasse: 'x' }),
      });
      return r.status;
    } finally {
      await app.fermer();
    }
  }

  it('refuse un POST /api venu d\'un autre site, même voisin (Sec-Fetch-Site)', async () => {
    expect(await statut('/api/session', 'POST', { 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(await statut('/api/session', 'POST', { 'sec-fetch-site': 'same-site' })).toBe(403);
    expect(await statut('/api/session', 'POST', { 'sec-fetch-site': 'none' })).toBe(403);
  });

  it('refuse un POST /api dont l\'Origin n\'est pas celle de la PWA', async () => {
    expect(await statut('/api/session', 'POST', { origin: 'https://ailleurs.example.org' })).toBe(403);
    expect(await statut('/api/session', 'POST', { origin: 'null' })).toBe(403);
    expect(await statut('/api/session', 'POST', { origin: ORIGINE_PWA, 'sec-fetch-site': 'cross-site' })).toBe(403);
  });

  it('laisse passer la PWA elle-même, et un client sans ces en-têtes', async () => {
    expect(await statut('/api/session', 'POST', { origin: ORIGINE_PWA, 'sec-fetch-site': 'same-origin' })).toBe(401);
    expect(await statut('/api/session', 'POST', {})).toBe(401);
  });

  it('une lecture n\'est pas concernée : GET garde sa réponse ordinaire', async () => {
    expect(await statut('/api/session/moi', 'GET', { 'sec-fetch-site': 'cross-site', origin: 'https://ailleurs.example.org' })).toBe(401);
  });

  it('le webhook Telegram, hors /api, garde son propre contrôle (secret)', async () => {
    expect(await statut('/telegram/webhook', 'POST', { 'sec-fetch-site': 'cross-site', origin: 'https://ailleurs.example.org' })).toBe(204);
  });
});
