import { randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Prisma, type PrismaClient } from '@organizer/db';
import type { FileClassement } from '../ingestion/ingestion.service.js';
import type { StockageAudio } from '../ingestion/stockage.js';

/** Ligne de captures.jsonl du banc d'essai (infra/terrain/bot.mjs) : seuls ces champs servent. */
interface LigneTerrain { chat: unknown; message_id: unknown; emis_le: unknown; duree_s: unknown; audio: unknown; texte_ecrit: unknown }

export interface Ecartee { ligne: number; id: string | null; raison: 'illisible' | 'sans_compte' | 'sans_audio' }

/** Les écartées ne portent que le numéro de ligne et l'identifiant du banc (<chat>_<message>), jamais un contenu. */
export interface BilanImport {
  importees: number; dejaLa: number; sansCompte: number; illisibles: number; sansAudio: number;
  ecartees: Ecartee[];
  /** Fichiers de audio/ qu'aucune ligne ne référence (noms seuls) : jamais importés automatiquement. */
  audiosOrphelins: string[];
}

export interface OptionsImport { /** Calcule le bilan sans rien écrire ni enfiler. */ essai?: boolean }

const IDENTIFIANT = /^-?\d{1,20}_\d{1,20}$/;

/** Identifiant du banc si lisible et de forme attendue, sinon null : jamais un texte libre. */
function identifiantLigne(l: Record<string, unknown>): string | null {
  if (typeof l.id === 'string' && IDENTIFIANT.test(l.id)) return l.id;
  const reconstruit = `${String(l.chat)}_${String(l.message_id)}`;
  return IDENTIFIANT.test(reconstruit) ? reconstruit : null;
}

const MIMES: Record<string, string> = {
  oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg', mp4: 'video/mp4', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
};

/**
 * Importe les captures du banc d'essai. Même source_ref que l'ingestion (tg:<chat>:<message>) :
 * une capture relivrée par Telegram après la bascule, ou un second import, ne crée jamais de doublon.
 * Les captures sont reclassées par le prompt de l'application ; le résultat du banc d'essai est ignoré.
 */
export async function importerTerrain(prisma: PrismaClient, stockage: StockageAudio, file: FileClassement, dossier: string, options: OptionsImport = {}): Promise<BilanImport> {
  const essai = options.essai === true;
  const bilan: BilanImport = { importees: 0, dejaLa: 0, sansCompte: 0, illisibles: 0, sansAudio: 0, ecartees: [], audiosOrphelins: [] };
  const lignes = (await readFile(join(dossier, 'captures.jsonl'), 'utf8')).split('\n');
  const referencés = new Set<string>();
  const vues = new Set<string>();
  for (const [index, brute] of lignes.entries()) {
    if (brute.trim() === '') continue;
    const ligne = index + 1;
    let l: LigneTerrain;
    try {
      l = JSON.parse(brute) as LigneTerrain;
      if (l === null || typeof l !== 'object') throw new Error('forme');
    } catch {
      bilan.illisibles++;
      bilan.ecartees.push({ ligne, id: null, raison: 'illisible' });
      continue;
    }
    if (typeof l.audio === 'string') referencés.add(basename(l.audio));
    const id0 = identifiantLigne(l as unknown as Record<string, unknown>);
    const emisLe = new Date(String(l.emis_le));
    if (!/^-?\d{1,20}$/.test(String(l.chat)) || !Number.isInteger(l.message_id) || Number.isNaN(emisLe.getTime())) {
      bilan.illisibles++;
      bilan.ecartees.push({ ligne, id: id0, raison: 'illisible' });
      continue;
    }
    const sourceRef = `tg:${String(l.chat)}:${String(l.message_id)}`;
    if (vues.has(sourceRef) || await prisma.capture.findUnique({ where: { sourceRef }, select: { id: true } })) {
      bilan.dejaLa++;
      continue;
    }
    const u = await prisma.utilisateur.findUnique({ where: { telegramChatId: BigInt(String(l.chat)) }, select: { id: true } });
    if (!u) {
      bilan.sansCompte++;
      bilan.ecartees.push({ ligne, id: id0, raison: 'sans_compte' });
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
        const source = join(dossier, 'audio', nom);
        if (essai) {
          await stat(source);
          audioPath = 'essai';
        } else {
          audioPath = await stockage.ecrire(id, emisLe, await readFile(source), extension, 'ordinaire');
        }
        audioMime = MIMES[extension] ?? 'audio/ogg';
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    if (!audioPath && !texte) {
      bilan.sansAudio++;
      bilan.ecartees.push({ ligne, id: id0, raison: 'sans_audio' });
      continue;
    }
    vues.add(sourceRef);
    if (essai) {
      bilan.importees++;
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
      // Jamais la source : seulement la copie rangée par cet import.
      if (audioPath) await stockage.supprimer(audioPath).catch(() => undefined);
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
  try {
    bilan.audiosOrphelins = (await readdir(join(dossier, 'audio'))).filter((f) => !referencés.has(f)).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  return bilan;
}
