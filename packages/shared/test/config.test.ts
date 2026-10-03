import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exigerVar, lireVar } from '../src/config.js';

describe('lireVar', () => {
  it('lit la variable directe', () => {
    expect(lireVar('CLE', { CLE: 'abc' })).toBe('abc');
  });

  it('préfère le fichier désigné par _FILE, sans retour à la ligne', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'secret');
    writeFileSync(f, 'depuis-fichier\n');
    expect(lireVar('CLE', { CLE: 'direct', CLE_FILE: f })).toBe('depuis-fichier');
  });

  it('traite une chaîne vide comme absente', () => {
    expect(lireVar('CLE', { CLE: '' })).toBeUndefined();
  });

  it('exigerVar nomme la variable manquante', () => {
    expect(() => exigerVar('CLE', {})).toThrow('CLE');
  });
});
