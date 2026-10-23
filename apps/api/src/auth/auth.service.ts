import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { PrismaClient } from '@organizer/db';
import type { ProfilGoogle } from './google.js';

const DUREE_SESSION_MS = 90 * 24 * 3600_000;

export interface UtilisateurSession { id: string; nom: string; fuseau: string; admin: boolean }

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

  /** Connexion par Google : seule une adresse vérifiée, reliée par l'administrateur, ouvre une session. */
  async ouvrirSessionGoogle(profil: ProfilGoogle): Promise<{ jeton: string; expireLe: Date } | null> {
    if (!profil.emailVerifie) return null;
    const u = await this.prisma.utilisateur.findUnique({ where: { googleEmail: profil.email.toLowerCase() } });
    if (!u) return null;
    if (u.googleSub === null) {
      try {
        await this.prisma.utilisateur.update({ where: { id: u.id }, data: { googleSub: profil.sub } });
      } catch (err) {
        // Ce sub appartient déjà à un autre compte.
        if ((err as { code?: string }).code === 'P2002') return null;
        throw err;
      }
    } else if (u.googleSub !== profil.sub) {
      return null;
    }
    return this.ouvrirSessionPour(u.id);
  }

  /** Relie une adresse Google au compte ; le sub est mémorisé au premier passage. */
  async lierGoogle(nom: string, adresse: string): Promise<void> {
    try {
      await this.prisma.utilisateur.update({ where: { nom }, data: { googleEmail: adresse.toLowerCase(), googleSub: null } });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'P2025') throw new Error('Compte introuvable.');
      if (code === 'P2002') throw new Error('Adresse déjà reliée à un autre compte.');
      throw err;
    }
  }

  async delierGoogle(nom: string): Promise<void> {
    try {
      // Délier ferme aussi les sessions : un compte Google compromis ne garde aucune porte ouverte.
      await this.prisma.$transaction([
        this.prisma.utilisateur.update({ where: { nom }, data: { googleEmail: null, googleSub: null } }),
        this.prisma.session.deleteMany({ where: { utilisateur: { nom } } }),
      ]);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2025') throw new Error('Compte introuvable.');
      throw err;
    }
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
    return { id: s.utilisateur.id, nom: s.utilisateur.nom, fuseau: s.utilisateur.fuseau, admin: s.utilisateur.admin };
  }

  async fermerSession(jeton: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { jetonHash: empreinte(jeton) } });
  }
}
