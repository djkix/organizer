import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { agentSortant, creerFetchSortant, essayerSortie, proxySortant } from '../src/sortie.js';

/** Proxy local qui note chaque CONNECT et le refuse, comme Squid pour un domaine hors liste. */
async function proxyQuiRefuse(): Promise<{ url: string; connects: string[]; fermer(): Promise<void> }> {
  const connects: string[] = [];
  const s = createServer((_req, res) => { res.statusCode = 403; res.end(); });
  s.on('connect', (req, socket) => {
    connects.push(req.url ?? '');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`,
    connects,
    fermer: () => new Promise((r) => s.close(() => r())),
  };
}

describe('sortie par le proxy', () => {
  it('sans HTTPS_PROXY, aucun proxy', () => {
    expect(proxySortant({})).toBeUndefined();
    expect(agentSortant({})).toBeUndefined();
  });

  it('fetch passe par le proxy déclaré : le domaine demandé lui est présenté', async () => {
    const p = await proxyQuiRefuse();
    try {
      const f = creerFetchSortant({ HTTPS_PROXY: p.url, NO_PROXY: '' });
      await expect(f('https://domaine-interdit.invalid/')).rejects.toThrow();
      expect(p.connects).toEqual(['domaine-interdit.invalid:443']);
    } finally {
      await p.fermer();
    }
  });

  it('essayerSortie dit « refusé » sans lever quand le proxy refuse', async () => {
    const p = await proxyQuiRefuse();
    try {
      expect(await essayerSortie('https://domaine-interdit.invalid/', creerFetchSortant({ HTTPS_PROXY: p.url }))).toMatch(/^refusé \(/);
    } finally {
      await p.fermer();
    }
  });

  it('NO_PROXY : une adresse locale est jointe directement, et essayerSortie la dit joignable', async () => {
    const p = await proxyQuiRefuse();
    const cible = createServer((_req, res) => { res.statusCode = 204; res.end(); });
    await new Promise<void>((r) => cible.listen(0, '127.0.0.1', r));
    try {
      const f = creerFetchSortant({ HTTPS_PROXY: p.url, NO_PROXY: '127.0.0.1' });
      const url = `http://127.0.0.1:${(cible.address() as AddressInfo).port}/`;
      expect(await essayerSortie(url, f)).toBe('joignable (HTTP 204)');
      expect(p.connects).toEqual([]);
    } finally {
      await p.fermer();
      await new Promise<void>((r) => cible.close(() => r()));
    }
  });
});
