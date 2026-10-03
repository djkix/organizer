import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { afterEach, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller.js';
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
