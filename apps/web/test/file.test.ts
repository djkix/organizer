import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  creerVideur, EnregistrementVide, envoyerCapture, garderPuisEnvoyer, ouvrirFilePrivee, type CapturePrivee,
} from '../src/lib/prive/file.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const capture = (n: number): CapturePrivee => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  emisLe: `2026-10-06T08:0${n}:00.000Z`,
  dureeS: 12,
  mime: 'audio/webm;codecs=opus',
  blob: new Blob([`audio ${n}`], { type: 'audio/webm' }),
});
const base = () => ouvrirFilePrivee(`test-${crypto.randomUUID()}`);

interface Envoi { url: string; methode: string; entetes: Headers; corps: string }
/** Répond les statuts dans l'ordre ; le dernier se répète. */
function serveur(statuts: Array<number | 'coupure'>) {
  const envois: Envoi[] = [];
  const f = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const s = statuts.length > 1 ? statuts.shift()! : statuts[0]!;
    envois.push({ url: String(url), methode: init.method ?? 'GET', entetes: new Headers(init.headers), corps: await (init.body as Blob).text() });
    if (s === 'coupure') throw new TypeError('Failed to fetch');
    return new Response(s === 200 || s === 201 ? JSON.stringify({ id: 'x' }) : null, { status: s });
  }) as typeof fetch;
  return { f, envois };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('file IndexedDB', () => {
  it('garde le blob intact et rend les plus anciennes d\'abord', async () => {
    const file = base();
    await file.ajouter(capture(2));
    await file.ajouter(capture(1));
    const l = await file.lister();
    expect(l.map((c) => c.id)).toEqual([capture(1).id, capture(2).id]);
    expect(await l[0]!.blob.text()).toBe('audio 1');
    expect(l[0]!.mime).toBe('audio/webm;codecs=opus');
  });

  it('survit à la réouverture de la base', async () => {
    const nom = `test-${crypto.randomUUID()}`;
    await ouvrirFilePrivee(nom).ajouter(capture(1));
    expect(await ouvrirFilePrivee(nom).lister()).toHaveLength(1);
  });
});

describe('envoyerCapture', () => {
  it('envoie l\'audio brut avec les trois en-têtes du contrat', async () => {
    const { f, envois } = serveur([201]);
    expect(await envoyerCapture(capture(1), f)).toEqual({ issue: 'livre' });
    const e = envois[0]!;
    expect(`${e.methode} ${e.url}`).toBe('POST /api/captures/privees');
    expect(e.entetes.get('content-type')).toBe('audio/webm;codecs=opus');
    expect(e.entetes.get('x-capture-id')).toBe(capture(1).id);
    expect(e.entetes.get('x-emis-le')).toBe('2026-10-06T08:01:00.000Z');
    expect(e.entetes.get('x-duree-s')).toBe('12');
    expect(e.corps).toBe('audio 1');
  });

  it.each([200, 201])('%i : livrée', async (statut) => {
    expect(await envoyerCapture(capture(1), serveur([statut]).f)).toEqual({ issue: 'livre' });
  });

  it.each([400, 401, 413, 415, 422, 429, 500, 503])('%i : refusée, la copie reste', async (statut) => {
    expect(await envoyerCapture(capture(1), serveur([statut]).f)).toEqual({ issue: 'refuse', statut });
  });

  it('coupure : réseau', async () => {
    expect(await envoyerCapture(capture(1), serveur(['coupure']).f)).toEqual({ issue: 'reseau' });
  });
});

