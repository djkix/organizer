import type { PrismaClient } from '@organizer/db';
import { dechiffrer } from '../chiffre.js';
import { JetonRefuse, OctroiInvalide } from '../google/erreurs.js';
import type { ClientOAuth } from '../google/oauth.js';

export type AlerteAgenda =
  | { type: 'autorisation_retiree'; utilisateurId: string }
  | { type: 'agenda_supprime'; utilisateurId: string };
export type Alerteur = (a: AlerteAgenda) => Promise<void>;

/** Alerte l'administrateur sans jamais changer l'issue : si le hook échoue, on note seulement le nom de l'erreur. */
export async function alerterSansEchec(alerter: Alerteur | undefined, a: AlerteAgenda): Promise<void> {
  if (!alerter) return;
  try {
    await alerter(a);
  } catch (e) {
    console.error(`Alerte agenda ${a.type} non envoyée : ${(e as Error).name}`);
  }
}

export class NonConnecte extends Error {
  override name = 'NonConnecte';
}

export class AutorisationRetiree extends Error {
  override name = 'AutorisationRetiree';
  constructor(readonly utilisateurId: string) {
    super(`Autorisation Google retirée ou expirée pour ${utilisateurId}`);
  }
}

/** Marge avant expiration d'un jeton d'accès (une heure chez Google) : on le renouvelle une minute avant. */
const MARGE_MS = 60_000;

/** Jetons d'accès en mémoire seulement ; le jeton de rafraîchissement reste chiffré en base, lu au besoin. */
export class Jetons {
  private readonly cache = new Map<string, { acces: string; expireA: number }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly oauth: Pick<ClientOAuth, 'rafraichir'>,
    private readonly cle: Buffer,
    private readonly maintenant: () => Date = () => new Date(),
    /** Câblé à la tâche 9. Appelé une fois par changement d'état de la connexion (revoque). */
    private readonly alerter?: Alerteur,
  ) {}

  retenir(uid: string, acces: string, expireDansS: number): void {
    this.cache.set(uid, { acces, expireA: this.maintenant().getTime() + expireDansS * 1000 });
  }

  oublier(uid: string): void {
    this.cache.delete(uid);
  }

  async acces(uid: string): Promise<string> {
    const c = this.cache.get(uid);
    if (c && c.expireA - MARGE_MS > this.maintenant().getTime()) return c.acces;
    return this.rafraichir(uid);
  }

  /**
   * Nouveau jeton d'accès. Jeton mort chez Google (invalid_grant), ou illisible (clé changée) : la connexion passe
   * en `revoque` et le jeton est effacé ; seule une reconnexion par L la rétablit.
   */
  async rafraichir(uid: string): Promise<string> {
    const a = await this.prisma.agendaGoogle.findUnique({ where: { utilisateurId: uid } });
    if (!a || a.etat !== 'connecte' || !a.jetonChiffre) throw new NonConnecte(uid);
    let r: { acces: string; expireDansS: number };
    try {
      let rafraichissement: string;
      try {
        rafraichissement = dechiffrer(a.jetonChiffre, this.cle, uid);
      } catch {
        throw new OctroiInvalide(0, 'jeton_illisible');
      }
      r = await this.oauth.rafraichir(rafraichissement);
    } catch (e) {
      if (!(e instanceof OctroiInvalide)) throw e;
      this.oublier(uid);
      const { count } = await this.prisma.agendaGoogle.updateMany({
        where: { utilisateurId: uid, etat: 'connecte' }, data: { etat: 'revoque', jetonChiffre: null, erreur: null },
      });
      if (count === 1) await alerterSansEchec(this.alerter, { type: 'autorisation_retiree', utilisateurId: uid });
      throw new AutorisationRetiree(uid);
    }
    this.retenir(uid, r.acces, r.expireDansS);
    await this.prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { rafraichiLe: this.maintenant() } });
    return r.acces;
  }
}

/** Un 401 de l'agenda : on oublie le jeton d'accès, on en obtient un neuf et on réessaie une fois. */
export async function appelerAvecJeton<T>(jetons: Jetons, uid: string, f: (jeton: string) => Promise<T>): Promise<T> {
  try {
    return await f(await jetons.acces(uid));
  } catch (e) {
    if (!(e instanceof JetonRefuse)) throw e;
    jetons.oublier(uid);
    return f(await jetons.rafraichir(uid));
  }
}
