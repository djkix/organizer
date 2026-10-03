import { describe, expect, it } from 'vitest';
import { creerClientApi, ErreurApi, HorsLigne, urlAudio } from '../src/lib/api.js';
import { MESSAGES } from '../src/lib/messages.js';

function fauxFetch(reponses: Array<Response | Error>) {
  const appels: { url: string; init: RequestInit }[] = [];
  const f = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    appels.push({ url: String(url), init });
    const r = reponses.shift();
    if (!r) throw new Error('réponse manquante');
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { f, appels };
}

const vide = (status = 204) => new Response(null, { status });
const entetes = (init: RequestInit) => new Headers(init.headers);

describe('client API', () => {
  it('connecter envoie le corps JSON, sur la même origine', async () => {
    const { f, appels } = fauxFetch([vide()]);
    await creerClientApi({ fetch: f }).connecter({ nom: 'test', motDePasse: 'un mot de passe assez long' });
    expect(appels[0]!.url).toBe('/api/session');
    expect(appels[0]!.init.method).toBe('POST');
    expect(appels[0]!.init.credentials).toBe('same-origin');
    expect(entetes(appels[0]!.init).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(appels[0]!.init.body))).toEqual({ nom: 'test', motDePasse: 'un mot de passe assez long' });
  });

  it('un 401 à la connexion ou sur moi ne déclenche pas le retour à la connexion', async () => {
    let appelee = 0;
    const { f } = fauxFetch([
      Response.json({ message: 'Identifiants invalides.' }, { status: 401 }),
      Response.json({ message: 'Connecte-toi pour continuer.' }, { status: 401 }),
    ]);
    const api = creerClientApi({ fetch: f, surNonConnecte: () => { appelee++; } });
    const e = await api.connecter({ nom: 'test', motDePasse: 'x' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurApi);
    expect((e as ErreurApi).statut).toBe(401);
    expect((e as ErreurApi).message).toBe('Identifiants invalides.');
    await expect(api.moi()).rejects.toBeInstanceOf(ErreurApi);
    expect(appelee).toBe(0);
  });

  it('un 401 sur une vue renvoie vers la connexion', async () => {
    let appelee = 0;
    const { f } = fauxFetch([Response.json({ message: 'Connecte-toi pour continuer.' }, { status: 401 })]);
    const api = creerClientApi({ fetch: f, surNonConnecte: () => { appelee++; } });
    await expect(api.aujourdhui()).rejects.toBeInstanceOf(ErreurApi);
    expect(appelee).toBe(1);
  });

  it('une coupure réseau devient HorsLigne', async () => {
    const { f } = fauxFetch([new TypeError('Failed to fetch')]);
    await expect(creerClientApi({ fetch: f }).semaine()).rejects.toBeInstanceOf(HorsLigne);
  });

  it('un corps d\'erreur illisible donne un message court', async () => {
    const { f } = fauxFetch([new Response('<html>', { status: 502 })]);
    const e = await creerClientApi({ fetch: f }).horizons().catch((x: unknown) => x);
    expect((e as ErreurApi).message).toBe(MESSAGES.serveurIndisponible);
  });

  it('les routes et les méthodes du contrat', async () => {
    const { f, appels } = fauxFetch([vide(), vide(), vide(), Response.json([]), vide(), Response.json({ jour: '2026-10-06', actions: [], suggestions: [] })]);
    const api = creerClientApi({ fetch: f });
    await api.cocher('a1');
    await api.decocher('a1');
    await api.corriger('a1', { nature: 'pensee' });
    await api.privees('2026-10');
    await api.etiqueter('c1', null);
    expect((await api.aujourdhui()).jour).toBe('2026-10-06');
    expect(appels.map((a) => `${a.init.method} ${a.url}`)).toEqual([
      'POST /api/items/a1/fait',
      'DELETE /api/items/a1/fait',
      'PATCH /api/items/a1',
      'GET /api/captures/privees?mois=2026-10',
      'PATCH /api/captures/privees/c1',
      'GET /api/vues/aujourdhui',
    ]);
    expect(JSON.parse(String(appels[2]!.init.body))).toEqual({ nature: 'pensee' });
    expect(JSON.parse(String(appels[4]!.init.body))).toEqual({ etiquette: null });
  });

  it('urlAudio encode l\'identifiant', () => {
    expect(urlAudio('a/b')).toBe('/api/captures/a%2Fb/audio');
  });
});
