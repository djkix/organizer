import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@organizer/db';
import type { Queue } from 'bullmq';
import type { Mesures } from './veille.js';

/** Taille d'un dossier, sous-dossiers compris ; 0 s'il n'existe pas. */
export async function tailleDossier(dossier: string): Promise<number> {
  let entrees;
  try {
    entrees = await readdir(dossier, { recursive: true, withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw e;
  }
  let total = 0;
  for (const e of entrees) if (e.isFile()) total += (await stat(join(e.parentPath, e.name))).size;
  return total;
}

export async function mesurer(d: { prisma: PrismaClient; file: Queue; audioRacine: string; maintenant?: () => Date }): Promise<Mesures> {
  const maintenant = (d.maintenant ?? (() => new Date()))();
  const depuis = new Date(maintenant.getTime() - 3600_000);
  const comptes = await d.file.getJobCounts('waiting', 'delayed', 'prioritized', 'paused');
  const echecs = await d.file.getFailed(0, 499);
  const [base] = await d.prisma.$queryRaw<{ taille: bigint }[]>`SELECT pg_database_size(current_database()) AS taille`;
  const [latence] = await d.prisma.$queryRaw<{ moyenne: number | null }[]>`
    SELECT avg(extract(epoch FROM classe_le - recu_le))::float8 AS moyenne FROM capture WHERE classe_le > (${depuis}::timestamptz AT TIME ZONE 'UTC')`;
  const derniere = await d.prisma.capture.findFirst({ orderBy: { recuLe: 'desc' }, select: { recuLe: true } });
  return {
    enAttente: Object.values(comptes).reduce((a, b) => a + b, 0),
    echecsHeure: echecs.filter((j) => (j.finishedOn ?? 0) > depuis.getTime()).length,
    audioOctets: await tailleDossier(d.audioRacine),
    baseOctets: Number(base?.taille ?? 0),
    latenceMoyenneS: latence?.moyenne ?? null,
    derniereCapture: derniere?.recuLe ?? null,
  };
}

export function formaterMesures(m: Mesures): string {
  const go = (o: number): string => `${(o / 1024 ** 3).toFixed(2)} Go`;
  return [
    `en attente : ${m.enAttente}`,
    `échecs depuis une heure : ${m.echecsHeure}`,
    `audio : ${go(m.audioOctets)}`,
    `base : ${go(m.baseOctets)}`,
    `latence moyenne sur une heure : ${m.latenceMoyenneS === null ? '-' : `${Math.round(m.latenceMoyenneS)} s`}`,
    `dernière capture : ${m.derniereCapture?.toISOString() ?? '-'}`,
  ].join('\n');
}
