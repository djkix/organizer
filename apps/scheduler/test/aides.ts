import type { PrismaClient } from '@organizer/db';
import { Jetons } from '../src/agenda/jetons.js';
import type { DepsSynchro } from '../src/agenda/synchroniser.js';
import { chiffrer } from '../src/chiffre.js';
import type { ConfigGoogle } from '../src/configuration.js';
import { ClientCalendrier } from '../src/google/calendrier.js';
import { ClientOAuth } from '../src/google/oauth.js';
import { SECRET_ESSAI, type FauxGoogle } from './faux-google.js';

export const CLE = Buffer.alloc(32, 3);
export const MAINTENANT = new Date('2026-10-10T08:00:00Z');

export const CONFIG_GOOGLE = (faux: FauxGoogle): ConfigGoogle => ({
  clientId: 'id.apps.googleusercontent.com', clientSecret: SECRET_ESSAI, redirectUri: 'https://organizer.essai/api/agenda/retour',
  baseOauth: faux.url, baseCalendrier: `${faux.url}/calendar/v3`,
});

/** Compte fabriqué, connecté : jeton de rafraîchissement chiffré en base, agenda existant chez le faux Google. */
export async function compteConnecte(prisma: PrismaClient, faux: FauxGoogle, nom = 'l'): Promise<{ uid: string; agenda: string }> {
  const u = await prisma.utilisateur.create({ data: { nom } });
  const rafr = `rafr-${nom}`;
  faux.connecte(rafr);
  const agenda = faux.agenda(`agenda-${nom}@group.calendar.google.com`);
  await prisma.agendaGoogle.create({
    data: { utilisateurId: u.id, etat: 'connecte', jetonChiffre: chiffrer(rafr, CLE, u.id), calendrierId: agenda, connecteLe: MAINTENANT, rafraichiLe: MAINTENANT },
  });
  return { uid: u.id, agenda };
}

/** Action fabriquée d'une capture Telegram ordinaire ; par défaut un rendez-vous daté le 14 octobre à 10:00. */
export async function actionDatee(
  prisma: PrismaClient, uid: string,
  o: { texte?: string; date?: string | null; type?: string; alarme?: boolean; nature?: 'action' | 'pensee'; prive?: boolean } = {},
): Promise<string> {
  const c = await prisma.capture.create({
    data: { utilisateurId: uid, canal: 'telegram', prive: o.prive ?? false, etat: 'classee', emisLe: MAINTENANT, texteEcrit: 'x' },
  });
  const it = await prisma.item.create({
    data: {
      captureId: c.id, position: 1, texte: o.texte ?? 'dentiste', nature: o.nature ?? 'action',
      confiance: { nature: 0.9, echeance: 0.9, theme: 0.9 }, personnes: [], versionPrompt: 'tri/v1', modele: 'test',
      action: {
        create: {
          echeanceType: o.type ?? 'datee', alarme: o.alarme ?? false,
          echeanceDate: o.date === null ? null : new Date(o.date ?? '2026-10-14T08:00:00Z'),
        },
      },
    },
  });
  return it.id;
}

export function depsSynchro(prisma: PrismaClient, faux: FauxGoogle, maintenant: () => Date = () => MAINTENANT): DepsSynchro & { jetons: Jetons; oauth: ClientOAuth } {
  const oauth = new ClientOAuth(CONFIG_GOOGLE(faux), fetch);
  return { prisma, oauth, calendrier: new ClientCalendrier(`${faux.url}/calendar/v3`, fetch), jetons: new Jetons(prisma, oauth, CLE, maintenant), maintenant };
}
