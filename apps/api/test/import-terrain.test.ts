import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileClassement } from '../src/ingestion/ingestion.service.js';
import { StockageAudio } from '../src/ingestion/stockage.js';
import { importerTerrain } from '../src/terrain/import.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

class FausseFile implements FileClassement {
  ids: string[] = [];
  async enfiler(id: string): Promise<void> { this.ids.push(id); }
}

/** Ligne au format du banc d'essai (infra/terrain/bot.mjs), contenu fabriqué. */
const ligne = (message: number, o: Partial<Record<string, unknown>> = {}): string => JSON.stringify({
  id: `7_${message}`, chat: '7', message_id: message, emis_le: '2026-10-02T08:12:00+02:00', recu_le: '2026-10-02T08:12:01+02:00',
  duree_s: 4, audio: `audio/7_${message}.oga`, texte_ecrit: null, version_prompt: 'tri/v1', modele: 'm', etat: 'classee',
  erreur: null, resultat: { transcription: 'acheter du pain', items: [] }, usage: null, ...o,
});

let dossier: string;
let racine: string;
let file: FausseFile;

beforeEach(async () => {
  await viderBase(prisma);
  await prisma.utilisateur.create({ data: { nom: 'l', telegramChatId: 7n } });
  dossier = mkdtempSync(join(tmpdir(), 'terrain-'));
  mkdirSync(join(dossier, 'audio'));
  racine = mkdtempSync(join(tmpdir(), 'audio-'));
  file = new FausseFile();
});

const importer = () => importerTerrain(prisma, new StockageAudio(racine), file, dossier);

describe('importerTerrain', () => {
  it('crée une capture ordinaire par vocal, range l\'audio, l\'enfile pour le classement', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n${ligne(11, { audio: null, texte_ecrit: 'rappeler le garage', duree_s: null })}\n`);
    expect(await importer()).toEqual({ importees: 2, dejaLa: 0, sansCompte: 0, illisibles: 0, sansAudio: 0, ecartees: [], audiosOrphelins: [] });
    const c = await prisma.capture.findUniqueOrThrow({ where: { sourceRef: 'tg:7:10' } });
    expect(c).toMatchObject({ canal: 'telegram', prive: false, etat: 'en_file', audioMime: 'audio/ogg', dureeS: 4 });
    expect(c.emisLe.toISOString()).toBe('2026-10-02T06:12:00.000Z');
    expect(c.audioPath).toBe(`ordinaire/2026/10/${c.id}.oga`);
    expect((await prisma.capture.findUniqueOrThrow({ where: { sourceRef: 'tg:7:11' } })).texteEcrit).toBe('rappeler le garage');
    expect(file.ids).toHaveLength(2);
  });

  it('réimporter ne crée rien', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n`);
    await importer();
    expect(await importer()).toMatchObject({ importees: 0, dejaLa: 1 });
    expect(await prisma.capture.count()).toBe(1);
  });

  it('une capture déjà reçue par le webhook n\'est pas réimportée', async () => {
    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'l' } });
    await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'classee', sourceRef: 'tg:7:10', emisLe: new Date() } });
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n`);
    expect(await importer()).toMatchObject({ importees: 0, dejaLa: 1 });
  });

  it('compte sans l\'importer un chat sans compte, une ligne illisible, un vocal sans fichier', async () => {
    writeFileSync(join(dossier, 'captures.jsonl'), [
      ligne(20, { chat: '999' }), '{"pas du json', ligne(21, { emis_le: 'hier' }), ligne(22, { audio: 'audio/../../secret.oga' }), '',
    ].join('\n'));
    expect(await importer()).toEqual({
      importees: 0, dejaLa: 0, sansCompte: 1, illisibles: 2, sansAudio: 1, audiosOrphelins: [],
      ecartees: [
        { ligne: 1, id: '7_20', raison: 'sans_compte' },
        { ligne: 2, id: null, raison: 'illisible' },
        { ligne: 3, id: '7_21', raison: 'illisible' },
        { ligne: 4, id: '7_22', raison: 'sans_audio' },
      ],
    });
    expect(await prisma.capture.count()).toBe(0);
  });

  it('deux lignes identiques : une importée, une déjà là', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n${ligne(10)}\n`);
    expect(await importer()).toMatchObject({ importees: 1, dejaLa: 1 });
    expect(await prisma.capture.count()).toBe(1);
  });

  it('liste sans les importer les audios qu\'aucune ligne ne référence', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'audio', '7_99.oga'), 'OggS-orphelin');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n`);
    const b = await importer();
    expect(b.audiosOrphelins).toEqual(['7_99.oga']);
    expect(await prisma.capture.count()).toBe(1);
  });

  it('retire l\'audio copié si la création échoue, jamais la source', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n`);
    const espion = vi.spyOn(prisma.capture, 'create').mockRejectedValueOnce(new Error('panne'));
    await expect(importer()).rejects.toThrow('panne');
    espion.mockRestore();
    expect(existsSync(join(racine, 'ordinaire'))
      ? readdirSync(join(racine, 'ordinaire'), { recursive: true, withFileTypes: true }).filter((f) => f.isFile())
      : []).toEqual([]);
    expect(existsSync(join(dossier, 'audio', '7_10.oga'))).toBe(true);
  });

  it('--essai calcule le bilan sans rien écrire, créer ni enfiler', async () => {
    writeFileSync(join(dossier, 'audio', '7_10.oga'), 'OggS-faux');
    writeFileSync(join(dossier, 'audio', '7_99.oga'), 'OggS-orphelin');
    writeFileSync(join(dossier, 'captures.jsonl'), `${ligne(10)}\n${ligne(22, { audio: 'audio/absent.oga' })}\n`);
    const b = await importerTerrain(prisma, new StockageAudio(racine), file, dossier, { essai: true });
    expect(b).toMatchObject({ importees: 1, sansAudio: 1, audiosOrphelins: ['7_99.oga'] });
    expect(b.ecartees).toEqual([{ ligne: 2, id: '7_22', raison: 'sans_audio' }]);
    expect(await prisma.capture.count()).toBe(0);
    expect(file.ids).toEqual([]);
    expect(readdirSync(racine)).toEqual([]);
  });
});
