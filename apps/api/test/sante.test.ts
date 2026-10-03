import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { afterAll, describe, expect, it } from 'vitest';
import { PRISMA, REDIS } from '../src/jetons.js';
import { SanteController } from '../src/sante.controller.js';
import { demarrerAppTest } from './aides-http.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

async function monter(redis: { ping(): Promise<string> }) {
  class M {}
  Module({ controllers: [SanteController], providers: [{ provide: PRISMA, useValue: prisma }, { provide: REDIS, useValue: redis }] })(M);
  return demarrerAppTest(M);
}

describe('GET /api/sante', () => {
  it('200 quand base et file répondent, avec l\'adresse vue par l\'API, jamais en cache', async () => {
    const app = await monter({ ping: async () => 'PONG' });
    try {
      const r = await fetch(`${app.url}/api/sante`);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(await r.json()).toEqual({ ok: true, vu: expect.stringMatching(/127\.0\.0\.1$/) });
    } finally {
      await app.fermer();
    }
  });

  it('503 quand la file ne répond pas', async () => {
    const app = await monter({ ping: async () => { throw new Error('valkey arrêté'); } });
    try {
      const r = await fetch(`${app.url}/api/sante`);
      expect(r.status).toBe(503);
      expect((await r.json()).ok).toBe(false);
    } finally {
      await app.fermer();
    }
  });
});
