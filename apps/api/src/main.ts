import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { lireConfigApi } from './config.js';
import { configurerApp } from './http.js';

const { port } = lireConfigApi();
const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });
configurerApp(app);
app.enableShutdownHooks();
await app.listen(port);
console.log(`API démarrée sur le port ${port}.`);
