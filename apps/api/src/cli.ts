import { creerPrisma } from '@organizer/db';
import { AuthService } from './auth/auth.service.js';
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
  } else if (commande === 'delier' && nom) {
    await new LiaisonService(prisma).delier(nom);
    console.log(`Compte ${nom} délié.`);
  } else if (commande === 'mot-de-passe' && nom) {
    const { createInterface } = await import('node:readline/promises');
    const saisie = createInterface({ input: process.stdin, output: process.stdout });
    const motDePasse = await saisie.question('Mot de passe (12 caractères minimum) : ');
    saisie.close();
    await new AuthService(prisma).definirMotDePasse(nom, motDePasse);
    console.log(`Mot de passe de ${nom} enregistré.`);
  } else {
    console.log('Usage : cli creer-utilisateur <nom> [--admin] | cli code-liaison <nom> | cli delier <nom> | cli mot-de-passe <nom>');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
