import { creerFetchSortant, essayerSortie } from '@organizer/shared';
import { formaterDiagnostic } from './classement/gemini.js';
import { lireConfigWorker } from './configuration.js';

// Sonde d'exploitation : aucun contenu de capture n'est envoyé ni affiché.
const [commande, cible] = process.argv.slice(2);
if (commande === 'sortie' && cible) {
  console.log(await essayerSortie(cible, creerFetchSortant()));
} else if (commande === 'palier') {
  const d = await lireConfigWorker().provider.diagnostiquer();
  console.log(formaterDiagnostic(d));
  process.exitCode = d.paye ? 0 : 1;
} else {
  console.log('Usage : sonde palier | sonde sortie <url>');
  process.exitCode = 1;
}
