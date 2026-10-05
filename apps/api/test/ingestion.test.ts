import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureEntrante } from '../src/ingestion/extraire.js';
import { IngestionService, type FileClassement, type Telechargeur } from '../src/ingestion/ingestion.service.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { FichierTropGros } from '../src/ingestion/telechargeur.js';
import { ReencodeurBorne, ReencodeurFfmpeg, type Reencodeur } from '../src/privees/reencodeur.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

class FausseFile implements FileClassement {
  ids: string[] = [];
  async enfiler(id: string): Promise<void> { this.ids.push(id); }
}

class FauxTelechargeur implements Telechargeur {
  appels = 0;
  echoue = false;
  async telecharger(): Promise<{ donnees: Buffer; extension: string }> {
    this.appels++;
    if (this.echoue) throw new Error('réseau');
    return { donnees: Buffer.from('OggS-faux'), extension: 'oga' };
  }
}

let racine: string;
let file: FausseFile;
let tele: FauxTelechargeur;
let service: IngestionService;
/** Faux réencodeur : jamais de vrai ffmpeg dans les tests d'orchestration. */
const reenc: Reencodeur = { versOpus: async () => Buffer.from('OggS-extrait') };
let utilisateurId: string;

beforeEach(async () => {
  await viderBase(prisma);
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  file = new FausseFile();
  tele = new FauxTelechargeur();
  service = new IngestionService(prisma, new StockageAudio(racine), tele, file, () => {}, reenc);
  utilisateurId = (await prisma.utilisateur.create({ data: { nom: 'test' } })).id;
});

const vocal = (ref = 'tg:7:42'): CaptureEntrante => ({
  sourceRef: ref, emisLe: new Date('2026-10-06T06:12:00Z'), dureeS: 12, fichier: { id: 'F', mime: 'audio/ogg' }, texte: null,
});

describe('IngestionService', () => {
  it('recevoir est idempotent sur la référence Telegram', async () => {
    const a = await service.recevoir(utilisateurId, vocal());
    const b = await service.recevoir(utilisateurId, vocal());
    expect(a.nouvelle).toBe(true);
    expect(b).toEqual({ id: a.id, nouvelle: false, prive: false });
    expect(await prisma.capture.count()).toBe(1);
  });

  it('recevoir crée une capture ordinaire horodatée à l\'émission', async () => {
    const { id } = await service.recevoir(utilisateurId, vocal());
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({
      prive: false, canal: 'telegram', etat: 'recue', emisLe: new Date('2026-10-06T06:12:00Z'), sourceFichier: 'F',
    });
  });

  it('finaliser range l\'audio, enfile une fois et passe en_file', async () => {
    const { id } = await service.recevoir(utilisateurId, vocal());
    await service.finaliser(id);
    await service.finaliser(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c.etat).toBe('en_file');
    expect(c.audioPath).toBe(`ordinaire/2026/10/${id}.oga`);
    expect(readFileSync(join(racine, c.audioPath!), 'utf8')).toBe('OggS-faux');
    expect(file.ids).toEqual([id]);
    expect(tele.appels).toBe(1);
  });

  it('finaliser un texte n\'appelle pas Telegram', async () => {
    const { id } = await service.recevoir(utilisateurId, { ...vocal(), fichier: null, dureeS: null, texte: 'pain' });
    await service.finaliser(id);
    expect(tele.appels).toBe(0);
    expect(file.ids).toEqual([id]);
  });

  it('un téléchargement en échec laisse la capture en recue, puis reprendre la finalise', async () => {
    const { id } = await service.recevoir(utilisateurId, vocal());
    tele.echoue = true;
    await expect(service.finaliser(id)).rejects.toThrow();
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('recue');
    expect(file.ids).toEqual([]);

    tele.echoue = false;
    expect(await service.reprendre(new Date(Date.now() + 5 * 60_000))).toBe(1);
    expect(file.ids).toEqual([id]);
  });

  it('ne passe pas en_file une capture déjà classée par le worker', async () => {
    const { id } = await service.recevoir(utilisateurId, { ...vocal(), fichier: null, texte: 'x' });
    file.enfiler = async (cid) => { await prisma.capture.update({ where: { id: cid }, data: { etat: 'classee' } }); };
    await service.finaliser(id);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('classee');
  });

  it('refuse d\'enfiler une capture privée', async () => {
    const c = await prisma.capture.create({ data: { utilisateurId, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    await expect(service.finaliser(c.id)).rejects.toThrow('privée');
    expect(file.ids).toEqual([]);
  });

  it('assainit l\'extension du fichier', async () => {
    const chemin = await new StockageAudio(racine).ecrire('abc', new Date('2026-01-15T00:00:00Z'), Buffer.from('x'), '../../etc', 'ordinaire');
    expect(chemin).toBe('ordinaire/2026/01/abc.bin');
    expect(existsSync(join(racine, chemin))).toBe(true);
  });
});

describe('prochaine capture privée', () => {
  it('le drapeau armé rend la capture suivante privée, une seule fois', async () => {
    await service.armerPrivee(utilisateurId);
    const a = await service.recevoir(utilisateurId, vocal('tg:7:1'));
    const b = await service.recevoir(utilisateurId, vocal('tg:7:2'));
    expect([a.prive, b.prive]).toEqual([true, false]);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ prive: true, etat: 'privee', canal: 'telegram' });
    expect((await prisma.utilisateur.findUniqueOrThrow({ where: { id: utilisateurId } })).prochainePrivee).toBe(false);
  });

  it('une création en échec rend le drapeau ; la relivraison reste privée', async () => {
    await service.armerPrivee(utilisateurId);
    await service.recevoir(utilisateurId, vocal('tg:7:1'));
    await service.armerPrivee(utilisateurId);
    // Même référence : la création échoue (P2002), la transaction rend le drapeau.
    const relivree = await service.recevoir(utilisateurId, vocal('tg:7:1'));
    expect(relivree).toMatchObject({ nouvelle: false, prive: true });
    expect((await prisma.utilisateur.findUniqueOrThrow({ where: { id: utilisateurId } })).prochainePrivee).toBe(true);
  });

  it('finaliserPrivee range l\'audio dans prive/ et n\'enfile jamais', async () => {
    await service.armerPrivee(utilisateurId);
    const { id } = await service.recevoir(utilisateurId, vocal());
    await service.finaliserPrivee(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c.audioPath).toBe(`prive/2026/10/${id}.oga`);
    expect(c.etat).toBe('privee');
    expect(file.ids).toEqual([]);
    await expect(service.finaliser(id)).rejects.toThrow('privée');
  });

  it('reprendre télécharge les privées restées sans audio, sans les enfiler', async () => {
    await service.armerPrivee(utilisateurId);
    const { id } = await service.recevoir(utilisateurId, vocal());
    expect(await service.reprendre(new Date(Date.now() + 5 * 60_000))).toBe(1);
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).audioPath).not.toBeNull();
    expect(file.ids).toEqual([]);
  });
});

