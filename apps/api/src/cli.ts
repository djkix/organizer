import { creerPrisma, type PrismaClient } from '@organizer/db';
import { cheminConfigure, creerFetchSortant, essayerSortie, exigerVar, FILE_ALERTES, FILE_CLASSEMENT, lireVar, OPTIONS_JOB_ALERTE } from '@organizer/shared';
import { Queue } from 'bullmq';
import { Api } from 'grammy';
import { Redis } from 'ioredis';
import { AuthService } from './auth/auth.service.js';
import { optionsClientTelegram } from './telegram/client.js';
import { chatPriveValide, LiaisonService } from './telegram/liaison.service.js';
import { formaterMesures, mesurer } from './veille/mesures.js';
import { etatWebhook, poserWebhook, retirerWebhook } from './telegram/webhook.js';

/** Lit une ligne sans l'afficher : la sortie de readline est coupée pendant la frappe. */
async function saisirMasque(invite: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const { Writable } = await import('node:stream');
  let muet = false;
  const sortie = new Writable({ write(morceau, _enc, fin) { if (!muet) process.stdout.write(morceau); fin(); } });
  const saisie = createInterface({ input: process.stdin, output: sortie, terminal: process.stdin.isTTY });
  try {
    const reponse = saisie.question(invite);
    muet = true;
    return await reponse;
  } finally {
    muet = false;
    saisie.close();
    process.stdout.write('\n');
  }
}

/** Arguments manquants ou mal formés : la CLI affiche l'usage de la commande. */
class Usage extends Error {}

export function apiTelegram(): Api {
  return new Api(exigerVar('TELEGRAM_BOT_TOKEN'), optionsClientTelegram(lireVar('TELEGRAM_API_ROOT')));
}

/** Ouvre une file BullMQ le temps d'une commande. */
async function avecFile<T>(nom: string, travail: (file: Queue) => Promise<T>): Promise<T> {
  const connexion = new Redis(exigerVar('REDIS_URL'), { maxRetriesPerRequest: null });
  const file = new Queue(nom, { connection: connexion });
  try {
    return await travail(file);
  } finally {
    await file.close();
    connexion.disconnect();
  }
}

interface Commande { usage: string; lancer(args: string[], prisma: PrismaClient): Promise<void> }

// Aucune inscription libre : les comptes se créent ici, par l'administrateur.
const COMMANDES: Record<string, Commande> = {
  'creer-utilisateur': {
    usage: 'creer-utilisateur <nom> [--admin]',
    async lancer([nom, option], prisma) {
      if (!nom) throw new Usage();
      await prisma.utilisateur.create({ data: { nom, admin: option === '--admin' } });
      console.log(`Compte ${nom} créé.`);
    },
  },
  'code-liaison': {
    usage: 'code-liaison <nom>',
    async lancer([nom], prisma) {
      if (!nom) throw new Usage();
      console.log(`Code valable 10 minutes : /start ${await new LiaisonService(prisma).creerCode(nom)}`);
    },
  },
  'lier-chat': {
    usage: 'lier-chat <nom> <chat_id>',
    async lancer([nom, chat], prisma) {
      if (!nom || !chat || !chatPriveValide(chat)) throw new Usage();
      await new LiaisonService(prisma).lierDirectement(nom, BigInt(chat));
      console.log(`Compte ${nom} lié au chat ${chat}.`);
    },
  },
  delier: {
    usage: 'delier <nom>',
    async lancer([nom], prisma) {
      if (!nom) throw new Usage();
      await new LiaisonService(prisma).delier(nom);
      console.log(`Compte ${nom} délié.`);
    },
  },
  'mot-de-passe': {
    usage: 'mot-de-passe <nom>',
    async lancer([nom], prisma) {
      if (!nom) throw new Usage();
      const motDePasse = await saisirMasque('Mot de passe (12 caractères minimum) : ');
      if (motDePasse !== (await saisirMasque('Confirme le mot de passe : '))) throw new Error('Les deux saisies diffèrent.');
      await new AuthService(prisma).definirMotDePasse(nom, motDePasse);
      console.log(`Mot de passe de ${nom} enregistré.`);
    },
  },
  'essai-sortie': {
    usage: 'essai-sortie <url>',
    async lancer([url]) {
      if (!url) throw new Usage();
      console.log(await essayerSortie(url, creerFetchSortant()));
    },
  },
  'telegram-webhook': {
    usage: 'telegram-webhook poser|retirer|etat',
    async lancer([action]) {
      const api = apiTelegram();
      if (action === 'poser') {
        await poserWebhook(api, { url: exigerVar('TELEGRAM_WEBHOOK_URL'), secret: exigerVar('TELEGRAM_WEBHOOK_SECRET') });
        console.log('Webhook posé.');
      } else if (action === 'retirer') {
        await retirerWebhook(api);
        console.log('Webhook retiré. Les messages en attente restent chez Telegram.');
      } else if (action !== 'etat') {
        throw new Usage();
      }
      console.log(await etatWebhook(api));
    },
  },
  veille: {
    usage: 'veille',
    async lancer(_args, prisma) {
      const audioRacine = cheminConfigure('AUDIO_STORAGE_PATH', exigerVar('AUDIO_STORAGE_PATH'));
      console.log(formaterMesures(await avecFile(FILE_CLASSEMENT, (file) => mesurer({ prisma, file, audioRacine }))));
    },
  },
  'alerte-essai': {
    usage: 'alerte-essai',
    async lancer() {
      await avecFile(FILE_ALERTES, (file) => file.add('alerte', { message: 'Essai d\'alerte : la veille joint les administrateurs.' }, OPTIONS_JOB_ALERTE));
      console.log('Alerte d\'essai en file : elle part vers les administrateurs liés.');
    },
  },
};

const [nomCommande, ...args] = process.argv.slice(2);
const commande = nomCommande ? COMMANDES[nomCommande] : undefined;
if (!commande) {
  console.log(`Usage : cli ${Object.values(COMMANDES).map((c) => c.usage).join('\n        cli ')}`);
  process.exitCode = 1;
} else {
  const prisma = creerPrisma();
  try {
    await commande.lancer(args, prisma);
  } catch (err) {
    console.error(err instanceof Usage ? `Usage : cli ${commande.usage}` : (err as Error).message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
