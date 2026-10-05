import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entetesCoquille } from '../../apps/web/scripts/entetes.mjs';
import { DELAI_ENVOI_PRIVE_MAX_MS, TAILLE_MAX_CAPTURE_PRIVEE } from '../../packages/shared/src/api.js';

const DEPOT = join(import.meta.dirname, '../..');
const lire = (f: string): string => readFileSync(join(DEPOT, f), 'utf8');

const OCTETS: Record<string, number> = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 };
const octets = (v: string): number => {
  const m = /^(\d+)(KiB|MiB|GiB)$/.exec(v);
  if (!m) throw new Error(`taille illisible : ${v}`);
  return Number(m[1]) * OCTETS[m[2]!]!;
};
const DUREES: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 };
const duree = (v: string): number => {
  const m = /^(\d+)(s|m|h)$/.exec(v);
  if (!m) throw new Error(`durée illisible : ${v}`);
  return Number(m[1]) * DUREES[m[2]!]!;
};

describe('.dockerignore', () => {
  it('n\'envoie au build ni secret, ni donnée de L, ni dépendance locale', () => {
    const lignes = lire('.dockerignore').split('\n').map((l) => l.trim());
    for (const motif of [
      '.env', '.env.*', '**/.env', '*.pem', '*.key', 'infra/secrets', 'corpus', 'data', 'audio', 'transcriptions',
      '**/*.ogg', '**/*.oga', '**/*.opus', '**/*.m4a', '**/node_modules', '.git', '.superpowers', '**/dist', '**/build', '**/.svelte-kit',
    ]) expect(lignes, motif).toContain(motif);
  });
});

describe('Dockerfile', () => {
  const d = lire('infra/image/Dockerfile');
  const cible = (nom: string): string => {
    const bloc = d.split(/^FROM /m).find((b) => new RegExp(`\\sAS ${nom}\\s*$`).test(b.split('\n')[0]!));
    if (!bloc) throw new Error(`cible absente : ${nom}`);
    return bloc;
  };

  it('images de base épinglées au mineur, jamais latest', () => {
    const bases = [...d.matchAll(/^ARG \w+_IMAGE=(\S+)$/gm)].map((m) => m[1]!);
    expect(bases.length).toBe(3);
    for (const b of bases) expect(b).toMatch(/:\d+\.\d+/);
    expect(d).not.toMatch(/:latest\b/);
  });

  it('cinq cibles, aucune en root', () => {
    for (const nom of ['api', 'worker', 'scheduler', 'web']) expect(cible(nom), nom).toMatch(/^USER 1000:1000$/m);
    expect(cible('sortie')).toMatch(/^USER squid$/m);
  });

  it('l\'API embarque ffmpeg ; API et worker embarquent les prompts, en chemin absolu', () => {
    expect(cible('api')).toMatch(/apk add --no-cache ffmpeg/);
    expect(d).toMatch(/^COPY prompts \/app\/prompts$/m);
    expect(d).toMatch(/PROMPTS_DIR=\/app\/prompts/);
  });

  it('api, worker et scheduler finaux sans npm, npx ni corepack (CVE de tar dans npm)', () => {
    for (const nom of ['api', 'worker', 'scheduler']) {
      const c = cible(nom);
      expect(c, nom).toMatch(/^RUN rm -rf \/usr\/local\/lib\/node_modules\/npm \/usr\/local\/lib\/node_modules\/corepack \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx \/usr\/local\/bin\/corepack$/m);
      expect(c, nom).not.toMatch(/^(CMD|ENTRYPOINT).*\b(npm|npx|pnpm|corepack)\b/m);
    }
  });

  it('web, sortie et base Node appliquent les correctifs Alpine avant tout USER ; Caddy 2.11', () => {
    expect(d).toContain('ARG CADDY_IMAGE=caddy:2.11-alpine');
    for (const nom of ['base-node', 'web', 'sortie']) {
      const c = cible(nom);
      const i = c.search(/^RUN .*apk upgrade --no-cache/m);
      expect(i, nom).toBeGreaterThanOrEqual(0);
      const u = c.search(/^USER /m);
      if (u >= 0) expect(i, nom).toBeLessThan(u);
    }
  });

  it('dépendances de production installées avec le même verrou', () => {
    expect(d).toContain('pnpm install --frozen-lockfile --prod --filter @organizer/api...');
    expect(d).toContain('pnpm install --frozen-lockfile --prod --filter @organizer/worker...');
    expect(d).toContain('pnpm install --frozen-lockfile --prod --filter @organizer/scheduler...');
  });
});

