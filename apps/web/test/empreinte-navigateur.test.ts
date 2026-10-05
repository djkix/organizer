import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/lib/empreinte-navigateur.ts', import.meta.url)), 'utf8');

describe('empreinte-navigateur', () => {
  it('ne charge @simplewebauthn/browser que sur demande : import dynamique, jamais statique', () => {
    expect(SOURCE).not.toMatch(/^\s*import[^(]*from\s+'@simplewebauthn\/browser'/m);
    expect(SOURCE).toMatch(/import\('@simplewebauthn\/browser'\)/);
  });
});