describe('audio trop gros pour Telegram', () => {
  it('passe en à revoir, sans enfilage ni boucle de reprise', async () => {
    const s = new IngestionService(prisma, new StockageAudio(racine), {
      telecharger: async () => { throw new FichierTropGros('25000000 octets'); },
    }, file, () => {}, reenc);
    const { id } = await s.recevoir(utilisateurId, {
      sourceRef: 'tg:7:99', emisLe: new Date('2026-10-06T06:00:00Z'), dureeS: 2400, fichier: { id: 'F', mime: 'audio/ogg' }, texte: null,
    });
    await s.finaliser(id);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({ etat: 'a_revoir', erreur: 'audio_trop_gros' });
    expect(file.ids).toEqual([]);
    expect(await s.reprendre(new Date(Date.now() + 10 * 60_000))).toBe(0);
  });
});

/** Une seconde de vidéo avec piste son, fabriquée par ffmpeg : aucune vraie image. */
const mp4 = (): Buffer => execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5:duration=1',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest',
  '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1',
]);

/** MP4 classique : sans fragmentation ni faststart, l'index (moov) est écrit en fin de fichier, comme beaucoup de bulles réelles. */
const mp4MoovFin = (): Buffer => {
  const dossier = mkdtempSync(join(tmpdir(), 'mp4-'));
  const f = join(dossier, 'v.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', f,
  ]);
  const b = readFileSync(f);
  rmSync(dossier, { recursive: true });
  return b;
};

const bulle = (ref: string): CaptureEntrante => ({
  sourceRef: ref, emisLe: new Date('2026-10-06T06:12:00Z'), dureeS: 5, fichier: { id: 'V', mime: 'video/mp4' }, texte: null,
});

const fichiersRanges = (): string[] => readdirSync(racine, { recursive: true }).map(String).filter((f) => /\.\w+$/.test(f));

