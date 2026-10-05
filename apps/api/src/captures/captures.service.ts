import { Prisma, type PrismaClient } from '@organizer/db';
import type { StockageAudio } from '../ingestion/stockage.js';
import { FORMATS_ACCEPTES, FormatRefuse, IdentifiantRefuse, type DepotPrive } from '../privees/privees.service.js';
import type { Reencodeur } from '../privees/reencodeur.js';

/** Ce que le dépôt ordinaire demande à l'ingestion : la finalisation et l'enfilage des vocaux Telegram, inchangés. */
export interface Finalisation {
  finaliser(id: string): Promise<void>;
}

/** Capture vocale ordinaire déposée depuis la PWA (lot 2-B) : classée par Gemini comme un vocal Telegram. */
export class CapturesOrdinairesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stockage: StockageAudio,
    private readonly reencodeur: Reencodeur,
    private readonly ingestion: Finalisation,
    private readonly journal: (message: string) => void = (m) => console.error(m),
  ) {}

  async enregistrer(utilisateurId: string, d: DepotPrive): Promise<{ id: string; nouvelle: boolean }> {
    if (!FORMATS_ACCEPTES.includes(d.mime)) throw new FormatRefuse(d.mime);
    const existante = await this.prisma.capture.findUnique({ where: { id: d.id }, select: { prive: true } });
    // Un identifiant privé ne devient jamais ordinaire : ni envoi à Gemini, ni rejeu qui l'y conduirait.
    if (existante?.prive) throw new IdentifiantRefuse(d.id);
    if (existante) {
      await this.finaliser(d.id);
      return { id: d.id, nouvelle: false };
    }
    const opus = await this.reencodeur.versOpus(d.donnees);
    const audioPath = await this.stockage.ecrire(d.id, d.emisLe, opus, 'ogg', 'ordinaire');
    try {
      await this.prisma.capture.create({
        data: {
          id: d.id, utilisateurId, canal: 'pwa', prive: false, etat: 'recue',
          audioPath, audioMime: 'audio/ogg', dureeS: d.dureeS, emisLe: d.emisLe,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { id: d.id, nouvelle: false };
      throw e;
    }
    await this.finaliser(d.id);
    return { id: d.id, nouvelle: true };
  }

  /** La capture existe et son audio est rangé : un échec d'enfilage ne perd rien, la reprise périodique s'en charge. */
  private async finaliser(id: string): Promise<void> {
    try {
      await this.ingestion.finaliser(id);
    } catch (e) {
      this.journal(`Capture ${id} : enfilage reporté (${(e as Error).name})`);
    }
  }
}
