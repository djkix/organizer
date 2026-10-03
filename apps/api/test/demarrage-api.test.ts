import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configurerApp } from '../src/http.js';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('l\'API démarre et répond même si Telegram est injoignable', async () => {
  vi.stubEnv('TELEGRAM_MODE', 'webhook');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'secret-essai');
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '0:faux');
  // Port 9 de la boucle locale : connexion refusée, comme un Telegram injoignable.
  vi.stubEnv('TELEGRAM_API_ROOT', 'http://127.0.0.1:9');
  vi.stubEnv('AUDIO_STORAGE_PATH', mkdtempSync(join(tmpdir(), 'audio-')));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configurerApp(app);
  await app.listen(0, '127.0.0.1');
  try {
    const { port } = app.getHttpServer().address() as { port: number };
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
  } finally {
    await app.close();
  }
}, 20_000);
