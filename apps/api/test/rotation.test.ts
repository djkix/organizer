import { chmodSync, mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RotationAudio } from '../src/rotation.js';

const prisma = creerPrisma();
const MAINTENANT = new Date('2026-12-15T12:00:00Z');
const SEUILS = { haut: 400, bas: 250, ageJours: 30 };
let racine: string;
let compte: string;
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await viderBase(prisma);
  racine = mkdtempSync(join(tmpdir(), 'rotation-'));
  mkdirSync(join(racine, 'ordinaire'));
  mkdirSync(join(racine, 'prive'));
  compte = (await prisma.utilisateur.create({ data: { nom: 'test' } })).id;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

/** Une capture et son fichier de `octets` octets ; `fichier: false` : la base le cite, le disque ne l'a plus. */
async function audio(o: { nom: string; octets: number; emisLe: string; prive?: boolean; texte?: boolean; etat?: 'classee' | 'en_file' | 'a_revoir' | 'privee'; fichier?: boolean }) {
  const chemin = `${o.prive ? 'prive' : 'ordinaire'}/${o.nom}.oga`;
  if (o.fichier !== false) writeFileSync(join(racine, chemin), Buffer.alloc(o.octets));
  return prisma.capture.create({
    data: {
      utilisateurId: compte, canal: 'pwa', prive: o.prive ?? false, etat: o.etat ?? (o.prive ? 'privee' : 'classee'),
      emisLe: new Date(o.emisLe), audioPath: chemin, audioMime: 'audio/ogg', texteBrut: o.prive || o.texte === false ? null : 'texte fabriqué',
    },
  });
}
const rotation = (alerter = vi.fn(async () => {})) => ({ r: new RotationAudio(prisma, racine, alerter, SEUILS, () => MAINTENANT), alerter });
const purgee = async (id: string) => (await prisma.capture.findUniqueOrThrow({ where: { id } })).audioPath === null;

describe('rotation de l\'audio ordinaire', () => {
  it('sous le seuil haut : rien ne bouge', async () => {
    const a = await audio({ nom: 'a', octets: 300, emisLe: '2026-09-01T08:00:00Z' });
    const { r } = rotation();
    expect(await r.passer()).toEqual({ purges: 0, liberes: 0 });
    expect(await purgee(a.id)).toBe(false);
  });

  it('au-dessus : les plus anciennes éligibles d\'abord, jusqu\'au seuil bas ; fichier supprimé, capture marquée', async () => {
    const vieille = await audio({ nom: 'vieille', octets: 150, emisLe: '2026-08-01T08:00:00Z' });
    const moyenne = await audio({ nom: 'moyenne', octets: 150, emisLe: '2026-09-01T08:00:00Z' });
    const recente = await audio({ nom: 'recente', octets: 150, emisLe: '2026-10-01T08:00:00Z' });
    const { r } = rotation();
    expect(await r.passer()).toEqual({ purges: 2, liberes: 300 });
    expect(await purgee(vieille.id)).toBe(true);
    expect(await purgee(moyenne.id)).toBe(true);
    expect(await purgee(recente.id)).toBe(false);
    expect(existsSync(join(racine, 'ordinaire/vieille.oga'))).toBe(false);
    const c = await prisma.capture.findUniqueOrThrow({ where: { id: vieille.id } });
    expect(c.audioPurgeLe?.toISOString()).toBe(MAINTENANT.toISOString());
    expect(c.texteBrut).toBe('texte fabriqué');
  });

  it('jamais une capture privée, sans texte, en file ou de moins de 30 jours ; alerte une seule fois par épisode', async () => {
    const privee = await audio({ nom: 'p', octets: 200, emisLe: '2026-07-01T08:00:00Z', prive: true });
    const sansTexte = await audio({ nom: 's', octets: 200, emisLe: '2026-07-01T08:00:00Z', texte: false, etat: 'a_revoir' });
    const enFile = await audio({ nom: 'f', octets: 200, emisLe: '2026-07-01T08:00:00Z', etat: 'en_file' });
    const jeune = await audio({ nom: 'j', octets: 200, emisLe: '2026-12-01T08:00:00Z' });
    const { r, alerter } = rotation();
    expect(await r.passer()).toEqual({ purges: 0, liberes: 0 });
    for (const c of [privee, sansTexte, enFile, jeune]) expect(await purgee(c.id)).toBe(false);
    expect(existsSync(join(racine, 'prive/p.oga'))).toBe(true);
    await r.passer();
    expect(alerter).toHaveBeenCalledTimes(1);
    expect(alerter.mock.calls[0]).toEqual(['Audio au-delà du seuil de rotation, rien de plus à purger.']);
  });

  it('fichier déjà absent du disque : la capture est marquée quand même, sans planter', async () => {
    await audio({ nom: 'gros', octets: 500, emisLe: '2026-12-10T08:00:00Z' });
    const fantome = await audio({ nom: 'fantome', octets: 100, emisLe: '2026-08-01T08:00:00Z', fichier: false });
    const vieille = await audio({ nom: 'vieille', octets: 100, emisLe: '2026-09-01T08:00:00Z' });
    const { r } = rotation();
    await r.passer();
    expect(await purgee(fantome.id)).toBe(true);
    expect(await purgee(vieille.id)).toBe(true);
  });

  it('un fichier impossible à supprimer est sauté, sans boucle sans fin ; la capture garde son audio', async () => {
    mkdirSync(join(racine, 'ordinaire', 'bloque'));
    writeFileSync(join(racine, 'ordinaire', 'bloque', 'b.oga'), Buffer.alloc(300));
    const bloquee = await prisma.capture.create({ data: { utilisateurId: compte, canal: 'pwa', prive: false, etat: 'classee', emisLe: new Date('2026-07-01T08:00:00Z'), audioPath: 'ordinaire/bloque/b.oga', texteBrut: 'x' } });
    const vieille = await audio({ nom: 'v', octets: 200, emisLe: '2026-08-01T08:00:00Z' });
    chmodSync(join(racine, 'ordinaire', 'bloque'), 0o500);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { r } = rotation();
      await r.passer();
      expect(await purgee(bloquee.id)).toBe(false);
      expect(await purgee(vieille.id)).toBe(true);
    } finally {
      chmodSync(join(racine, 'ordinaire', 'bloque'), 0o700);
    }
  });

  it('deux passages simultanés : le second ne fait rien (pas de purge au-delà du seuil bas)', async () => {
    for (const n of ['a', 'b', 'c', 'd']) await audio({ nom: n, octets: 150, emisLe: `2026-0${['5', '6', '7', '8'][['a', 'b', 'c', 'd'].indexOf(n)]}-01T08:00:00Z` });
    const { r } = rotation();
    const [x, y] = await Promise.all([r.passer(), r.passer()]);
    expect(x.purges + y.purges).toBe(3);
    expect([x.purges, y.purges]).toContain(0);
  });
});
