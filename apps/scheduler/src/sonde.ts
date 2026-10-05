import { creerFetchSortant, essayerSortie } from '@organizer/shared';

// Sonde d'exploitation : aucun jeton, aucun titre d'événement n'est lu ni affiché.
const [commande, cible] = process.argv.slice(2);
if (commande === 'sortie' && cible) {
  console.log(await essayerSortie(cible, creerFetchSortant()));
} else {
  console.log('Usage : sonde sortie <url>');
  process.exitCode = 1;
}
