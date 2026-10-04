import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Prisma, type PrismaClient } from '@organizer/db';
import type { FileClassement } from '../ingestion/ingestion.service.js';
import type { StockageAudio } from '../ingestion/stockage.js';

/** Ligne de captures.jsonl du banc d'essai (infra/terrain/bot.mjs) : seuls ces champs servent. */
interface LigneTerrain { chat: unknown; message_id: unknown; emis_le: unknown; duree_s: unknown; audio: unknown; texte_ecrit: unknown }

export interface BilanImport { importees: number; dejaLa: number; sansCompte: number; illisibles: number; sansAudio: number }

const MIMES: Record<string, string> = {
  oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
};

/**
 * Importe les captures du banc d'essai. Même source_ref que l'ingestion (tg:<chat>:<message>) :
 * une capture relivrée par Telegram après la bascule, ou un second import, ne crée jamais de doublon.
 * Les captures sont reclassées par le prompt de l'application ; le résultat du banc d'essai est ignoré.
 */
export async function importerTerrain(prisma: PrismaClient, stockage: StockageAudio, file: FileClassement, dossier: string): Promise<BilanImport> {
  const bilan: BilanImport = { importees: 0, dejaLa: 0, sansCompte: 0, illisibles: 0, sansAudio: 0 };
  const lignes = (await readFile(join(dossier, 'captures.jsonl'), 'utf8')).split('\n').filter((l) => l.trim() !== '');
  for (const brute of lignes) {
    let l: LigneTerrain;
    try {
      l = JSON.parse(brute) as LigneTerrain;
    } catch {
      bilan.illisibles++;
      continue;
    }
    const emisLe = new Date(String(l.emis_le));
    if (!/^-?\d{1,20}$/.test(String(l.chat)) || !Number.isInteger(l.message_id) || Number.isNaN(emisLe.getTime())) {
      bilan.illisibles++;
      continue;
    }
    const sourceRef = `tg:${String(l.chat)}:${String(l.message_id)}`;
    if (await prisma.capture.findUnique({ where: { sourceRef }, select: { id: true } })) {
      bilan.dejaLa++;
      continue;
    }
    const u = await prisma.utilisateur.findUnique({ where: { telegramChatId: BigInt(String(l.chat)) }, select: { id: true } });
    if (!u) {
      bilan.sansCompte++;
      continue;
    }
    const id = randomUUID();
    const texte = typeof l.texte_ecrit === 'string' && l.texte_ecrit !== '' ? l.texte_ecrit : null;
    let audioPath: string | null = null;
    let audioMime: string | null = null;
    if (typeof l.audio === 'string') {
      // basename : jamais un fichier hors du dossier audio du banc d'essai.
      const nom = basename(l.audio);
      const extension = extname(nom).slice(1).toLowerCase();
      try {
        audioPath = await stockage.ecrire(id, emisLe, await readFile(join(dossier, 'audio', nom)), extension, 'ordinaire');
        audioMime = MIMES[extension] ?? 'audio/ogg';
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    if (!audioPath && !texte) {
      bilan.sansAudio++;
      continue;
    }
    try {
      await prisma.capture.create({
        data: {
          id, utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'recue', sourceRef, audioPath, audioMime,
          dureeS: typeof l.duree_s === 'number' ? Math.round(l.duree_s) : null, texteEcrit: texte, emisLe,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        bilan.dejaLa++;
        continue;
      }
      throw e;
    }
    // Comme l'ingestion : un échec ici laisse la capture en « recue », reprise par l'API sous 5 min.
    await file.enfiler(id);
    await prisma.capture.updateMany({ where: { id, etat: 'recue' }, data: { etat: 'en_file' } });
    bilan.importees++;
  }
  return bilan;
}