describe('videur', () => {
  it('retire les livrées et garde les refusées', async () => {
    const file = base();
    await file.ajouter(capture(1));
    await file.ajouter(capture(2));
    const b = await creerVideur(file, serveur([201, 415]).f).vider();
    expect(b).toEqual({ livrees: 1, restantes: 0, refusees: 1, nonConnecte: false, horsLigne: false });
    expect((await file.lister()).map((c) => c.id)).toEqual([capture(2).id]);
  });

  it('s\'arrête à la première coupure, sans rien retirer', async () => {
    const file = base();
    await file.ajouter(capture(1));
    await file.ajouter(capture(2));
    const { f, envois } = serveur(['coupure']);
    expect(await creerVideur(file, f).vider()).toEqual({ livrees: 0, restantes: 2, refusees: 0, nonConnecte: false, horsLigne: true });
    expect(envois).toHaveLength(1);
    expect(await file.lister()).toHaveLength(2);
  });

  it('s\'arrête sur un 401 et le signale', async () => {
    const file = base();
    await file.ajouter(capture(1));
    await file.ajouter(capture(2));
    const { f, envois } = serveur([401]);
    expect(await creerVideur(file, f).vider()).toEqual({ livrees: 0, restantes: 2, refusees: 0, nonConnecte: true, horsLigne: false });
    expect(envois).toHaveLength(1);
  });

  it('deux vidages simultanés n\'envoient chaque capture qu\'une fois', async () => {
    const file = base();
    await file.ajouter(capture(1));
    await file.ajouter(capture(2));
    const { f, envois } = serveur([201]);
    const v = creerVideur(file, f);
    await Promise.all([v.vider(), v.vider(), v.vider()]);
    expect(envois.map((e) => e.entetes.get('x-capture-id'))).toEqual([capture(1).id, capture(2).id]);
  });

  it('un rejeu après coupure garde le même X-Capture-Id ; 200 au rejeu retire la capture', async () => {
    const file = base();
    await file.ajouter(capture(1));
    const { f, envois } = serveur(['coupure', 200]);
    const v = creerVideur(file, f);
    await v.vider();
    await v.vider();
    expect(envois.map((e) => e.entetes.get('x-capture-id'))).toEqual([capture(1).id, capture(1).id]);
    expect(await file.lister()).toEqual([]);
  });

  it('prévient ses écouteurs à chaque vidage, jusqu\'au désabonnement', async () => {
    const v = creerVideur(base(), serveur([201]).f);
    const recus: number[] = [];
    const arret = v.ecouter((b) => recus.push(b.livrees));
    await v.vider();
    arret();
    await v.vider();
    expect(recus).toEqual([0]);
  });
});

