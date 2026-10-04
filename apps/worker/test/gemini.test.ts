import { join } from 'node:path';
import { chargerPrompt } from '@organizer/shared';
import { describe, expect, it } from 'vitest';
import { sortieExemple } from '../../../packages/shared/test/sortie-exemple.js';
import { formaterDiagnostic, GeminiProvider } from '../src/classement/gemini.js';
import { CreditEpuise, FournisseurIndisponible, PalierNonPaye, SortieNonConforme } from '../src/classement/provider.js';

const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');

interface Appel { url: string; corps: Record<string, unknown>; entetes: Record<string, string> }

function faux(reponses: Array<{ status: number; texte?: string; tier?: string | null }>) {
  const appels: Appel[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    appels.push({ url: String(url), corps: JSON.parse(String(init?.body)), entetes: init?.headers as Record<string, string> });
    const r = reponses.shift();
    if (!r) throw new Error('appel inattendu');
    let usageMetadata: Record<string, unknown>;
    if (r.tier === null) {
      // tier: null means serviceTier is absent from response
      usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 20 };
    } else {
      usageMetadata = { promptTokenCount: 100, candidatesTokenCount: 20, serviceTier: r.tier ?? 'standard' };
    }
    const corps = r.status === 200
      ? { candidates: [{ content: { parts: [{ text: r.texte ?? '' }] } }], usageMetadata }
      : { error: { message: 'contenu de la requête qui ne doit pas fuiter', status: 'ERREUR' } };
    return new Response(JSON.stringify(corps), { status: r.status });
  };
  return { appels, fetch: f as typeof fetch };
}

const provider = (f: typeof fetch) =>
  new GeminiProvider({ cle: 'cle-test', modele: 'principal', repli: 'repli', prompt, tiersPayes: ['standard'], fetch: f });

const audio = { mime: 'audio/ogg', donnees: Buffer.from('OggS-faux') };

describe('GeminiProvider.classer', () => {
  it('renvoie la sortie validée, le modèle et les jetons', async () => {
    const { fetch } = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    const r = await provider(fetch).classer({ systeme: 'S', audio });
    expect(r.modele).toBe('principal');
    expect(r.sortie.items[0]!.theme).toBe('voiture');
    expect([r.tokensEntree, r.tokensSortie]).toEqual([100, 20]);
  });

  it('envoie l\'audio en ligne, le schéma, la température 0,2 et la clé en en-tête', async () => {
    const { fetch, appels } = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    await provider(fetch).classer({ systeme: 'S', audio });
    const a = appels[0]!;
    expect(a.url).toContain('/models/principal:generateContent');
    expect(a.url).not.toContain('cle-test');
    expect(a.entetes['x-goog-api-key']).toBe('cle-test');
    const gen = a.corps.generationConfig as Record<string, unknown>;
    expect(gen.temperature).toBe(0.2);
    expect(gen.responseMimeType).toBe('application/json');
    expect(gen.responseSchema).toEqual(prompt.responseSchema);
    expect(JSON.stringify(a.corps.contents)).toContain(audio.donnees.toString('base64'));
  });

  it('passe au modèle de repli sur une sortie hors schéma', async () => {
    const { fetch, appels } = faux([
      { status: 200, texte: '{"transcription": 3}' },
      { status: 200, texte: JSON.stringify(sortieExemple()) },
    ]);
    const r = await provider(fetch).classer({ systeme: 'S', texte: 'bonjour' });
    expect(r.modele).toBe('repli');
    expect(appels[1]!.url).toContain('/models/repli:');
  });

  it('lève SortieNonConforme si le repli échoue aussi', async () => {
    const { fetch } = faux([{ status: 200, texte: 'pas du json' }, { status: 200, texte: '{}' }]);
    await expect(provider(fetch).classer({ systeme: 'S', texte: 'x' })).rejects.toBeInstanceOf(SortieNonConforme);
  });

  it('traite un texte vide (réponse bloquée) comme une sortie non conforme', async () => {
    const { fetch } = faux([{ status: 200, texte: '' }, { status: 200, texte: '' }]);
    await expect(provider(fetch).classer({ systeme: 'S', texte: 'x' })).rejects.toBeInstanceOf(SortieNonConforme);
  });

  it('lève CreditEpuise sur HTTP 402, sans tenter le repli', async () => {
    const { fetch, appels } = faux([{ status: 402 }]);
    await expect(provider(fetch).classer({ systeme: 'S', texte: 'x' })).rejects.toBeInstanceOf(CreditEpuise);
    expect(appels).toHaveLength(1);
  });

  it('laisse remonter une panne serveur comme erreur passagère, sans contenu', async () => {
    const { fetch, appels } = faux([{ status: 503 }]);
    const err = await provider(fetch).classer({ systeme: 'S', texte: 'secret de L' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SortieNonConforme);
    expect(String((err as Error).message)).not.toMatch(/secret de L|fuiter/);
    expect(appels).toHaveLength(1);
  });

  it('ne fuite jamais le contenu du modèle en erreur, même avec JSON.parse ou schéma invalide', async () => {
    const { fetch } = faux([
      { status: 200, texte: 'secret de L pas du json' },
      { status: 200, texte: 'secret de L dans un mauvais schéma' },
    ]);
    const err = await provider(fetch).classer({ systeme: 'S', texte: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SortieNonConforme);
    const fullText = JSON.stringify({ m: (err as Error).message, c: String((err as Error).cause), s: (err as Error).stack });
    expect(fullText).not.toMatch(/secret de L|fuiter/);
  });
});

describe('GeminiProvider.verifierPalierPaye', () => {
  it('accepte un palier déclaré payé', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: 'standard' }]);
    await expect(provider(fetch).verifierPalierPaye()).resolves.toBeUndefined();
  });

  it('refuse un palier inconnu ou absent', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: 'free' }]);
    await expect(provider(fetch).verifierPalierPaye()).rejects.toBeInstanceOf(PalierNonPaye);
  });

  it('refuse une réponse sans serviceTier', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: null }]);
    await expect(provider(fetch).verifierPalierPaye()).rejects.toBeInstanceOf(PalierNonPaye);
  });
});

