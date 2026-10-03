import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { creerPrisma, type PrismaClient } from '@organizer/db';
import { FILE_CLASSEMENT, type JobClassement } from '@organizer/shared';
import { Queue, type Worker } from 'bullmq';
import type { Bot } from 'grammy';
import { Redis } from 'ioredis';
import { demarrerAlertes } from './alertes.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { lireConfigApi, type ConfigApi } from './config.js';
import { FileClassementBullmq } from './ingestion/file.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { StockageAudio } from './ingestion/stockage.js';
import { AUTH, BOT, CONFIG, INGESTION, ITEMS, PRISMA, PRIVEES, REDIS, VUES } from './jetons.js';
import { ItemsController } from './items/items.controller.js';
import { ItemsService } from './items/items.service.js';
import { PriveesController } from './privees/privees.controller.js';
import { CapturesPriveesService } from './privees/privees.service.js';
import { ReencodeurFfmpeg } from './privees/reencodeur.js';
import { creerBot } from './telegram/bot.js';
import { LiaisonService } from './telegram/liaison.service.js';
import { TelegramController } from './telegram/telegram.controller.js';
import { VuesController } from './vues/vues.controller.js';
import { VuesService } from './vues/vues.service.js';

class Cycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private minuterie?: NodeJS.Timeout;
  private alertes?: Worker;

  constructor(
    @Inject(CONFIG) private readonly config: ConfigApi,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(INGESTION) private readonly ingestion: IngestionService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.bot.init();
    if (this.config.telegramMode === 'polling') {
      await this.bot.api.deleteWebhook({ drop_pending_updates: false });
      // Le polling tourne en tâche de fond : s'il meurt (jeton refusé, conflit), l'API s'arrête, délibérément.
      this.bot.start().catch((err: unknown) => {
        console.error(`Bot Telegram arrêté : ${(err as Error).name}`);
        process.exit(1);
      });
    }
    this.alertes = demarrerAlertes(this.redis, this.prisma, this.bot);
    this.minuterie = setInterval(() => {
      this.ingestion.reprendre().catch((err: unknown) => {
        console.error(`Reprise des captures en échec (${(err as Error).name})`);
      });
    }, 5 * 60_000);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.minuterie);
    if (this.config.telegramMode === 'polling') await this.bot.stop();
    await this.alertes?.close();
    await this.prisma.$disconnect();
    this.redis.disconnect();
  }
}

@Module({
  controllers: [TelegramController, AuthController, VuesController, ItemsController, PriveesController],
  providers: [
    { provide: CONFIG, useFactory: lireConfigApi },
    { provide: PRISMA, useFactory: () => creerPrisma() },
    { provide: REDIS, inject: [CONFIG], useFactory: (c: ConfigApi) => new Redis(c.redisUrl, { maxRetriesPerRequest: null }) },
    {
      provide: INGESTION,
      inject: [CONFIG, PRISMA, REDIS],
      useFactory: (c: ConfigApi, prisma: PrismaClient, redis: Redis) => {
        const file = new FileClassementBullmq(new Queue<JobClassement>(FILE_CLASSEMENT, { connection: redis }));
        // Le bot n'existe pas encore ici : le téléchargeur passe par l'API HTTP de Telegram.
        const telechargeur = {
          async telecharger(fichierId: string) {
            const base = `https://api.telegram.org`;
            const r = await fetch(`${base}/bot${c.telegramToken}/getFile?file_id=${encodeURIComponent(fichierId)}`);
            const j = (await r.json()) as { ok: boolean; result?: { file_path?: string } };
            const chemin = j.result?.file_path;
            if (!j.ok || !chemin) throw new Error('Telegram getFile en échec');
            const f = await fetch(`${base}/file/bot${c.telegramToken}/${chemin}`);
            if (!f.ok) throw new Error(`Téléchargement Telegram : HTTP ${f.status}`);
            return { donnees: Buffer.from(await f.arrayBuffer()), extension: chemin.split('.').pop() ?? 'bin' };
          },
        };
        return new IngestionService(prisma, new StockageAudio(c.audioRacine), telechargeur, file);
      },
    },
    {
      provide: BOT,
      inject: [CONFIG, PRISMA, INGESTION],
      useFactory: (c: ConfigApi, prisma: PrismaClient, ingestion: IngestionService) =>
        creerBot(c.telegramToken, { liaison: new LiaisonService(prisma), ingestion }),
    },
    { provide: AUTH, inject: [PRISMA], useFactory: (prisma: PrismaClient) => new AuthService(prisma) },
    { provide: VUES, inject: [PRISMA], useFactory: (prisma: PrismaClient) => new VuesService(prisma) },
    { provide: ITEMS, inject: [CONFIG, PRISMA], useFactory: (c: ConfigApi, prisma: PrismaClient) => new ItemsService(prisma, c.typesEcheance) },
    { provide: PRIVEES, inject: [CONFIG, PRISMA], useFactory: (c: ConfigApi, prisma: PrismaClient) => new CapturesPriveesService(prisma, new StockageAudio(c.audioRacine), new ReencodeurFfmpeg()) },
    SessionGuard,
    Cycle,
  ],
})
export class AppModule {}