describe('garderPuisEnvoyer', () => {
  const enregistrement = { blob: new Blob(['audio']), mime: 'audio/webm;codecs=opus', dureeS: 3, emisLe: '2026-10-06T08:00:00.000Z' };

  it('écrit dans la file avant tout envoi, avec un UUID', async () => {
    const file = base();
    let presente = false;
    const f = (async () => {
      presente = (await file.lister()).length === 1;
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const v = creerVideur(file, f);
    const c = await garderPuisEnvoyer(file, v, enregistrement);
    await v.vider();
    expect(c.id).toMatch(UUID);
    expect(presente).toBe(true);
  });

  it('refuse un enregistrement vide : rien en file, rien envoyé', async () => {
    const file = base();
    const { f, envois } = serveur([201]);
    await expect(garderPuisEnvoyer(file, creerVideur(file, f), { ...enregistrement, blob: new Blob([]) }))
      .rejects.toBeInstanceOf(EnregistrementVide);
    expect(await file.lister()).toEqual([]);
    expect(envois).toEqual([]);
  });
});

describe('fiabilité', () => {
  it('envoie X-Duree-S arrondi', async () => {
    const { f, envois } = serveur([201]);
    await envoyerCapture({ ...capture(1), dureeS: 12.6 }, f);
    expect(envois[0]!.entetes.get('x-duree-s')).toBe('13');
  });

  it('un envoi muet est coupé après un délai proportionnel : réseau, la copie reste, le vidage suivant repart', async () => {
    vi.useFakeTimers();
    const muet = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const p = envoyerCapture(capture(1), muet);
    await vi.advanceTimersByTimeAsync(59_000);
    let fini = false;
    void p.then(() => { fini = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toEqual({ issue: 'reseau' });
  });

  it('un vidage bloqué libère le suivant après le délai', async () => {
    // fake-indexeddb s'appuie sur setImmediate : seuls les délais sont simulés.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const file = base();
    await file.ajouter(capture(1));
    const muet = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const b = creerVideur(file, muet).vider();
    let fini = false;
    void b.then(() => { fini = true; });
    await vi.waitFor(async () => { await vi.advanceTimersByTimeAsync(10_000); expect(fini).toBe(true); });
    expect(await b).toMatchObject({ horsLigne: true, restantes: 1 });
    expect(await file.lister()).toHaveLength(1);
  });

  it('une capture mise en file pendant un vidage part dans la même session', async () => {
    const file = base();
    await file.ajouter(capture(1));
    const envois: string[] = [];
    let lacher!: () => void;
    const porte = new Promise<void>((r) => { lacher = r; });
    const f = (async (_u: RequestInfo | URL, init: RequestInit = {}) => {
      envois.push(new Headers(init.headers).get('x-capture-id')!);
      if (envois.length === 1) await porte;
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const v = creerVideur(file, f);
    const premier = v.vider();
    await vi.waitFor(() => expect(envois).toHaveLength(1));
    await garderPuisEnvoyer(file, v, { ...capture(2), blob: new Blob(['b']) }, capture(2).id);
    lacher();
    await premier;
    await vi.waitFor(() => expect(envois).toEqual([capture(1).id, capture(2).id]));
    expect(await file.lister()).toEqual([]);
  });

  it.each([429, 500, 503])('%i : le vidage s\'arrête, tout reste en file', async (statut) => {
    const file = base();
    await file.ajouter(capture(1));
    await file.ajouter(capture(2));
    const { f, envois } = serveur([statut]);
    const b = await creerVideur(file, f).vider();
    expect(b).toMatchObject({ livrees: 0, restantes: 2, refusees: 0 });
    expect(envois).toHaveLength(1);
    expect(await file.lister()).toHaveLength(2);
  });

  it.each([400, 413, 415, 422])('%i : mise de côté, jamais supprimée, ignorée aux vidages suivants', async (statut) => {
    const file = base();
    await file.ajouter(capture(1));
    await file.ajouter(capture(2));
    const { f, envois } = serveur([statut, 201]);
    const v = creerVideur(file, f);
    expect(await v.vider()).toEqual({ livrees: 1, restantes: 0, refusees: 1, nonConnecte: false, horsLigne: false });
    const l = await file.lister();
    expect(l.map((c) => c.id)).toEqual([capture(1).id]);
    expect(l[0]!.refuse?.statut).toBe(statut);
    expect(await v.vider()).toMatchObject({ refusees: 1, livrees: 0 });
    expect(envois).toHaveLength(2);
  });

  it('reessayerRefusees renvoie les mises de côté, et une livrée est retirée', async () => {
    const file = base();
    await file.ajouter(capture(1));
    const { f, envois } = serveur([422, 201]);
    const v = creerVideur(file, f);
    await v.vider();
    expect(await v.reessayerRefusees()).toMatchObject({ livrees: 1, refusees: 0 });
    expect(envois).toHaveLength(2);
    expect(await file.lister()).toEqual([]);
  });

  it('utilise navigator.locks quand il existe', async () => {
    const request = vi.fn(async (_n: string, cb: () => Promise<unknown>) => cb());
    vi.stubGlobal('navigator', { locks: { request } });
    const file = base();
    await file.ajouter(capture(1));
    await creerVideur(file, serveur([201]).f).vider();
    expect(request).toHaveBeenCalledWith('organizer-prive', expect.any(Function));
  });
});

describe('écriture bornée et connexions', () => {
  it('une base qui ne répond pas : ajouter échoue après 10 s au lieu d\'attendre sans fin', async () => {
    vi.useFakeTimers();
    const file = ouvrirFilePrivee('x', { ouvrir: () => new Promise(() => undefined) });
    let erreur: unknown = null;
    void file.ajouter(capture(1)).catch((e: unknown) => { erreur = e; });
    await vi.advanceTimersByTimeAsync(9_900);
    expect(erreur).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(erreur).toBeInstanceOf(Error);
  });

  it('une capture déjà écrite peut être réécrite sous le même id sans doublon', async () => {
    const file = base();
    await file.ajouter(capture(1));
    await file.ajouter(capture(1));
    expect(await file.lister()).toHaveLength(1);
  });

  it('une nouvelle version de la base n\'est pas bloquée : l\'ancienne connexion se ferme', async () => {
    const nom = `test-${crypto.randomUUID()}`;
    const file = ouvrirFilePrivee(nom);
    await file.ajouter(capture(1));
    const ouverte = await new Promise<boolean>((fin) => {
      const demande = indexedDB.open(nom, 2);
      demande.onsuccess = () => { demande.result.close(); fin(true); };
      demande.onerror = () => fin(false);
      setTimeout(() => fin(false), 1_000);
    });
    expect(ouverte).toBe(true);
  });
});