describe('Caddyfile', () => {
  const c = lire('infra/caddy/Caddyfile');
  const valeur = (cle: string): string[] => [...c.matchAll(new RegExp(`^\\s*${cle} (\\S+)$`, 'gm'))].map((m) => m[1]!);

  it('corps de 30 Mio au moins sur /api, délais au moins égaux à celui de la PWA', () => {
    expect(Math.max(...valeur('max_size').map(octets))).toBeGreaterThanOrEqual(TAILLE_MAX_CAPTURE_PRIVEE);
    for (const cle of ['read_body', 'write', 'read_timeout', 'write_timeout']) {
      expect(valeur(cle).length, cle).toBeGreaterThan(0);
      for (const v of valeur(cle)) expect(duree(v), cle).toBeGreaterThanOrEqual(DELAI_ENVOI_PRIVE_MAX_MS);
    }
  });

  it('/api jamais en cache', () => {
    expect(c).toContain('header_down Cache-Control "no-store"');
  });

  it('mêmes en-têtes que ceux sous lesquels la PWA est testée', () => {
    const e = entetesCoquille('<html></html>');
    expect(c).toContain(`Permissions-Policy "${e['Permissions-Policy']}"`);
    expect(c).toContain(`Referrer-Policy ${e['Referrer-Policy']}`);
    expect(c).toContain(`X-Content-Type-Options ${e['X-Content-Type-Options']}`);
    expect(c).toContain('import /etc/caddy/csp.caddy');
  });

  it('coquille : repli index.html, immutable pour _app/immutable, no-cache ailleurs, type du manifeste', () => {
    expect(c).toContain('try_files {path} /index.html');
    expect(c).toContain('header @immuable Cache-Control "public, max-age=31536000, immutable"');
    expect(c).toContain('@frais not path /_app/immutable/*');
    expect(c).toContain('header @frais Cache-Control "no-cache"');
    expect(c).toContain('header @manifeste Content-Type "application/manifest+json"');
  });

  it('le webhook n\'est servi que sur le domaine du bot ; X-Forwarded-For cru du seul NPM', () => {
    expect(c).toContain('@bot host {$DOMAINE_BOT}');
    expect(c).toMatch(/handle \/telegram\/\* \{\s*respond 404\s*\}/);
    expect(c).toContain('trusted_proxies static {$NPM_IP}');
  });
});

