import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tokens from '../../../design/tokens.json';
import { MESSAGES } from '../src/lib/messages.js';

const WEB = fileURLToPath(new URL('..', import.meta.url));

function fichiers(dossier: string, extension: RegExp): string[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && extension.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}

const SOURCES = [
  ...fichiers(join(WEB, 'src'), /\.(svelte|ts|css|html)$/),
  ...fichiers(join(WEB, 'static'), /\.svg$/),
].map((f) => [relative(WEB, f), readFileSync(f, 'utf8')] as const);
const STYLES = SOURCES.filter(([f]) => /\.(svelte|css|html|svg)$/.test(f));
const COULEURS_ADMISES = new Set(
  [...Object.values(tokens.color.light), ...Object.values(tokens.color.dark)].map((c) => c.toLowerCase()),
);
const mots = (s: string): number => s.trim().split(/\s+/).length;

describe('règles produit dans le code de la PWA', () => {
  it('trouve des sources à vérifier', () => {
    expect(SOURCES.length).toBeGreaterThan(3);
  });

  it.each(SOURCES)('%s : aucun emoji ni pictogramme (règle n° 7)', (_f, texte) => {
    expect(texte).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it.each(STYLES)('%s : seulement les couleurs des tokens, aucun rouge, aucune ombre', (_f, texte) => {
    for (const hex of texte.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) expect(COULEURS_ADMISES).toContain(hex.toLowerCase());
    expect(texte).not.toMatch(/\b(red|crimson|tomato|firebrick|darkred|indianred|orangered|salmon)\b/i);
    expect(texte).not.toMatch(/\b(rgba?|hsla?)\(/);
    expect(texte).not.toMatch(/(box|text)-shadow|drop-shadow/);
  });

  it.each(SOURCES)('%s : ni retard, ni félicitation, ni {@html}, ni console.log', (_f, texte) => {
    expect(texte).not.toMatch(/retard|bravo|félicit|bien joué/i);
    expect(texte).not.toContain('{@html');
    expect(texte).not.toContain('console.log');
  });
});

describe('messages', () => {
  it.each(Object.entries(MESSAGES))('%s : moins de 12 mots, ni « ! » ni « % »', (_cle, m) => {
    expect(mots(m)).toBeLessThan(12);
    expect(m).not.toMatch(/[!%]/);
  });

  it('aucun message ne félicite ni ne compte', () => {
    for (const m of Object.values(MESSAGES)) {
      expect(m).not.toMatch(/retard|bravo|félicit|bien joué|super|génial|continue comme|\d+ ?(choses|tâches)/i);
    }
  });
});
