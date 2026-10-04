import type { Telechargeur } from './ingestion.service.js';

/** Limite de l'API Bot : au-delà, Telegram ne livre jamais le fichier. */
export const TAILLE_MAX_TELEGRAM = 20 * 1024 * 1024;

export class FichierTropGros extends Error {
  override name = 'FichierTropGros';
}

export interface OptionsTelechargeur { apiRoot?: string; delaiMs?: number; tailleMax?: number }

interface ReponseGetFile { ok: boolean; description?: string; result?: { file_path?: string; file_size?: number } }

/** Téléchargement d'un fichier Telegram : chaque appel borné dans le temps, taille plafonnée. */
export class TelechargeurTelegram implements Telechargeur {
  constructor(private readonly jeton: string, private readonly f: typeof fetch, private readonly o: OptionsTelechargeur = {}) {}

  async telecharger(fichierId: string): Promise<{ donnees: Buffer; extension: string }> {
    const base = this.o.apiRoot ?? 'https://api.telegram.org';
    const max = this.o.tailleMax ?? TAILLE_MAX_TELEGRAM;
    const delai = (): AbortSignal => AbortSignal.timeout(this.o.delaiMs ?? 60_000);
    // Les messages d'erreur ne citent jamais l'URL : elle contient le jeton.
    const r = await this.f(`${base}/bot${this.jeton}/getFile?file_id=${encodeURIComponent(fichierId)}`, { signal: delai() });
    const j = (await r.json()) as ReponseGetFile;
    if (j.description?.includes('file is too big')) throw new FichierTropGros('refusé par Telegram');
    if ((j.result?.file_size ?? 0) > max) throw new FichierTropGros(`${j.result?.file_size} octets`);
    const chemin = j.result?.file_path;
    if (!j.ok || !chemin) throw new Error('Telegram getFile en échec');
    const fichier = await this.f(`${base}/file/bot${this.jeton}/${chemin}`, { signal: delai() });
    if (!fichier.ok) throw new Error(`Téléchargement Telegram : HTTP ${fichier.status}`);
    const donnees = Buffer.from(await fichier.arrayBuffer());
    if (donnees.length > max) throw new FichierTropGros(`${donnees.length} octets`);
    return { donnees, extension: chemin.split('.').pop() ?? 'bin' };
  }
}