describe('squid.conf', () => {
  const s = lire('infra/sortie/squid.conf');
  it('ip_brute : motif POSIX (] en tête d\'ensemble) qui attrape les adresses brutes, pas les noms', () => {
    const motif = /^acl ip_brute dstdom_regex -n (\S+)$/m.exec(s)![1]!;
    const brutes = ['1.2.3.4', '149.154.167.220', '[::1]', '::1'];
    const noms = ['api.telegram.org', '1e3.com', 'generativelanguage.googleapis.com'];
    // Même moteur que Squid (regcomp POSIX) quand grep est disponible ; sinon équivalent JS.
    const posix = (x: string): boolean | undefined => {
      const r = spawnSync('grep', ['-Eq', '--', motif], { input: x });
      return r.error ? undefined : r.status === 0;
    };
    const js = (x: string): boolean => /^[\]0-9.:[]+$/.test(x);
    for (const x of brutes) expect(posix(x) ?? js(x), x).toBe(true);
    for (const x of noms) expect(posix(x) ?? js(x), x).toBe(false);
  });
  it('descripteurs de fichiers plafonnés', () => {
    expect(s).toMatch(/^max_filedescriptors 4096$/m);
  });
  it('liste fermée : Telegram pour l\'API, Gemini pour le worker, CONNECT 443 seulement, refus du reste', () => {
    expect(s).toContain('acl depuis_api src 10.201.2.10/32');
    expect(s).toContain('acl depuis_worker src 10.201.2.11/32');
    expect(s).toContain('acl vers_api dstdomain -n api.telegram.org');
    expect(s).toContain('acl vers_worker dstdomain -n generativelanguage.googleapis.com');
    expect(s).toContain('acl depuis_scheduler src 10.201.2.12/32');
    expect(s).toContain('acl vers_scheduler dstdomain -n www.googleapis.com oauth2.googleapis.com');
    expect(s).toContain('acl ip_brute dstdom_regex -n ^[]0-9.:[]+$');
    const regles = s.split('\n').filter((l) => l.startsWith('http_access'));
    expect(regles).toEqual([
      'http_access deny !CONNECT',
      'http_access deny !port_https',
      'http_access deny ip_brute',
      'http_access allow depuis_api vers_api',
      'http_access allow depuis_worker vers_worker',
      'http_access allow depuis_scheduler vers_scheduler',
      'http_access deny all',
    ]);
  });

  it('journal sans chemin d\'URL : le jeton du bot ne peut pas y figurer', () => {
    expect(s).toMatch(/^logformat sobre %ts\.%03tu %>a %rm %>rd:%>rP %>Hs %Ss$/m);
    expect(s).toContain('access_log stdio:/dev/stdout sobre');
    expect(s).not.toMatch(/%ru|%>ru|%rp|%>rp|%rv/);
  });
});

describe('docker-compose.yml', () => {
  it('NPM_IP obligatoire, avec message', () => {
    const c = lire('infra/docker-compose.yml');
    const usages = [...c.matchAll(/\$\{NPM_IP[^}]*\}/g)].map((m) => m[0]);
    expect(usages.length).toBeGreaterThan(0);
    for (const u of usages) expect(u).toMatch(/^\$\{NPM_IP:\?[^}]+\}$/);
  });
});

describe('ci.yml', () => {
  const y = lire('.github/workflows/ci.yml');

  it('la version de la PWA est passée en argument de build : l\'étiquette en publication, « essai » sinon', () => {
    expect(y).toContain('--build-arg ORGANIZER_VERSION="$VERSION"');
    expect(y).toContain('--build-arg ORGANIZER_VERSION=essai');
    expect(lire('infra/image/Dockerfile')).toMatch(/AS construction\n[^\n]*\nARG ORGANIZER_VERSION=dev\nENV ORGANIZER_VERSION=\$\{ORGANIZER_VERSION\}/);
    expect(lire('infra/docker-compose.yml')).toContain('ORGANIZER_VERSION: ${ORGANIZER_VERSION:?}');
  });
  it('les cinq images sont construites, analysées et publiées', () => {
    const boucles = [...y.matchAll(/for cible in ([a-z ]+); do/g)].map((m) => m[1]);
    expect(boucles).toEqual(['api worker scheduler web sortie', 'api worker scheduler web sortie', 'api worker scheduler web sortie']);
  });
  it('actions tierces épinglées par SHA, délais et concurrence', () => {
    for (const m of y.matchAll(/^\s*- uses: (\S+)/gm)) expect(m[1], m[1]).toMatch(/@[0-9a-f]{40}$/);
    expect(y).toMatch(/^concurrency:/m);
    expect(y).toContain("cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}");
    expect((y.match(/timeout-minutes:/g) ?? []).length).toBe(3);
  });
});
