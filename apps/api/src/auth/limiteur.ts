/** Fenêtre glissante en mémoire : un seul processus API. Un refus ne compte pas comme un appel. */
export class LimiteurDebit {
  private readonly appels = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly fenetreMs: number,
    private readonly maintenant: () => number = Date.now,
  ) {}

  autoriser(cle: string): boolean {
    const t = this.maintenant();
    const debut = t - this.fenetreMs;
    const recents = (this.appels.get(cle) ?? []).filter((x) => x > debut);
    if (recents.length >= this.max) {
      this.appels.set(cle, recents);
      return false;
    }
    recents.push(t);
    this.appels.set(cle, recents);
    if (this.appels.size > 10_000) this.purger(debut);
    return true;
  }

  private purger(debut: number): void {
    for (const [cle, liste] of this.appels) if (!liste.some((x) => x > debut)) this.appels.delete(cle);
  }
}
