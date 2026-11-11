/**
 * Fenêtre glissante en mémoire : un seul processus API. Un refus ne compte pas comme un appel.
 * Au plus MAX_CLES clés : au-delà, la plus anciennement servie est oubliée (la Map garde l'ordre d'insertion).
 */
const MAX_CLES = 10_000;

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
    // Retirée puis remise : la clé passe en fin d'ordre, la plus ancienne reste en tête.
    this.appels.delete(cle);
    this.appels.set(cle, recents);
    if (this.appels.size > MAX_CLES) this.appels.delete(this.appels.keys().next().value!);
    return true;
  }
}
