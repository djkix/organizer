import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1.';
const IV = 12;
const ETIQUETTE = 16;

function exigerCle(cle: Buffer): void {
  if (cle.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets.');
}

/**
 * AES-256-GCM, IV de 12 octets aléatoire, étiquette de 16 octets, une seule chaîne `v1.<base64url(iv|étiquette|corps)>`.
 * Le contexte (identifiant du compte) est lié comme donnée authentifiée : un jeton recopié sur un autre compte
 * ne se déchiffre pas. Le déchiffrement échoue sans rien rendre si quoi que ce soit a changé.
 */
export function chiffrer(clair: string, cle: Buffer, contexte: string): string {
  exigerCle(cle);
  const iv = randomBytes(IV);
  const c = createCipheriv('aes-256-gcm', cle, iv);
  c.setAAD(Buffer.from(contexte, 'utf8'));
  const corps = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
  return VERSION + Buffer.concat([iv, c.getAuthTag(), corps]).toString('base64url');
}

export function dechiffrer(chiffre: string, cle: Buffer, contexte: string): string {
  exigerCle(cle);
  if (!chiffre.startsWith(VERSION)) throw new Error('Format de jeton chiffré inconnu.');
  const brut = Buffer.from(chiffre.slice(VERSION.length), 'base64url');
  if (brut.length < IV + ETIQUETTE) throw new Error('Jeton chiffré tronqué.');
  const d = createDecipheriv('aes-256-gcm', cle, brut.subarray(0, IV));
  d.setAAD(Buffer.from(contexte, 'utf8'));
  d.setAuthTag(brut.subarray(IV, IV + ETIQUETTE));
  return Buffer.concat([d.update(brut.subarray(IV + ETIQUETTE)), d.final()]).toString('utf8');
}
