import 'reflect-metadata';
import { createServer } from 'node:http';
import { Module } from '@nestjs/common';
import { DELAI_ENVOI_PRIVE_MAX_MS } from '@organizer/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
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
        body: JSON.stringify({ nom: 'l', motDePasse: 'x' }),
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
