import { UnrecoverableError } from 'bullmq';
import type { PrismaClient } from '@organizer/db';
import { z } from 'zod';
import { chiffrer, dechiffrer } from '../chiffre.js';
import type { ClientCalendrier } from '../google/calendrier.js';
import { OctroiInvalide } from '../google/erreurs.js';
import { PORTEE_AGENDA, type ClientOAuth, type JetonsObtenus } from '../google/oauth.js';
import type { Jetons } from './jetons.js';

export const NOM_AGENDA = 'Organizer';

export interface DepsConnexion {
  prisma: PrismaClient;
  oauth: ClientOAuth;
  calendrier: ClientCalendrier;
  jetons: Jetons;
  cle: Buffer;
  enfilerBalayage(utilisateurId: string): Promise<void>;
  maintenant?: () => Date;
}

export type IssueEchange = 'connecte' | 'portee_refusee' | 'echange' | 'ignore';

const donneesEchange = z.object({ utilisateurId: z.uuid(), code: z.string().min(1), verificateur: z.string().min(1) });

async function echec(d: DepsConnexion, uid: string, erreur: 'portee_refusee' | 'echange'): Promise<void> {
  await d.prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'echec', erreur, jetonChiffre: null } });
}

/**
 * Échange le code reçu par l'API contre les jetons, vérifie la portée, crée (ou reprend) l'agenda dédié,
 * garde le jeton de rafraîchissement chiffré, puis enfile un balayage du compte. Le code n'est jamais journalisé.
 */
export async function echangerCode(j: { utilisateurId: string; code: string; verificateur: string }, d: DepsConnexion): Promise<IssueEchange> {
  // Données du job validées à l'entrée ; le message ne reprend rien de ce qu'on a reçu (code, vérificateur).
  const lu = donneesEchange.safeParse(j);
  if (!lu.success) throw new UnrecoverableError('Données de connexion invalides');
  const uid = lu.data.utilisateurId;
  const a = await d.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid }, include: { utilisateur: true } });
  if (!a || a.etat !== 'en_cours') return 'ignore';
  let t: JetonsObtenus;
  try {
    t = await d.oauth.echanger(lu.data.code, lu.data.verificateur);
  } catch (e) {
    if (!(e instanceof OctroiInvalide)) throw e;
    await echec(d, uid, 'echange');
    return 'echange';
  }
  if (!t.portees.includes(PORTEE_AGENDA) || !t.rafraichissement) {
    // Révoquer l'autorisation partielle : rien ne doit rester actif chez Google pour une connexion refusée.
    await d.oauth.revoquer(t.rafraichissement ?? t.acces).catch(() => undefined);
    const raison = t.portees.includes(PORTEE_AGENDA) ? 'echange' : 'portee_refusee';
    await echec(d, uid, raison);
    return raison;
  }
  // Le code est consommé : toute panne d'ici là ne se rejoue pas (un second échange échouerait). On révoque ce jeton
  // tout neuf, on note l'échec et on arrête les reprises ; L relance la connexion.
  try {
    let agenda = a.calendrierId;
    if (!agenda || !(await d.calendrier.agendaExiste(t.acces, agenda))) {
      agenda = await d.calendrier.creerAgenda(t.acces, NOM_AGENDA, a.utilisateur.fuseau);
    }
    const maintenant = (d.maintenant ?? (() => new Date()))();
    await d.prisma.agendaGoogle.update({
      where: { utilisateurId: uid },
      data: {
        etat: 'connecte', erreur: null, jetonChiffre: chiffrer(t.rafraichissement, d.cle, uid),
        calendrierId: agenda, connecteLe: maintenant, rafraichiLe: maintenant,
      },
    });
    d.jetons.retenir(uid, t.acces, t.expireDansS);
  } catch (e) {
    await d.oauth.revoquer(t.rafraichissement).catch(() => undefined);
    await echec(d, uid, 'echange').catch(() => undefined);
    throw new UnrecoverableError(`Connexion en échec après l'échange du code : ${e instanceof Error ? e.name : 'erreur'}`);
  }
  // Connexion faite : un enfilage en panne ne la défait pas, le balayage périodique rattrape.
  await d.enfilerBalayage(uid).catch((e: unknown) => console.error(`Agenda : balayage de connexion reporté (${(e as Error).name})`));
  return 'connecte';
}

/** Révoque chez Google puis efface le jeton. Panne de Google : l'erreur remonte, le job est repris. L'agenda reste. */
export async function deconnecterAgenda(uid: string, d: DepsConnexion): Promise<void> {
  const a = await d.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid } });
  if (!a || a.etat !== 'deconnexion') return;
  if (a.jetonChiffre) {
    let jeton: string | null = null;
    try {
      jeton = dechiffrer(a.jetonChiffre, d.cle, uid);
    } catch {
      jeton = null; // illisible (clé changée) : rien à révoquer d'ici
    }
    if (jeton) await d.oauth.revoquer(jeton);
  }
  d.jetons.oublier(uid);
  await d.prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnecte', jetonChiffre: null, erreur: null } });
}

/** Reprises épuisées : le jeton est effacé quand même ; l'administrateur est alerté (retrait manuel chez Google). */
export async function abandonnerDeconnexion(uid: string, d: Pick<DepsConnexion, 'prisma' | 'jetons'>): Promise<void> {
  d.jetons.oublier(uid);
  await d.prisma.agendaGoogle.updateMany({ where: { utilisateurId: uid, etat: 'deconnexion' }, data: { etat: 'deconnecte', jetonChiffre: null, erreur: null } });
}
