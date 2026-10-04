const GO = 1024 ** 3;

export interface Mesures {
  enAttente: number;
  echecsHeure: number;
  audioOctets: number;
  baseOctets: number;
  latenceMoyenneS: number | null;
  derniereCapture: Date | null;
}

/** Seuils du cahier (section Supervision) ; audio à 30 Go tant que la rotation du lot 2 n'existe pas. */
export const SEUILS = {
  enAttente: 50, echecsHeure: 3, audioOctets: 30 * GO, baseOctets: 8 * GO, latenceS: 120, silenceJours: 10,
} as const;

export interface Constat { cle: string; message: string }

/** Messages techniques, pour l'administrateur seul : jamais de contenu de capture. */
export function constater(m: Mesures, maintenant: Date, s: typeof SEUILS = SEUILS): Constat[] {
  const c: Constat[] = [];
  if (m.enAttente > s.enAttente) c.push({ cle: 'file', message: `File de classement : ${m.enAttente} captures en attente.` });
  if (m.echecsHeure > s.echecsHeure) c.push({ cle: 'echecs', message: `${m.echecsHeure} classements en échec depuis une heure.` });
  if (m.audioOctets > s.audioOctets) c.push({ cle: 'audio', message: `Audio : ${Math.round(m.audioOctets / GO)} Go. La rotation arrive au lot 2.` });
  if (m.baseOctets > s.baseOctets) c.push({ cle: 'base', message: `Base : ${Math.round(m.baseOctets / GO)} Go, au-delà de 8 Go.` });
  if (m.latenceMoyenneS !== null && m.latenceMoyenneS > s.latenceS) {
    c.push({ cle: 'latence', message: `Classement lent : ${Math.round(m.latenceMoyenneS)} s en moyenne sur une heure.` });
  }
  if (m.derniereCapture && maintenant.getTime() - m.derniereCapture.getTime() > s.silenceJours * 86_400_000) {
    c.push({ cle: 'silence', message: 'Information : aucune capture depuis 10 jours.' });
  }
  return c;
}

/** Une alerte par constat ; elle ne revient qu'après un retour à la normale. Rien n'est envoyé à L. */
export class Veille {
  private readonly actifs = new Set<string>();

  constructor(
    private readonly mesurer: () => Promise<Mesures>,
    private readonly alerter: (message: string) => Promise<void>,
    private readonly maintenant: () => Date = () => new Date(),
  ) {}

  async passer(): Promise<string[]> {
    const constats = constater(await this.mesurer(), this.maintenant());
    const envoyees: string[] = [];
    for (const c of constats) {
      if (this.actifs.has(c.cle)) continue;
      try {
        await this.alerter(c.message);
        this.actifs.add(c.cle);
        envoyees.push(c.message);
      } catch (e) {
        console.error(`Alerte de veille impossible (${(e as Error).name})`);
      }
    }
    const presents = new Set(constats.map((c) => c.cle));
    for (const cle of [...this.actifs]) if (!presents.has(cle)) this.actifs.delete(cle);
    return envoyees;
  }
}
