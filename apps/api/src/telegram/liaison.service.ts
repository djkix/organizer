import { randomInt } from 'node:crypto';
import { Prisma, type PrismaClient } from '@organizer/db';

const VALIDITE_MS = 10 * 60_000;
const FENETRE_MS = 10 * 60_000;
/** Par chat : un intrus épuise son propre budget, jamais celui de l'utilisatrice qui tape son code. */
export const MAX_ECHECS_CHAT = 5;
/**
 * Tous chats confondus : plafond haut, contre une force brute répartie sur des comptes Telegram jetables.
 * L'atteindre demande au moins vingt chats : un seul intrus ne bloque plus la liaison de personne.
 */
export const MAX_ECHECS_TOTAL = 100;

/** Chat privé Telegram : identifiant positif ; les groupes (négatifs) sont refusés. */
export const chatPriveValide = (chat: string): boolean => /^\d{1,19}$/.test(chat);

export class LiaisonService {
  constructor(private readonly prisma: PrismaClient, private readonly maintenant: () => Date = () => new Date()) {}

  async purgerCodesExpires(): Promise<number> {
    const { count } = await this.prisma.codeLiaison.deleteMany({ where: { expireLe: { lte: this.maintenant() } } });
    return count;
  }

  async creerCode(nom: string): Promise<string> {
    const u = await this.prisma.utilisateur.findUniqueOrThrow({ where: { nom } });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.codeLiaison.create({
      data: { code, utilisateurId: u.id, expireLe: new Date(this.maintenant().getTime() + VALIDITE_MS) },
    });
    return code;
  }

  /** Échecs récents par chat, et tous chats confondus : bornent la force brute sur un code à six chiffres. */
  private echecsParChat = new Map<number, number[]>();
  private echecsTotal: number[] = [];

  private bloque(chatId: number): boolean {
    const limite = this.maintenant().getTime() - FENETRE_MS;
    this.echecsTotal = this.echecsTotal.filter((t) => t > limite);
    const duChat = (this.echecsParChat.get(chatId) ?? []).filter((t) => t > limite);
    if (duChat.length > 0) this.echecsParChat.set(chatId, duChat);
    else this.echecsParChat.delete(chatId);
    return duChat.length >= MAX_ECHECS_CHAT || this.echecsTotal.length >= MAX_ECHECS_TOTAL;
  }

  private echec(chatId: number): 'invalide' {
    const t = this.maintenant().getTime();
    this.echecsTotal.push(t);
    this.echecsParChat.set(chatId, [...(this.echecsParChat.get(chatId) ?? []), t]);
    if (this.echecsParChat.size > 10_000) {
      for (const [chat, liste] of this.echecsParChat) if (!liste.some((x) => x > t - FENETRE_MS)) this.echecsParChat.delete(chat);
    }
    return 'invalide';
  }

  async lier(code: string, chatId: number): Promise<'lie' | 'invalide'> {
    if (this.bloque(chatId)) return 'invalide';
    const c = await this.prisma.codeLiaison.findUnique({ where: { code } });
    if (!c || c.expireLe <= this.maintenant()) return this.echec(chatId);
    const chat = BigInt(chatId);
    try {
      const ok = await this.prisma.$transaction(async (tx) => {
        const u = await tx.utilisateur.findUniqueOrThrow({ where: { id: c.utilisateurId } });
        // Jamais d'écrasement : un compte déjà lié à un autre chat se délie par la CLI.
        if (u.telegramChatId !== null && u.telegramChatId !== chat) return false;
        // Le perdant d'une course sur le même code ne supprime rien et reçoit « invalide ».
        const { count } = await tx.codeLiaison.deleteMany({ where: { code } });
        if (count === 0) return false;
        await tx.utilisateur.update({ where: { id: u.id }, data: { telegramChatId: chat } });
        return true;
      });
      return ok ? 'lie' : this.echec(chatId);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2002' || e.code === 'P2025')) return this.echec(chatId);
      throw e;
    }
  }

  /** Liaison par l'administrateur, sans code : avant la bascule, aucun vocal ne peut tomber sur un chat non lié. */
  async lierDirectement(nom: string, chat: bigint): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.utilisateur.findUnique({ where: { nom } });
      if (!u) throw new Error('Compte introuvable.');
      if (u.telegramChatId === chat) return;
      if (u.telegramChatId !== null) throw new Error('Ce compte est déjà lié à un autre chat : delier d\'abord.');
      if (await tx.utilisateur.findUnique({ where: { telegramChatId: chat } })) throw new Error('Ce chat est déjà lié à un autre compte.');
      await tx.utilisateur.update({ where: { id: u.id }, data: { telegramChatId: chat } });
    });
  }

  async delier(nom: string): Promise<void> {
    await this.prisma.utilisateur.update({ where: { nom }, data: { telegramChatId: null } });
  }

  utilisateurDuChat(chatId: number): Promise<{ id: string } | null> {
    return this.prisma.utilisateur.findUnique({ where: { telegramChatId: BigInt(chatId) }, select: { id: true } });
  }
}
