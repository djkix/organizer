import { describe, expect, it } from 'vitest';
import { FichierTropGros, TelechargeurTelegram } from '../src/ingestion/telechargeur.js';

type Reponse = { status?: number; json?: unknown; octets?: number };

function faux(reponses: Reponse[]) {
  const urls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const r = reponses.shift();
    if (!r) throw new Error('appel inattendu');
    if (r.json !== undefined) return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
    return new Response(Buffer.alloc(r.octets ?? 4), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, urls };
}

describe('TelechargeurTelegram', () => {
  it('télécharge le fichier et garde son extension', async () => {
    const { f, urls } = faux([{ json: { ok: true, result: { file_path: 'voice/file_1.oga', file_size: 4 } } }, { octets: 4 }]);
    const r = await new TelechargeurTelegram('0:jeton', f).telecharger('F1');
    expect(r.extension).toBe('oga');
    expect(r.donnees.length).toBe(4);
    expect(urls[1]).toBe('https://api.telegram.org/file/bot0:jeton/voice/file_1.oga');
  });

  it('un fichier annoncé au-delà de 20 Mio est trop gros, sans second appel', async () => {
    const { f, urls } = faux([{ json: { ok: true, result: { file_path: 'voice/x.oga', file_size: 25_000_000 } } }]);
    await expect(new TelechargeurTelegram('0:j', f).telecharger('F')).rejects.toBeInstanceOf(FichierTropGros);
    expect(urls).toHaveLength(1);
  });

  it('« file is too big » de Telegram est aussi un fichier trop gros', async () => {
    const { f } = faux([{ status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: file is too big' } }]);
    await expect(new TelechargeurTelegram('0:j', f).telecharger('F')).rejects.toBeInstanceOf(FichierTropGros);
  });

  it('borne chaque appel par un délai', async () => {
    const lent = ((_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, rejeter) => {
      init?.signal?.addEventListener('abort', () => rejeter(init.signal!.reason as Error));
    })) as typeof fetch;
    await expect(new TelechargeurTelegram('0:j', lent, { delaiMs: 20 }).telecharger('F')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
