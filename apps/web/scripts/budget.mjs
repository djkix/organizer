import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** « Poids du bundle front initial : moins de 150 Ko compressé » (cahier, Performance). */
export const BUDGET_OCTETS = 150 * 1024;

/**
 * Somme compressée (gzip -9) de tout le JS et le CSS du client.
 * Majorant du bundle initial : le budget est tenu si l'application entière y tient.
 * @param {string} dossier
 * @returns {Promise<number>}
 */
export async function mesurer(dossier) {
  let total = 0;
  for (const e of await readdir(dossier, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !/\.(js|css)$/.test(e.name)) continue;
    total += gzipSync(await readFile(join(e.parentPath, e.name)), { level: 9 }).length;
  }
  return total;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const total = await mesurer(fileURLToPath(new URL('../build/_app/immutable/', import.meta.url)));
  console.log(`Bundle client : ${(total / 1024).toFixed(1)} Ko compressés, budget ${BUDGET_OCTETS / 1024} Ko`);
  if (total > BUDGET_OCTETS) process.exit(1);
}
