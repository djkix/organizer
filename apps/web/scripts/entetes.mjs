import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INDEX = fileURLToPath(new URL('../build/index.html', import.meta.url));

/**
 * Empreintes CSP des scripts en ligne d'une page. La coquille SvelteKit en a un, qui change à chaque build.
 * @param {string} html
 * @returns {string[]}
 */
export function empreintesScripts(html) {
  /** @type {string[]} */
  const empreintes = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    empreintes.push(`'sha256-${createHash('sha256').update(m[1] ?? '', 'utf8').digest('base64')}'`);
  }
  return empreintes;
}

/**
 * CSP stricte : rien hors de l'origine, aucun style ni script en ligne hors empreinte, aucun cadre.
 * @param {string[]} empreintes
 * @returns {string}
 */
export function politiqueCsp(empreintes) {
  return [
    "default-src 'none'",
    `script-src 'self' ${empreintes.join(' ')}`.trim(),
    "style-src 'self'",
    "img-src 'self'",
    "media-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * En-têtes de la coquille, communs à Caddy (production) et à vite preview (tests e2e).
 * @param {string} html
 * @returns {Record<string, string>}
 */
export function entetesCoquille(html) {
  return {
    'Content-Security-Policy': politiqueCsp(empreintesScripts(html)),
    'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}

/**
 * En-têtes de vite preview : ceux de la dernière construction ; aucun si elle n'existe pas encore.
 * @param {string} [index]
 * @returns {Record<string, string>}
 */
export function entetesPreview(index = INDEX) {
  return existsSync(index) ? entetesCoquille(readFileSync(index, 'utf8')) : {};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [commande, fichier] = process.argv.slice(2);
  const html = readFileSync(fichier ?? INDEX, 'utf8');
  if (commande === 'caddy') {
    console.log(`header Content-Security-Policy "${politiqueCsp(empreintesScripts(html))}"`);
  } else if (commande === 'empreintes') {
    console.log(empreintesScripts(html).join('\n'));
  } else {
    console.error('Usage : entetes.mjs caddy|empreintes [index.html]');
    process.exit(1);
  }
}
