import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { creerPrisma, type PrismaClient } from '@organizer/db';
import { creerFetchSortant, FILE_ALERTES, FILE_CLASSEMENT, OPTIONS_JOB_ALERTE, type JobAlerte, type JobClassement } from '@organizer/shared';
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
import { TelechargeurTelegram } from './ingestion/telechargeur.js';
import { AUTH, BOT, CONFIG, INGESTION, ITEMS, PRISMA, PRIVEES, REDIS, VUES } from './jetons.js';
import { ItemsController } from './items/items.controller.js';
import { ItemsService } from './items/items.service.js';
import { PriveesController } from './privees/privees.controller.js';
import { CapturesPriveesService } from './privees/privees.service.js';
import { ReencodeurBorne, ReencodeurFfmpeg } from './privees/reencodeur.js';
import { SanteController } from './sante.controller.js';
import { creerBot } from './telegram/bot.js';
import { demarrerTelegram, dormir } from './telegram/demarrage.js';
import { optionsClientTelegram } from './telegram/client.js';
import { LiaisonService } from './telegram/liaison.service.js';
import { TelegramController } from './telegram/telegram.controller.js';
import { VuesController } from './vues/vues.controller.js';
import { VuesService } from './vues/vues.service.js';
import { mesurer } from './veille/mesures.js';
import { Veille } from './veille/veille.js';

class Cycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private minuterie?: NodeJS.Timeout;
  private purge?: NodeJS.Timeout;
  private veille?: NodeJS.Timeout;
  private files: Queue[] = [];
  private alertes?: Worker;
  private readonly arret = new AbortController();

  constructor(
    @Inject(CONFIG) private readonly config: ConfigApi,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(BOT) private readonly bot: Bot,
    @Inject(INGESTION) private readonly ingestion: IngestionService,
    @Inject(AUTH) private readonly auth: AuthService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Jamais attendu : l'API sert la PWA et /health même si Telegram est injoignable.
    void demarrerTelegram({
      bot: this.bot, mode: this.config.telegramMode, attendre: dormir, signal: this.arret.signal,
      journal: (m) => console.error(m), quitter: (code) => process.exit(code),
    }).catch((err: unknown) => {
      console.error(`Démarrage de Telegram en échec : ${(err as Error).name}`);
      if (this.config.telegramMode === 'polling') process.exit(1);
    });
    this.alertes = demarrerAlertes(this.redis, this.prisma, this.bot);
    this.minuterie = setInterval(() => {
      this.ingestion.reprendre().catch((err: unknown) => {
        console.error(`Reprise des captures en échec (${(err as Error).name})`);
      });
    }, 5 * 60_000);
    const purger = (): void => {
      Promise.all([this.auth.purgerExpirees(), new LiaisonService(this.prisma).purgerCodesExpires()]).catch((err: unknown) => {
        console.error(`Purge des sessions en échec (${(err as Error).name})`);
      });
    };
    purger();
    this.purge = setInterval(purger, 6 * 3600_000);
    const classement = new Queue(FILE_CLASSEMENT, { connection: this.redis });
    const alertes = new Queue<JobAlerte>(FILE_ALERTES, { connection: this.redis });
    this.files = [classement, alertes];
    const veille = new Veille(
      () => mesurer({ prisma: this.prisma, file: classement, audioRacine: this.config.audioRacine }),
      async (message) => { await alertes.add('alerte', { message }, OPTIONS_JOB_ALERTE); },
    );
    this.veille = setInterval(() => {
      veille.passer().catch((err: unknown) => console.error(`Veille en échec (${(err as Error).name})`));
    }, 15 * 60_000);
  }

  async onApplicationShutdown(): Promise<void> {
    this.arret.abort();
    clearInterval(this.minuterie);
    clearInterval(this.purge);
    clearInterval(this.veille);
    await Promise.all(this.files.map((f) => f.close()));
    if (this.config.telegramMode === 'polling' && this.bot.isRunning()) await this.bot.stop();
    await this.alertes?.close();
    await this.prisma.$disconnect();
    this.redis.disconnect();
  }
}

@Module({
  controllers: [TelegramController, AuthController, VuesController, ItemsController, PriveesController, SanteController],
  providers: [
    { provide: CONFIG, useFactory: lireConfigApi },
    { provide: PRISMA, useFactory: () => creerPrisma() },
    { provide: REDIS, inject: [CONFIG], useFactory: (c: ConfigApi) => new Redis(c.redisUrl, { maxRetriesPerRequest: null }) },
    {
      provide: INGESTION,
      inject: [CONFIG, PRISMA, REDIS],
      useFactory: (c: ConfigApi, prisma: PrismaClient, redis: Redis) => {
        const file = new FileClassementBullmq(new Queue<JobClassement>(FILE_CLASSEMENT, { connection: redis }));
        const telechargeur = new TelechargeurTelegram(c.telegramToken, creerFetchSortant(), { apiRoot: c.telegramApiRoot });
        return new IngestionService(prisma, new StockageAudio(c.audioRacine), telechargeur, file);
      },
    },
    {
      provide: BOT,
      inject: [CONFIG, PRISMA, INGESTION],
      useFactory: (c: ConfigApi, prisma: PrismaClient, ingestion: IngestionService) =>
        creerBot(c.telegramToken, { liaison: new LiaisonService(prisma), ingestion }, { client: optionsClientTelegram(c.telegramApiRoot) }),
    },
    { provide: AUTH, inject: [PRISMA], useFactory: (prisma: PrismaClient) => new AuthService(prisma) },
    { provide: VUES, inject: [PRISMA], useFactory: (prisma: PrismaClient) => new VuesService(prisma) },
    { provide: ITEMS, inject: [CONFIG, PRISMA], useFactory: (c: ConfigApi, prisma: PrismaClient) => new ItemsService(prisma, c.typesEcheance) },
    { provide: PRIVEES, inject: [CONFIG, PRISMA], useFactory: (c: ConfigApi, prisma: PrismaClient) => new CapturesPriveesService(prisma, new StockageAudio(c.audioRacine), new ReencodeurBorne(new ReencodeurFfmpeg())) },
    SessionGuard,
    Cycle,
  ],
})
export class AppModule {}
