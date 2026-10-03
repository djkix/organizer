import { describe, expect, it } from 'vitest';
import tokens from '../../../design/tokens.json';

type Theme = typeof tokens.color.light;
type Token = keyof Theme;

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(n >> 16) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (clair + 0.05) / (sombre + 0.05);
}

/** Paires texte / fond réellement employées par les écrans (WCAG AA : 4,5). */
const TEXTES: [Token, Token][] = [
  ['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'],
  ['text', 'privateSoft'], ['muted', 'privateSoft'], ['text', 'accentSoft'],
  ['accent', 'surface'], ['accent', 'bg'],
  ['bg', 'accent'], // bouton principal
  ['bg', 'private'], // écran d'enregistrement privé, bouton violet
  ['bg', 'text'], // bandeau « Fait. »
];
/** Icônes et bords de commandes (WCAG 1.4.11 : 3). */
const ICONES: [Token, Token][] = [
  ['accent', 'accentSoft'], ['private', 'privateSoft'], ['private', 'bg'], ['alarm', 'surface'], ['muted', 'surface'],
];

describe.each(['light', 'dark'] as const)('contrastes du thème %s', (theme) => {
  const c: Theme = tokens.color[theme];
  it.each(TEXTES)('texte %s sur %s : 4,5 au moins', (avant, fond) => {
    expect(contraste(c[avant], c[fond])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(ICONES)('icône %s sur %s : 3 au moins', (avant, fond) => {
    expect(contraste(c[avant], c[fond])).toBeGreaterThanOrEqual(3);
  });
});
