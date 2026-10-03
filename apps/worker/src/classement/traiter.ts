import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@organizer/db';
import { isoLocal, jourSemaine, rendrePrompt, type Prompt } from '@organizer/shared';
import { SortieNonConforme, type ClassificationProvider, type ResultatClassement } from './provider.js';

export interface DepsTraitement {
  prisma: PrismaClient;
  provider: ClassificationProvider;
  prompt: Prompt;
  audioRacine: string;
  maintenant?: () => Date;
}

export type Issue = 'classee' | 'a_revoir' | 'deja_traitee';

export class CapturePriveeRefusee extends Error {
  override name = 'CapturePriveeRefusee';
}

const dateOuNull = (s: string | null): Date | null => (s ? new Date(s) : null);

export async function traiterCapture(id: string, d: DepsTraitement): Promise<Issue> {
  const c = await d.prisma.capture.findUniqueOrThrow({ where: { id }, include: { utilisateur: true } });
  // Première vérification, avant toute lecture d'audio : règle n° 6.
  if (c.prive) throw new CapturePriveeRefusee(`Capture ${id} privée : jamais envoyée`);
  if (c.etat === 'classee' || c.etat === 'a_revoir') return 'deja_traitee';

  const audio = c.audioPath
    ? { mime: c.audioMime ?? 'audio/ogg', donnees: await readFile(join(d.audioRacine, c.audioPath)) }
    : undefined;
  if (!audio && !c.texteEcrit) throw new Error(`Capture ${id} sans audio ni texte`);

  const fuseau = c.utilisateur.fuseau;
  const systeme = rendrePrompt(d.prompt.systeme, {
    emis_le: isoLocal(c.emisLe, fuseau),
    jour_semaine: jourSemaine(c.emisLe, fuseau),
    fuseau,
    themes_connus: (await d.prisma.theme.findMany({ orderBy: { libelle: 'asc' }, select: { libelle: true } })).map((t) => t.libelle),
    prenoms_connus: (await d.prisma.$queryRaw<{ prenom: string }[]>`SELECT DISTINCT unnest(personnes) AS prenom FROM item ORDER BY 1`).map((r) => r.prenom),
    exemples: '',
  });

  let r: ResultatClassement;
  try {
    r = await d.provider.classer({ systeme, audio, texte: audio ? undefined : (c.texteEcrit ?? undefined) });
  } catch (e) {
    if (!(e instanceof SortieNonConforme)) throw e;
    await d.prisma.capture.update({
      where: { id }, data: { etat: 'a_revoir', erreur: 'sortie_non_conforme', versionPrompt: d.prompt.version },
    });
    return 'a_revoir';
  }

  await enregistrer(d.prisma, id, r, d.prompt.version, (d.maintenant ?? (() => new Date()))());
  return 'classee';
}

/** Réécrit tous les items de la capture d'un bloc : un rejeu ne double rien. */
async function enregistrer(p: PrismaClient, captureId: string, r: ResultatClassement, version: string, maintenant: Date): Promise<void> {
  await p.$transaction(async (tx) => {
    await tx.item.deleteMany({ where: { captureId } });
    for (const it of r.sortie.items) {
      const theme = it.theme
        ? await tx.theme.upsert({ where: { libelle: it.theme }, create: { libelle: it.theme }, update: {} })
        : null;
      await tx.item.create({
        data: {
          captureId,
          position: it.position,
          texte: it.texte,
          nature: it.nature,
          confiance: { nature: it.confiance.nature, echeance: it.confiance.echeance, theme: it.confiance.theme },
          themeId: theme?.id ?? null,
          personnes: it.personnes,
          versionPrompt: version,
          modele: r.modele,
          action: it.nature === 'action' ? {
            create: {
              echeanceType: it.echeance_type,
              echeanceExpr: it.echeance_expr,
              echeanceDate: dateOuNull(it.echeance_date),
              fenetreDebut: dateOuNull(it.fenetre_debut),
              fenetreFin: dateOuNull(it.fenetre_fin),
              importance: it.importance,
              effort: it.effort,
              contexte: it.contexte,
              alarme: it.alarme === true,
              alarmeExpr: it.alarme_expr,
            },
          } : undefined,
          pensee: it.nature === 'pensee' ? { create: { tonalite: it.tonalite } } : undefined,
        },
      });
    }
    await tx.capture.update({
      where: { id: captureId },
      data: {
        texteBrut: r.sortie.transcription, etat: 'classee', erreur: null, versionPrompt: version,
        modele: r.modele, tokensEntree: r.tokensEntree, tokensSortie: r.tokensSortie, classeLe: maintenant,
      },
    });
  });
}
