import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Api } from 'grammy';
import { expect, it } from 'vitest';
import { optionsClientTelegram } from '../src/telegram/client.js';

it('grammY passe par le proxy sortant : seul api.telegram.org lui est demandé', async () => {
  const connects: string[] = [];
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    connects.push(req.url ?? '');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const api = new Api('0:faux', optionsClientTelegram(undefined, { HTTPS_PROXY: url }));
    await expect(api.getMe()).rejects.toThrow();
    expect(connects).toEqual(['api.telegram.org:443']);
  } finally {
    await new Promise<void>((r) => proxy.close(() => r()));
  }
});

it('sans proxy ni racine, grammY garde ses réglages par défaut', () => {
  expect(optionsClientTelegram(undefined, {})).toEqual({});
});
