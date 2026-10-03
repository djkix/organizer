// Génère les PNG du manifeste depuis les SVG de static/. Reproductible : relancer après toute retouche d'un SVG.
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const STATIC = new URL('../static/', import.meta.url);
const SORTIE = new URL('icones/', STATIC);

/** @type {[string, string, number][]} source, cible, côté en pixels */
const CIBLES = [
  ['icone.svg', 'pwa-192.png', 192],
  ['icone.svg', 'pwa-512.png', 512],
  ['icone-maskable.svg', 'maskable-512.png', 512],
  ['raccourci-prive.svg', 'raccourci-prive-96.png', 96],
  ['raccourci-aujourdhui.svg', 'raccourci-aujourdhui-96.png', 96],
];

await mkdir(SORTIE, { recursive: true });
for (const [source, cible, cote] of CIBLES) {
  // fileURLToPath : le chemin du dépôt contient des espaces.
  await sharp(fileURLToPath(new URL(source, STATIC)), { density: 384 })
    .resize(cote, cote)
    .png({ compressionLevel: 9 })
    .toFile(fileURLToPath(new URL(cible, SORTIE)));
}
console.log(`${CIBLES.length} icônes écrites dans static/icones/`);
