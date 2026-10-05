import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { chargerPrompt } from '@organizer/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SortieNonConforme } from '../src/classement/provider.js';
import { CapturePriveeRefusee, traiterCapture, type DepsTraitement } from '../src/classement/traiter.js';
import { creerCaptureTexte, FauxProvider, resultatExemple } from './aides.js';

const prisma = creerPrisma();
const prompt = chargerPrompt(join(import.meta.dirname, '../../../prompts'), 'tri/v1');
const audioRacine = mkdtempSync(join(tmpdir(), 'audio-'));
afterAll(() => prisma.$disconnect());
beforeEach(() => viderBase(prisma));

const deps = (provider: FauxProvider): DepsTraitement => ({
  prisma, provider, prompt, audioRacine, maintenant: () => new Date('2026-10-06T06:13:00Z'),
});

describe('traiterCapture', () => {
  it('écrit les items, leur sous-type, le thème, la version et le modèle', async () => {
    const { id } = await creerCaptureTexte(prisma);
    expect(await traiterCapture(id, deps(new FauxProvider()))).toBe('classee');

    const items = await prisma.item.findMany({ where: { captureId: id }, include: { action: true, pensee: true, theme: true }, orderBy: { position: 'asc' } });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ nature: 'action', versionPrompt: 'tri/v1', modele: 'modele-test' });
    expect(items[0]!.action).toMatchObject({ echeanceType: 'jour', contexte: 'appel', alarme: false });
    expect(items[0]!.theme?.libelle).toBe('voiture');
    expect(items[1]!.pensee?.tonalite).toBe('constat');
    expect(items[1]!.action).toBeNull();

    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ etat: 'classee', modele: 'modele-test', versionPrompt: 'tri/v1', tokensEntree: 10 });
    expect(c.texteBrut).toContain('garage');
  });

  it('transmet la date d\'émission locale et les thèmes connus au prompt', async () => {
    await prisma.theme.create({ data: { libelle: 'maison' } });
    const { id } = await creerCaptureTexte(prisma);
    const p = new FauxProvider();
    await traiterCapture(id, deps(p));
    expect(p.appels[0]!.systeme).toContain('2026-10-06T08:12:00+02:00 (mardi)');
    expect(p.appels[0]!.systeme).toContain('maison');
    expect(p.appels[0]!.texte).toBe('rappeler le garage jeudi');
  });

  it('envoie l\'audio stocké quand la capture en a un', async () => {
    const { id } = await creerCaptureTexte(prisma);
    mkdirSync(join(audioRacine, 'ordinaire'), { recursive: true });
    writeFileSync(join(audioRacine, 'ordinaire', `${id}.oga`), 'OggS-faux');
    await prisma.capture.update({ where: { id }, data: { texteEcrit: null, audioPath: `ordinaire/${id}.oga`, audioMime: 'audio/ogg' } });
    const p = new FauxProvider();
    await traiterCapture(id, deps(p));
    expect(p.appels[0]!.audio?.donnees.toString()).toBe('OggS-faux');
    expect(p.appels[0]!.texte).toBeUndefined();
  });

  it('met en à revoir une capture dont le média est une vidéo, sans appeler le fournisseur', async () => {
    const { id } = await creerCaptureTexte(prisma);
    mkdirSync(join(audioRacine, 'ordinaire'), { recursive: true });
    writeFileSync(join(audioRacine, 'ordinaire', `${id}.mp4`), 'VIDEO-FAUSSE');
    await prisma.capture.update({ where: { id }, data: { audioPath: `ordinaire/${id}.mp4`, audioMime: 'video/mp4' } });
    const p = new FauxProvider();
    expect(await traiterCapture(id, deps(p))).toBe('a_revoir');
    expect(p.appels).toHaveLength(0);
    expect(await prisma.capture.findUniqueOrThrow({ where: { id } })).toMatchObject({ etat: 'a_revoir', erreur: 'media_video' });
  });

  it('refuse une capture privée sans appeler le fournisseur', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'test' } });
    const c = await prisma.capture.create({ data: { utilisateurId: u.id, canal: 'pwa', prive: true, etat: 'privee', emisLe: new Date() } });
    const p = new FauxProvider();
    await expect(traiterCapture(c.id, deps(p))).rejects.toBeInstanceOf(CapturePriveeRefusee);
    expect(p.appels).toHaveLength(0);
  });

  it('ne rappelle pas Gemini pour une capture déjà classée', async () => {
    const { id } = await creerCaptureTexte(prisma);
    const p = new FauxProvider();
    await traiterCapture(id, deps(p));
    expect(await traiterCapture(id, deps(p))).toBe('deja_traitee');
    expect(p.appels).toHaveLength(1);
  });

  it('un rejeu après interruption ne double aucun item', async () => {
    const { id } = await creerCaptureTexte(prisma);
    await traiterCapture(id, deps(new FauxProvider()));
    await prisma.capture.update({ where: { id }, data: { etat: 'en_file' } });
    await traiterCapture(id, deps(new FauxProvider()));
    expect(await prisma.item.count({ where: { captureId: id } })).toBe(2);
    expect(await prisma.theme.count()).toBe(2);
  });

  it('passe en a_revoir sur une sortie non conforme, sans item', async () => {
    const { id } = await creerCaptureTexte(prisma);
    expect(await traiterCapture(id, deps(new FauxProvider([new SortieNonConforme('x')])))).toBe('a_revoir');
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c.etat).toBe('a_revoir');
    expect(c.erreur).toBe('sortie_non_conforme');
    expect(await prisma.item.count()).toBe(0);
  });

  it('passe en a_revoir une capture sans item, en gardant transcription et traçabilité', async () => {
    const { id } = await creerCaptureTexte(prisma);
    const vide = { ...resultatExemple(), sortie: { ...resultatExemple().sortie, transcription: 'euh', items: [] } };
    expect(await traiterCapture(id, deps(new FauxProvider([vide])))).toBe('a_revoir');
    const c = await prisma.capture.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({
      etat: 'a_revoir', erreur: 'aucun_item', texteBrut: 'euh', versionPrompt: 'tri/v1',
      modele: 'modele-test', tokensEntree: 10, tokensSortie: 5,
    });
    expect(await prisma.item.count()).toBe(0);
  });

  it('laisse remonter une erreur passagère sans changer l\'état', async () => {
    const { id } = await creerCaptureTexte(prisma);
    await expect(traiterCapture(id, deps(new FauxProvider([new Error('HTTP 503')])))).rejects.toThrow('503');
    expect((await prisma.capture.findUniqueOrThrow({ where: { id } })).etat).toBe('en_file');
  });
});
