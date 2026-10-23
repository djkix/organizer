import { Controller, Get, HttpCode, Inject, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@organizer/db';
import type { ReponseSauvegarde } from '@organizer/shared';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { PRISMA } from '../jetons.js';

/**
 * Sauvegarde à la demande, pour l'administrateur seul (404 pour un autre compte). L'API n'écrit qu'une demande :
 * le service sauvegarde la prend dans les 5 minutes (infra/sauvegarde/planifier.sh).
 */
@Controller('api/sauvegarde')
@UseGuards(SessionGuard)
export class SauvegardeController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private exigerAdmin(req: RequeteAuthentifiee): void {
    if (!req.utilisateur.admin) throw new NotFoundException('Introuvable.');
  }

  @Get()
  async etat(@Req() req: RequeteAuthentifiee): Promise<ReponseSauvegarde> {
    this.exigerAdmin(req);
    const reussie = await this.prisma.sauvegarde.findFirst({ where: { reussie: true }, orderBy: { fin: 'desc' }, select: { fin: true } });
    return { derniereReussie: reussie ? reussie.fin.toISOString() : null, demandee: (await this.prisma.demandeSauvegarde.count()) > 0 };
  }

  @Post('demande')
  @HttpCode(204)
  async demander(@Req() req: RequeteAuthentifiee): Promise<void> {
    this.exigerAdmin(req);
    // Deux appuis ne font qu'une sauvegarde.
    if ((await this.prisma.demandeSauvegarde.count()) === 0) await this.prisma.demandeSauvegarde.create({ data: {} });
  }
}
