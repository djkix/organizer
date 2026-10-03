import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configurerApp } from '../src/http.js';

/** Démarre un module Nest sur un port libre, avec la même configuration HTTP que la production. */
export async function demarrerAppTest(module: Type<unknown>): Promise<{ url: string; fermer(): Promise<void> }> {
  const app = await NestFactory.create<NestExpressApplication>(module, { logger: false, bodyParser: false });
  configurerApp(app);
  await app.listen(0, '127.0.0.1');
  const adresse = app.getHttpServer().address() as { port: number };
  return { url: `http://127.0.0.1:${adresse.port}`, fermer: () => app.close() };
}
