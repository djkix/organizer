import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { FENETRE_VERROU_MS, MAX_ECHECS_COMPTE, VerrouConnexionMemoire, VerrouConnexionValkey, type VerrouConnexion } from '../src/auth/verrou.js';

const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
afterAll(() => { redis.disconnect(); });

async function echouer(v: VerrouConnexion, nom: string, fois: number): Promise<void> {
  for (let i = 0; i < fois; i++) await v.echec(nom);
}

describe('VerrouConnexionMemoire', () => {
  it('verrouille un compte au dixième échec, lui seul, jusqu\'à la fin de la fenêtre', async () => {
    let t = 0;
    const v = new VerrouConnexionMemoire(() => t);
    await echouer(v, 'l', MAX_ECHECS_COMPTE - 1);
    expect(await v.bloque('l')).toBe(false);
    await v.echec('l');
    expect(await v.bloque('l')).toBe(true);
    expect(await v.bloque('a')).toBe(false);
    t = FENETRE_VERROU_MS;
    expect(await v.bloque('l')).toBe(false);
  });

  it('une connexion réussie remet le compteur à zéro', async () => {
    const v = new VerrouConnexionMemoire(() => 0);
    await echouer(v, 'l', MAX_ECHECS_COMPTE - 1);
    await v.reussite('l');
    await v.echec('l');
    expect(await v.bloque('l')).toBe(false);
  });
});

describe('VerrouConnexionValkey', () => {
  it('compte les échecs par compte, avec une expiration posée au premier', async () => {
    const v = new VerrouConnexionValkey(redis);
    const nom = `essai-${randomUUID()}`;
    await echouer(v, nom, MAX_ECHECS_COMPTE);
    expect(await v.bloque(nom)).toBe(true);
    expect(await v.bloque(`${nom}-autre`)).toBe(false);
    const cles = await redis.keys('organizer:echecs-connexion:*');
    expect(cles.some((c) => c.includes(nom))).toBe(false);
    const reste = Math.max(...await Promise.all(cles.map((c) => redis.pttl(c))));
    expect(reste).toBeGreaterThan(FENETRE_VERROU_MS - 10_000);
    expect(reste).toBeLessThanOrEqual(FENETRE_VERROU_MS);
    await v.reussite(nom);
    expect(await v.bloque(nom)).toBe(false);
  });

  it('Valkey muet : rien n\'est bloqué, une ligne de journal sans le nom', async () => {
    const journal: string[] = [];
    const muet = { get: () => new Promise<never>(() => {}), del: () => new Promise<never>(() => {}), eval: () => new Promise<never>(() => {}) };
    const v = new VerrouConnexionValkey(muet, 50, (m) => journal.push(m));
    await v.echec('l');
    expect(await v.bloque('l')).toBe(false);
    await v.reussite('l');
    expect(journal).toEqual(Array(3).fill('Verrou de connexion indisponible (DelaiDepasse)'));
  });
});
