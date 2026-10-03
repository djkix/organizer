import { readFileSync } from 'node:fs';

/** Lit X, ou le contenu du fichier désigné par X_FILE (secrets Docker). */
export function lireVar(nom: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fichier = env[`${nom}_FILE`];
  if (fichier) return readFileSync(fichier, 'utf8').trim();
  const valeur = env[nom];
  return valeur === '' ? undefined : valeur;
}

export function exigerVar(nom: string, env: NodeJS.ProcessEnv = process.env): string {
  const valeur = lireVar(nom, env);
  if (!valeur) throw new Error(`Variable manquante : ${nom} (ou ${nom}_FILE)`);
  return valeur;
}
