import { Controller, Get, HttpCode, Inject, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@organizer/db';
import type { ReponseAlertes } from '@organizer/shared';
import { SessionGuard, type RequeteAuthentifiee } from '../auth/session.guard.js';
import { PRISMA } from '../jetons.js';

const JOURS = 30;
const MAX = 50;

/** Alertes techniques, pour l'administrateur seul : pour un autre compte, ces routes n'existent pas (404). */
@Controller('api/alertes')
@UseGuards(SessionGuard)
export class AlertesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private exigerAdmin(req: RequeteAuthentifiee): void {
    if (!req.utilisateur.admin) throw new NotFoundException('Introuvable.');
  }

  @Get()
  async lister(@Req() req: RequeteAuthentifiee): Promise<ReponseAlertes> {
    this.exigerAdmin(req);
    const depuis = new Date(Date.now() - JOURS * 86_400_000);
    const alertes = await this.prisma.alerte.findMany({ where: { creeLe: { gte: depuis } }, orderBy: [{ creeLe: 'desc' }, { id: 'asc' }], take: MAX });
    return {
      alertes: alertes.map((a) => ({ id: a.id, message: a.message, creeLe: a.creeLe.toISOString(), vue: a.vueLe !== null })),
      nonVues: alertes.some((a) => a.vueLe === null),
    };
  }

  @Post('vues')
  @HttpCode(204)
  async marquerVues(@Req() req: RequeteAuthentifiee): Promise<void> {
    this.exigerAdmin(req);
    await this.prisma.alerte.updateMany({ where: { vueLe: null }, data: { vueLe: new Date() } });
  }
}
