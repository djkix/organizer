import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureEntrante } from '../src/ingestion/extraire.js';
import { IngestionService, type FileClassement, type Telechargeur } from '../src/ingestion/ingestion.service.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { FichierTropGros } from '../src/ingestion/telechargeur.js';

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
let utilisateurId: string;

beforeEach(async () => {
  await viderBase(prisma);
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  file = new FausseFile();
  tele = new FauxTelechargeur();
  service = new IngestionService(prisma, new StockageAudio(racine), tele, file, () => {});
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
    }, file, () => {});
    const { id } = await s.recevoir(utilisateurId, {
      sourceRef: 'tg:7:99', emisLe: new Date('2026-10-06T06:00:00Z'), dureeS: 2400, fichier: { id: 'F', mime: 'audio/ogg' }, texte: null,
    });
    await s.finaliser(id);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({ etat: 'a_revoir', erreur: 'audio_trop_gros' });
    expect(file.ids).toEqual([]);
    expect(await s.reprendre(new Date(Date.now() + 10 * 60_000))).toBe(0);
  });
});