describe('bulle vidéo Telegram : seul le son est gardé', () => {
  const video = { telecharger: async () => ({ donnees: Buffer.from('VIDEO-BRUTE'), extension: 'mp4' }) };

  it('capture ordinaire : audio extrait range, mime audio, vidéo jamais écrite, job enfilé', async () => {
    const recus: Buffer[] = [];
    const s = new IngestionService(prisma, new StockageAudio(racine), video, file, () => {}, {
      versOpus: async (d) => { recus.push(d); return Buffer.from('OggS-extrait'); },
    });
    const { id } = await s.recevoir(utilisateurId, bulle('tg:7:200'));
    await s.finaliser(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(recus.map(String)).toEqual(['VIDEO-BRUTE']);
    expect(c).toMatchObject({ etat: 'en_file', audioMime: 'audio/ogg' });
    expect(c.audioPath).toMatch(/\.ogg$/);
    expect(readFileSync(join(racine, c.audioPath!)).toString()).toBe('OggS-extrait');
    expect(fichiersRanges()).toEqual([c.audioPath]);
    expect(file.ids).toEqual([id]);
  });

  it('capture privée : seul le son est range dans prive/, jamais enfilée', async () => {
    const s = new IngestionService(prisma, new StockageAudio(racine), video, file, () => {}, reenc);
    await s.armerPrivee(utilisateurId);
    const { id } = await s.recevoir(utilisateurId, bulle('tg:7:201'));
    await s.finaliserPrivee(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ audioMime: 'audio/ogg' });
    expect(c.audioPath).toMatch(/^prive\/.*\.ogg$/);
    expect(fichiersRanges()).toEqual([c.audioPath]);
    expect(file.ids).toEqual([]);
  });

  it('échec de ffmpeg : rien range, rien enfilé, capture reprenable, jamais de vidéo en repli', async () => {
    const s = new IngestionService(prisma, new StockageAudio(racine), video, file, () => {}, {
      versOpus: async () => { throw new Error('ffmpeg'); },
    });
    const { id } = await s.recevoir(utilisateurId, bulle('tg:7:202'));
    await expect(s.finaliser(id)).rejects.toThrow('ffmpeg');
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({ etat: 'recue', audioPath: null, audioMime: 'video/mp4' });
    expect(fichiersRanges()).toEqual([]);
    expect(file.ids).toEqual([]);
    // La reprise rejoue l'extraction, sans perte.
    await new IngestionService(prisma, new StockageAudio(racine), video, file, () => {}, reenc).finaliser(id);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({ etat: 'en_file', audioMime: 'audio/ogg' });
  });

  it('reliquat : une vidéo déjà rangee n\'est jamais enfilée, elle passe en à revoir', async () => {
    const { id } = await service.recevoir(utilisateurId, bulle('tg:7:203'));
    await prisma.capture.update({ where: { id }, data: { audioPath: 'ordinaire/2026/10/x.mp4' } });
    await service.finaliser(id);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({ etat: 'a_revoir', erreur: 'media_video' });
    expect(file.ids).toEqual([]);
  });

  it('avec un vrai ffmpeg : un MP4 dont le moov est en fin de fichier est lu, sans fichier temporaire résiduel', async () => {
    const donnees = mp4MoovFin();
    expect(donnees.indexOf('moov')).toBeGreaterThan(donnees.indexOf('mdat'));
    const avant = readdirSync(tmpdir()).filter((f) => f.startsWith('organizer-'));
    const s = new IngestionService(prisma, new StockageAudio(racine), { telecharger: async () => ({ donnees, extension: 'mp4' }) },
      file, () => {}, new ReencodeurBorne(new ReencodeurFfmpeg()));
    const { id } = await s.recevoir(utilisateurId, bulle('tg:7:205'));
    await s.finaliser(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ etat: 'en_file', audioMime: 'audio/ogg' });
    expect(readFileSync(join(racine, c.audioPath!)).subarray(0, 4).toString()).toBe('OggS');
    expect(readdirSync(tmpdir()).filter((f) => f.startsWith('organizer-'))).toEqual(avant);
  });

  it('avec un vrai ffmpeg : le fichier range est de l\'Ogg sans piste vidéo', async () => {
    const s = new IngestionService(prisma, new StockageAudio(racine), { telecharger: async () => ({ donnees: mp4(), extension: 'mp4' }) },
      file, () => {}, new ReencodeurBorne(new ReencodeurFfmpeg()));
    const { id } = await s.recevoir(utilisateurId, bulle('tg:7:204'));
    await s.finaliser(id);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    const range = readFileSync(join(racine, c.audioPath!));
    expect(range.subarray(0, 4).toString()).toBe('OggS');
    // Demander la piste vidéo échoue : il n'y en a plus.
    expect(() => execFileSync('ffmpeg', ['-v', 'error', '-i', join(racine, c.audioPath!), '-map', '0:v:0', '-f', 'null', '-'], { stdio: 'ignore' })).toThrow();
  });
});
