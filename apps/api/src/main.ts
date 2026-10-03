import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { lireConfigApi } from './config.js';

const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
app.enableShutdownHooks();
await app.listen(lireConfigApi().port);
console.log(`API démarrée sur le port ${lireConfigApi().port}.`);
