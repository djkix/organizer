import { describe, expect, it } from 'vitest';
import { chatPriveValide } from '../src/telegram/liaison.service.js';

describe('chatPriveValide', () => {
  it('accepte un identifiant de chat privé (positif), refuse groupes et bruit', () => {
    expect(chatPriveValide('123456789')).toBe(true);
    expect(chatPriveValide('-100123456789')).toBe(false);
    expect(chatPriveValide('-5')).toBe(false);
    expect(chatPriveValide('12a')).toBe(false);
    expect(chatPriveValide('')).toBe(false);
    expect(chatPriveValide('1'.repeat(20))).toBe(false);
  });
});
