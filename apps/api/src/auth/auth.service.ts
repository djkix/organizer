import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { PrismaClient } from '@organizer/db';

const DUREE_SESSION_MS = 90 * 24 * 3600_000;

export interface UtilisateurSession { id: string; nom: string; fuseau: string }

const empreinte = (jeton: string): string => createHash('sha256').update(jeton).digest('hex');

// Haché factice : un compte inconnu coûte le même temps qu'un mauvais mot de passe.
let hacheFactice: Promise<string> | undefined;
const factice = (): Promise<string> => (hacheFactice ??= hash('organizer-compte-inexistant'));

export class AuthService {
  constructor(private readonly prisma: PrismaClient, readonly maintenant: () => Date = () => new Date()) {}

  async definirMotDePasse(nom: string, motDePasse: string): Promise<void> {
    if (motDePasse.length < 12) throw new Error('Mot de passe trop court : 12 caractères minimum.');
    const motDePasseHash = await hash(motDePasse);
    try {
      // Changer le mot de passe révoque toutes les sessions du compte.
      await this.prisma.$transaction([
        this.prisma.utilisateur.update({ where: { nom }, data: { motDePasseHash } }),
        this.prisma.session.deleteMany({ where: { utilisateur: { nom } } }),
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') throw new Error('Compte introuvable.');
      throw err;
    }
  }

  /** Sessions expirées : jamais gardées. Renvoie le nombre supprimé. */
  async purgerExpirees(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({ where: { expireLe: { lte: this.maintenant() } } });
    return count;
  }

  async ouvrirSession(nom: string, motDePasse: string): Promise<{ jeton: string; expireLe: Date } | null> {
    const u = await this.prisma.utilisateur.findUnique({ where: { nom } });
    const ok = await verify(u?.motDePasseHash ?? (await factice()), motDePasse);
    if (!u?.motDePasseHash || !ok) return null;
    return this.ouvrirSessionPour(u.id);
  }

  /** Session de 90 jours d'un compte déjà authentifié, par mot de passe ou par empreinte. */
  async ouvrirSessionPour(utilisateurId: string): Promise<{ jeton: string; expireLe: Date }> {
    const jeton = randomBytes(32).toString('base64url');
    const expireLe = new Date(this.maintenant().getTime() + DUREE_SESSION_MS);
    await this.prisma.session.create({ data: { jetonHash: empreinte(jeton), utilisateurId, expireLe } });
    return { jeton, expireLe };
  }

  async utilisateurDeSession(jeton: string): Promise<UtilisateurSession | null> {
    const s = await this.prisma.session.findUnique({ where: { jetonHash: empreinte(jeton) }, include: { utilisateur: true } });
    if (!s || s.expireLe <= this.maintenant()) return null;
    return { id: s.utilisateur.id, nom: s.utilisateur.nom, fuseau: s.utilisateur.fuseau };
  }

  async fermerSession(jeton: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { jetonHash: empreinte(jeton) } });
  }
}
