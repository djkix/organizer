import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Service {
  image: string; user?: string; read_only?: boolean; restart?: string; ports?: string[];
  networks: string[] | Record<string, { ipv4_address?: string } | null>;
  environment?: Record<string, string>; logging?: unknown; healthcheck?: unknown;
  deploy?: { resources?: { limits?: { memory?: string } } };
  depends_on?: Record<string, { condition: string }>;
}
interface Compose { services: Record<string, Service>; networks: Record<string, { internal?: boolean } | null> }

const INFRA = join(import.meta.dirname, '..');
const texte = readFileSync(join(INFRA, 'docker-compose.yml'), 'utf8');
const compose = parse(texte, { merge: true }) as Compose;
const S = compose.services;
const service = (n: string): Service => {
  const s = S[n];
  if (!s) throw new Error(`service absent : ${n}`);
  return s;
};
const reseaux = (s: Service): string[] => (Array.isArray(s.networks) ? [...s.networks] : Object.keys(s.networks)).sort();
const ip = (n: string): string | undefined => (service(n).networks as Record<string, { ipv4_address?: string }>).sortie?.ipv4_address;

describe('stack de production', () => {
  it('services du lot 2-A : migrations, proxy sortant et scheduler', () => {
    expect(Object.keys(S).sort()).toEqual(['api', 'db', 'migrate', 'queue', 'scheduler', 'sortie', 'web', 'worker']);
  });

  it('images épinglées, jamais latest ; les nôtres à la version du .env', () => {
    for (const [n, s] of Object.entries(S)) {
      if (s.image.startsWith('ghcr.io/djkix/organizer-')) expect(s.image, n).toMatch(/:\$\{ORGANIZER_VERSION:\?\}$/);
      else expect(s.image, n).toMatch(/:\d+\.\d+/);
    }
  });

  it('conteneurs applicatifs non root, racine en lecture seule', () => {
    for (const n of ['api', 'worker', 'scheduler', 'migrate', 'web']) {
      expect(service(n).user, n).toBe('1000:1000');
      expect(service(n).read_only, n).toBe(true);
    }
    expect(service('sortie').read_only).toBe(true);
  });

  it('redémarrage, journaux JSON 10 Mo × 3, limites mémoire du cahier', () => {
    const limites: Record<string, string> = { api: '512m', worker: '768m', scheduler: '256m', db: '1g', queue: '128m', web: '64m', sortie: '64m', migrate: '256m' };
    for (const [n, s] of Object.entries(S)) {
      expect(s.restart, n).toBe(n === 'migrate' ? 'no' : 'unless-stopped');
      expect(s.logging, n).toEqual({ driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } });
      expect(s.deploy?.resources?.limits?.memory, n).toBe(limites[n]);
    }
  });

  it('réseaux : seul le proxy sortant atteint Internet ; base et file isolées', () => {
    expect(reseaux(service('db'))).toEqual(['core']);
    expect(reseaux(service('queue'))).toEqual(['core']);
    expect(reseaux(service('migrate'))).toEqual(['core']);
    expect(reseaux(service('api'))).toEqual(['core', 'edge', 'sortie']);
    expect(reseaux(service('worker'))).toEqual(['core', 'sortie']);
    expect(reseaux(service('scheduler'))).toEqual(['core', 'sortie']);
    expect(reseaux(service('web'))).toEqual(['edge', 'publication']);
    expect(reseaux(service('sortie'))).toEqual(['egress', 'sortie']);
    for (const n of ['core', 'edge', 'sortie']) expect(compose.networks[n]?.internal, n).toBe(true);
    for (const n of ['egress', 'publication']) expect(compose.networks[n]?.internal ?? false, n).toBe(false);
  });

  it('un seul port publié, sur l\'adresse de la VM', () => {
    for (const [n, s] of Object.entries(S)) if (n !== 'web') expect(s.ports, n).toBeUndefined();
    expect(service('web').ports).toEqual(['${IP_PUBLICATION:?}:7070:8080']);
  });

  it('API : proxy de confiance obligatoire (Caddy et NPM), webhook en production', () => {
    const env = service('api').environment!;
    expect(env.TRUSTED_PROXY).toMatch(/^10\.201\.1\.0\/24, \$\{NPM_IP:\?[^}]+\}$/);
    expect(env.TELEGRAM_MODE).toBe('webhook');
    expect(env.TELEGRAM_WEBHOOK_URL).toBe('https://${DOMAINE_BOT:?}/telegram/webhook');
  });

  it('API : empreinte liée au domaine de la PWA, origine en https', () => {
    const env = service('api').environment!;
    expect(env.WEBAUTHN_RP_ID).toBe('${DOMAINE_APP:?}');
    expect(env.WEBAUTHN_ORIGIN).toBe('https://${DOMAINE_APP:?}');
  });

  it('API : client OAuth de Google Agenda obligatoire, retour sur le domaine de la PWA, aucun secret', () => {
    const env = service('api').environment!;
    expect(env.GOOGLE_CLIENT_ID).toMatch(/^\$\{GOOGLE_CLIENT_ID:\?[^}]*\}$/);
    expect(env.GOOGLE_REDIRECT_URI).toBe('https://${DOMAINE_APP:?}/api/agenda/retour');
    expect(Object.keys(env).filter((k) => /^GOOGLE_.*(SECRET|KEY)/.test(k))).toEqual([]);
  });

  it('API, worker et scheduler : production, chemins absolus, sortie par le proxy', () => {
    for (const n of ['api', 'worker', 'scheduler']) {
      const env = service(n).environment!;
      expect(env).toMatchObject({
        NODE_ENV: 'production', PROMPTS_DIR: '/app/prompts', AUDIO_STORAGE_PATH: '/data/audio', HTTPS_PROXY: 'http://sortie:3128',
      });
    }
  });

  it('les adresses du réseau sortie sont celles de squid.conf', () => {
    const conf = readFileSync(join(INFRA, 'sortie/squid.conf'), 'utf8');
    expect(conf).toContain(`acl depuis_api src ${ip('api')}/32`);
    expect(conf).toContain(`acl depuis_worker src ${ip('worker')}/32`);
    expect(conf).toContain(`acl depuis_scheduler src ${ip('scheduler')}/32`);
  });

  it('aucun secret en clair : des fichiers, ou une valeur obligatoire du .env', () => {
    for (const s of Object.values(S)) {
      for (const [k, v] of Object.entries(s.environment ?? {})) {
        if (/TOKEN|SECRET|KEY|PASSWORD/.test(k)) expect(k.endsWith('_FILE') || /^\$\{[A-Z_]+:\?\}$/.test(v), k).toBe(true);
      }
    }
  });

  it('migrations jouées avant l\'API et le worker ; sondes de santé sur api, db, queue, web', () => {
    for (const n of ['api', 'worker', 'scheduler']) expect(service(n).depends_on?.migrate?.condition, n).toBe('service_completed_successfully');
    for (const n of ['api', 'db', 'queue', 'web']) expect(service(n).healthcheck, n).toBeDefined();
  });

  it('chaque variable obligatoire du compose est documentée dans infra/.env.example', () => {
    const exemple = readFileSync(join(INFRA, '.env.example'), 'utf8');
    const obligatoires = new Set([...texte.matchAll(/\$\{([A-Z_]+):\?\}/g)].map((m) => m[1]!));
    for (const v of obligatoires) expect(exemple, v).toMatch(new RegExp(`^${v}=`, 'm'));
  });
  it('sondes : l\'API interroge /api/sante (base et file), pas une route inexistante', () => {
    expect(JSON.stringify(service('api').healthcheck)).toContain('http://127.0.0.1:3000/api/sante');
    expect(JSON.stringify(service('web').healthcheck)).toContain('http://127.0.0.1:8080/');
  });

  it('secrets : cinq fichiers du dossier secrets/, montés seulement là où ils servent', () => {
    const secrets = (parse(texte, { merge: true }) as { secrets: Record<string, { file: string }> }).secrets;
    expect(Object.keys(secrets).sort()).toEqual(['agenda_cle', 'gemini_api_key', 'google_client_secret', 'telegram_bot_token', 'telegram_webhook_secret']);
    for (const [n, s] of Object.entries(secrets)) expect(s.file, n).toBe(`./secrets/${n}`);
    const monte = (n: string): unknown => (service(n) as unknown as { secrets?: string[] }).secrets;
    expect(monte('api')).toEqual(['telegram_bot_token', 'telegram_webhook_secret']);
    expect(monte('worker')).toEqual(['gemini_api_key']);
    expect(monte('scheduler')).toEqual(['google_client_secret', 'agenda_cle']);
    for (const n of ['db', 'queue', 'web', 'sortie', 'migrate']) expect(monte(n), n).toBeUndefined();
    expect(service('api').environment).toMatchObject({ TELEGRAM_BOT_TOKEN_FILE: '/run/secrets/telegram_bot_token' });
    expect(service('worker').environment).toMatchObject({ GEMINI_API_KEY_FILE: '/run/secrets/gemini_api_key' });
    expect(service('scheduler').environment).toMatchObject({
      GOOGLE_CLIENT_SECRET_FILE: '/run/secrets/google_client_secret', AGENDA_CLE_FILE: '/run/secrets/agenda_cle',
    });
  });

  it('Google Agenda : même client et même adresse de retour pour l\'API et le scheduler ; aucun volume pour le scheduler', () => {
    for (const n of ['api', 'scheduler']) {
      expect(service(n).environment, n).toMatchObject({
        GOOGLE_CLIENT_ID: '${GOOGLE_CLIENT_ID:?}', GOOGLE_REDIRECT_URI: 'https://${DOMAINE_APP:?}/api/agenda/retour',
      });
    }
    expect((service('scheduler') as unknown as { volumes?: string[] }).volumes).toBeUndefined();
    expect(service('api').environment).not.toHaveProperty('GOOGLE_CLIENT_SECRET_FILE');
  });

  it('tmpfs pour /tmp (applicatifs, sortie, web : Caddy y range son état) ; volumes nommés', () => {
    for (const n of ['api', 'worker', 'scheduler', 'migrate', 'sortie']) expect((service(n) as unknown as { tmpfs: string[] }).tmpfs, n).toContain('/tmp');
    expect((service('web') as unknown as { tmpfs: string[] }).tmpfs).toEqual(['/tmp']);
    const volumes = Object.keys((parse(texte, { merge: true }) as { volumes: object }).volumes).sort();
    expect(volumes).toEqual(['audio', 'pgdata', 'valkeydata']);
    expect((service('worker') as unknown as { volumes: string[] }).volumes).toEqual(['audio:/data/audio:ro']);
  });

  it('worker : réflexion et statuts d\'indisponibilité vides par défaut, documentés', () => {
    expect(texte).toContain('GEMINI_THINKING_LEVEL: ${GEMINI_THINKING_LEVEL:-}');
    expect(texte).toContain('GEMINI_STATUTS_INDISPONIBLES: ${GEMINI_STATUTS_INDISPONIBLES:-}');
    const exemple = readFileSync(join(INFRA, '.env.example'), 'utf8');
    expect(exemple).toMatch(/^GEMINI_THINKING_LEVEL=$/m);
    expect(exemple).toMatch(/^# GEMINI_STATUTS_INDISPONIBLES=402,403,429$/m);
    expect(exemple).toMatch(/Ne jamais y mettre 400/);
  });

  it('CI : Trivy analyse les quatre images avant d\'échouer', () => {
    const ci = readFileSync(join(INFRA, '../.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/--exit-code 1 "[^"]+" \|\| echec=1/);
    expect(ci).toMatch(/exit "\$echec"/);
  });

  it('plus aucun montage de Caddyfile : il est dans l\'image web', () => {
    expect(texte).not.toMatch(/Caddyfile:/);
  });
  it('image : /data/audio existe, propriété de 1000, avant le volume nommé', () => {
    const df = readFileSync(join(INFRA, 'image/Dockerfile'), 'utf8');
    const base = df.slice(df.indexOf('AS base-node'), df.indexOf('AS api'));
    expect(base).toMatch(/mkdir -p \/data\/audio && chown 1000:1000 \/data\/audio/);
  });

  it('CI : packages: write seulement sur le job de publication, étiquettes v* seulement', () => {
    const ci = parse(readFileSync(join(INFRA, '../.github/workflows/ci.yml'), 'utf8')) as {
      permissions: Record<string, string>;
      jobs: Record<string, { needs?: string; if?: string; permissions?: Record<string, string> }>;
    };
    expect(ci.permissions).toEqual({ contents: 'read' });
    for (const [n, j] of Object.entries(ci.jobs)) {
      if (n === 'publication') continue;
      expect(j.permissions?.packages, n).toBeUndefined();
    }
    const pub = ci.jobs.publication!;
    expect(pub.permissions).toEqual({ contents: 'read', packages: 'write' });
    expect(pub.needs).toBe('images');
    expect(pub.if).toBe("startsWith(github.ref, 'refs/tags/v')");
  });

  it('essai.sh : autre plage que la production, diagnostics au démarrage, volume audio, arrêt propre', () => {
    const sh = readFileSync(join(INFRA, 'image/essai.sh'), 'utf8');
    expect(sh).toContain('10.211');
    expect(sh).toContain('dc up -d || echec');
    expect(sh).toContain("trap 'exit 130' INT TERM");
    expect(sh).toContain('/data/audio/.essai');
    expect(sh).toContain('test -r /data/audio');
  });

  it('documentation : paquets GHCR à passer en public après la première publication', () => {
    expect(readFileSync(join(INFRA, '../docs/cahier-des-charges.md'), 'utf8')).toMatch(/passer chaque paquet organizer-\* en public/);
  });
});
