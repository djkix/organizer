// Empaquetage d'une application Node du dépôt (API, worker) avec esbuild.
// Le code des paquets @organizer/* (sources TypeScript, avec décorateurs) est inclus ;
// toute dépendance de node_modules reste externe et s'installe dans l'image par pnpm --prod.
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** @type {import('esbuild').Plugin} */
const dependancesExternes = {
  name: 'dependances-externes',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (a) => (a.path.startsWith('@organizer/') ? undefined : { path: a.path, external: true }));
  },
};

/**
 * @param {string} dossierApp dossier de l'application (contient package.json, tsconfig.json, src/)
 * @param {string[]} entrees chemins relatifs, ex. ['src/main.ts', 'src/cli.ts']
 * @param {string} [sortie]
 */
export async function empaqueter(dossierApp, entrees, sortie = join(dossierApp, 'dist')) {
  return build({
    absWorkingDir: dossierApp,
    entryPoints: entrees,
    outdir: sortie,
    outbase: 'src',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'linked',
    metafile: true,
    logLevel: 'warning',
    tsconfig: join(dossierApp, 'tsconfig.json'),
    plugins: [dependancesExternes],
  });
}

/**
 * Paquets npm importés à l'exécution par le code empaqueté (modules de Node exclus).
 * @param {import('esbuild').Metafile} metafile
 * @returns {string[]}
 */
export function importsExternes(metafile) {
  const noms = new Set();
  for (const sortie of Object.values(metafile.outputs)) {
    for (const i of sortie.imports) {
      if (!i.external || i.path.startsWith('node:') || builtinModules.includes(i.path)) continue;
      const morceaux = i.path.split('/');
      noms.add(i.path.startsWith('@') ? morceaux.slice(0, 2).join('/') : morceaux[0]);
    }
  }
  return [...noms].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await empaqueter(process.cwd(), process.argv.slice(2));
}
