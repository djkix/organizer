import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { DelaiDepasse, MagasinDefisValkey } from '../src/auth/empreintes/defis.js';

const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
afterAll(() => { redis.disconnect(); });
const magasin = new MagasinDefisValkey(redis);

describe('MagasinDefisValkey', () => {
  it('un défi se lit une seule fois, et expire en 2 minutes', async () => {
    const defi = `essai-${randomUUID()}`;
    await magasin.poser('connexion', defi, 'x');
    const reste = await redis.pttl(`organizer:defi:connexion:${defi}`);
    expect(reste).toBeGreaterThan(110_000);
    expect(reste).toBeLessThanOrEqual(120_000);
    expect(await magasin.prendre('connexion', defi)).toBe('x');
    expect(await magasin.prendre('connexion', defi)).toBeNull();
  });

  it('un défi d\'inscription ne sert pas à la connexion', async () => {
    const defi = `essai-${randomUUID()}`;
    await magasin.poser('inscription', defi, 'compte');
    expect(await magasin.prendre('connexion', defi)).toBeNull();
    expect(await magasin.prendre('inscription', defi)).toBe('compte');
  });

  it('deux lectures simultanées : une seule obtient le défi', async () => {
    const defi = `essai-${randomUUID()}`;
    await magasin.poser('connexion', defi, 'x');
    const lus = await Promise.all([magasin.prendre('connexion', defi), magasin.prendre('connexion', defi)]);
    expect(lus.filter((v) => v === 'x')).toHaveLength(1);
  });

  it('Valkey muet : DelaiDepasse au bout du délai, jamais une attente sans fin', async () => {
    const muet = { set: () => new Promise<never>(() => {}), getdel: () => new Promise<never>(() => {}) };
    const m = new MagasinDefisValkey(muet, 50);
    await expect(m.prendre('connexion', 'x')).rejects.toBeInstanceOf(DelaiDepasse);
    await expect(m.poser('connexion', 'x', 'y')).rejects.toBeInstanceOf(DelaiDepasse);
  });
});
