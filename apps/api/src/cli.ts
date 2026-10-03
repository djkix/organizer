import { creerPrisma } from '@organizer/db';
import { LiaisonService } from './telegram/liaison.service.js';

// Aucune inscription libre : les comptes se créent ici, par l'administrateur.
const [commande, nom] = process.argv.slice(2);
const prisma = creerPrisma();
try {
  if (commande === 'creer-utilisateur' && nom) {
    await prisma.utilisateur.create({ data: { nom, admin: process.argv.includes('--admin') } });
    console.log(`Compte ${nom} créé.`);
  } else if (commande === 'code-liaison' && nom) {
    console.log(`Code valable 10 minutes : /start ${await new LiaisonService(prisma).creerCode(nom)}`);
  } else {
    console.log('Usage : cli creer-utilisateur <nom> [--admin] | cli code-liaison <nom>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