describe('GeminiProvider : indisponibilités, réflexion, délai', () => {
  it.each([403, 429])('HTTP %i : indisponibilité temporaire, sans tenter le repli', async (statut) => {
    const { fetch, appels } = faux([{ status: statut }]);
    const e = await provider(fetch).classer({ systeme: 'S', texte: 'x' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FournisseurIndisponible);
    expect((e as FournisseurIndisponible).statut).toBe(statut);
    expect((e as Error).message).not.toContain('contenu');
    expect(appels).toHaveLength(1);
  });

  it('HTTP 402 reste un crédit épuisé, qui est une indisponibilité', async () => {
    const { fetch } = faux([{ status: 402 }]);
    const e = await provider(fetch).classer({ systeme: 'S', texte: 'x' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CreditEpuise);
    expect(e).toBeInstanceOf(FournisseurIndisponible);
  });

  it('demande le niveau de réflexion configuré, et rien s\'il n\'est pas configuré', async () => {
    const avec = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    await new GeminiProvider({ cle: 'c', modele: 'm', repli: 'r', prompt, tiersPayes: ['standard'], fetch: avec.fetch, niveauReflexion: 'minimal' })
      .classer({ systeme: 'S', texte: 'x' });
    expect((avec.appels[0]!.corps.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    const sans = faux([{ status: 200, texte: JSON.stringify(sortieExemple()) }]);
    await provider(sans.fetch).classer({ systeme: 'S', texte: 'x' });
    expect((sans.appels[0]!.corps.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });

  it('borne l\'appel par un délai', async () => {
    const lent = ((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, rejeter) => {
      init?.signal?.addEventListener('abort', () => rejeter(init.signal!.reason as Error));
    })) as typeof fetch;
    const p = new GeminiProvider({ cle: 'c', modele: 'm', repli: 'r', prompt, tiersPayes: ['standard'], fetch: lent, delaiMs: 20 });
    await expect(p.classer({ systeme: 'S', texte: 'x' })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('GeminiProvider.diagnostiquer', () => {
  it('palier payé : statut, palier, jetons ; aucun contenu', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: 'standard' }]);
    const d = await provider(fetch).diagnostiquer();
    expect(d).toEqual({ statut: 200, tier: 'standard', paye: true, niveauReflexion: null, jetons: { entree: 100, sortie: 20, reflexion: 0 } });
    expect(formaterDiagnostic(d)).toBe('HTTP 200 · palier « standard » : payé · réflexion non demandée · jetons : entrée 100, sortie 20, réflexion 0');
  });

  it('palier absent : REFUSÉ', async () => {
    const { fetch } = faux([{ status: 200, texte: '{}', tier: null }]);
    const d = await provider(fetch).diagnostiquer();
    expect(d.paye).toBe(false);
    expect(formaterDiagnostic(d)).toContain('palier « absent » : REFUSÉ');
  });

  it('erreur HTTP : non vérifiable, sans lever', async () => {
    const { fetch } = faux([{ status: 400 }]);
    const d = await provider(fetch).diagnostiquer();
    expect(d).toMatchObject({ statut: 400, paye: false, jetons: null });
    expect(formaterDiagnostic(d)).toBe('HTTP 400 : palier non vérifiable.');
  });
});
