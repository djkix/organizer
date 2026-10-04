import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { empreintesScripts, entetesCoquille, entetesPreview, politiqueCsp } from '../scripts/entetes.mjs';

const sha = (s: string): string => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

describe('en-têtes de la coquille', () => {
  it('une empreinte par script en ligne, au caractère près ; rien pour un script externe', () => {
    const html = '<script type="module" src="/_app/a.js"></script><div>\n\t<script>\n\t\tkit.start();\n\t</script></div>';
    expect(empreintesScripts(html)).toEqual([sha('\n\t\tkit.start();\n\t')]);
  });

  it('CSP stricte : rien hors de l\'origine, pas de cadre, pas de style en ligne', () => {
    const csp = politiqueCsp(["'sha256-abc'"]);
    expect(csp).toBe([
      "default-src 'none'", "script-src 'self' 'sha256-abc'", "style-src 'self'", "img-src 'self'", "media-src 'self'",
      "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '));
    expect(csp).not.toContain('unsafe');
  });

  it('micro limité à l\'origine, aucun référent, pas de devinette de type', () => {
    expect(entetesCoquille('<html></html>')).toMatchObject({
      'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('la coquille ne garde aucun attribut style, que la CSP bloquerait', () => {
    const html = readFileSync(fileURLToPath(new URL('../src/app.html', import.meta.url)), 'utf8');
    expect(html).not.toMatch(/\sstyle=/);
  });

  it('sans construction, vite preview ne pose aucun en-tête', () => {
    expect(entetesPreview('/nexiste/pas/index.html')).toEqual({});
  });
});
