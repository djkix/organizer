import { randomInt } from 'node:crypto';
import { Prisma, type PrismaClient } from '@organizer/db';

const VALIDITE_MS = 10 * 60_000;

export class LiaisonService {
  constructor(private readonly prisma: PrismaClient, private readonly maintenant: () => Date = () => new Date()) {}

  async creerCode(nom: string): Promise<string> {
    const u = await this.prisma.utilisateur.findUniqueOrThrow({ where: { nom } });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.codeLiaison.create({
      data: { code, utilisateurId: u.id, expireLe: new Date(this.maintenant().getTime() + VALIDITE_MS) },
    });
    return code;
  }

  async lier(code: string, chatId: number): Promise<'lie' | 'invalide'> {
    const c = await this.prisma.codeLiaison.findUnique({ where: { code } });
    if (!c || c.expireLe <= this.maintenant()) return 'invalide';
    try {
      await this.prisma.$transaction([
        this.prisma.utilisateur.update({ where: { id: c.utilisateurId }, data: { telegramChatId: BigInt(chatId) } }),
        this.prisma.codeLiaison.delete({ where: { code } }),
      ]);
      return 'lie';
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 'invalide';
      throw e;
    }
  }

  utilisateurDuChat(chatId: number): Promise<{ id: string } | null> {
    return this.prisma.utilisateur.findUnique({ where: { telegramChatId: BigInt(chatId) }, select: { id: true } });
  }
}
