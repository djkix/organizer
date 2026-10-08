import { describe, expect, it, vi } from 'vitest';
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
  it('historique : liste par mois et détail, sur les bonnes routes', async () => {
    const corps = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    const { f, appels } = fauxFetch([corps([]), corps({ id: 'x' })]);
    const api = creerClientApi({ fetch: f });
    expect(await api.historique('2026-10')).toEqual([]);
    expect(appels[0]!.url).toBe('/api/historique?mois=2026-10');
    expect(await api.envoi('a b')).toEqual({ id: 'x' });
    expect(appels[1]!.url).toBe('/api/historique/a%20b');
  });

  it('transcription : le texte sur 200, null sur 404 ou coupure, sans renvoyer vers la connexion', async () => {
    const { f, appels } = fauxFetch([
      new Response(JSON.stringify({ texte: 'Appeler le garage.' }), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ message: 'Élément introuvable.' }), { status: 404, headers: { 'content-type': 'application/json' } }),
      new TypeError('réseau'),
    ]);
    const api = creerClientApi({ fetch: f });
    expect(await api.transcription('c 1')).toBe('Appeler le garage.');
    expect(appels[0]!.url).toBe('/api/captures/c%201/transcription');
    expect(await api.transcription('c2')).toBeNull();
    expect(await api.transcription('c3')).toBeNull();
  });

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

  it('un message brut du serveur (400, 413, 500) n\'est jamais montré', async () => {
    const { f } = fauxFetch([
      Response.json({ message: 'Validation failed (uuid is expected)' }, { status: 400 }),
      Response.json({ message: 'request entity too large' }, { status: 413 }),
      Response.json({ message: 'Internal server error' }, { status: 500 }),
    ]);
    const api = creerClientApi({ fetch: f });
    const e1 = (await api.cocher('x').catch((x: unknown) => x)) as ErreurApi;
    const e2 = (await api.cocher('x').catch((x: unknown) => x)) as ErreurApi;
    const e3 = (await api.cocher('x').catch((x: unknown) => x)) as ErreurApi;
    expect(e1.message).toBe(MESSAGES.serveurIndisponible);
    expect(e2.message).toBe(MESSAGES.enregistrementTropLong);
    expect(e3.message).toBe(MESSAGES.serveurIndisponible);
    expect(e1.statut).toBe(400);
  });

  it('un appel qui ne répond jamais devient HorsLigne après 15 s, sans signaler de déconnexion', async () => {
    vi.useFakeTimers();
    try {
      let signalee = 0;
      const f = ((_u: unknown, init: RequestInit) => new Promise<Response>((_ok, ko) => {
        init.signal?.addEventListener('abort', () => ko(new DOMException('abort', 'AbortError')));
      })) as typeof fetch;
      const api = creerClientApi({ fetch: f, surNonConnecte: () => { signalee++; } });
      const p = api.moi().catch((x: unknown) => x);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await p).toBeInstanceOf(HorsLigne);
      expect(signalee).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('empreinte : routes, méthodes, et un 401 de connexion ne renvoie pas vers la connexion', async () => {
    let appelee = 0;
    const { f, appels } = fauxFetch([
      Response.json({ challenge: 'defi' }),
      Response.json({ message: 'Empreinte non reconnue. Essaie ton mot de passe.' }, { status: 401 }),
      Response.json([]),
      vide(),
    ]);
    const api = creerClientApi({ fetch: f, surNonConnecte: () => { appelee++; } });
    expect(await api.optionsConnexionEmpreinte()).toEqual({ challenge: 'defi' });
    const e = await api.connecterParEmpreinte({
      id: 'a', rawId: 'a', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
    }).catch((x: unknown) => x);
    expect((e as ErreurApi).message).toBe('Empreinte non reconnue. Essaie ton mot de passe.');
    expect(await api.empreintes()).toEqual([]);
    await api.retirerEmpreinte('a/b');
    expect(appels.map((a) => `${a.init.method} ${a.url}`)).toEqual([
      'POST /api/session/empreinte/options', 'POST /api/session/empreinte', 'GET /api/empreintes', 'DELETE /api/empreintes/a%2Fb',
    ]);
    expect(entetes(appels[1]!.init).get('content-type')).toBe('application/json');
    expect(appelee).toBe(0);
  });
});
