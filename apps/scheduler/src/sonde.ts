import { creerPrisma } from '@organizer/db';
import { creerFetchSortant, essayerSortie } from '@organizer/shared';

// Sonde d'exploitation : aucun jeton, aucun titre d'événement n'est lu ni affiché.
const [commande, cible] = process.argv.slice(2);
if (commande === 'sortie' && cible) {
  console.log(await essayerSortie(cible, creerFetchSortant()));
} else if (commande === 'agenda') {
  const prisma = creerPrisma();
  const comptes = await prisma.agendaGoogle.findMany({ include: { utilisateur: { select: { nom: true } } } });
  if (comptes.length === 0) console.log('Aucun compte relié à Google Agenda.');
  for (const a of comptes) {
    const n = await prisma.action.count({ where: { evenementId: { not: null }, item: { capture: { utilisateurId: a.utilisateurId } } } });
    console.log(`${a.utilisateur.nom} : ${a.etat}${a.erreur ? ` (${a.erreur})` : ''}, ${n} événement(s), jeton ${a.jetonChiffre ? 'présent' : 'absent'}, rafraîchi ${a.rafraichiLe?.toISOString() ?? 'jamais'}`);
  }
  await prisma.$disconnect();
} else {
  console.log('Usage : sonde sortie <url> | sonde agenda');
  process.exitCode = 1;
}
