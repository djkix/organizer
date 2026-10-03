/** Date ISO 8601 avec le décalage du fuseau, ex. 2026-10-06T08:12:00+02:00 */
export function isoLocal(date: Date, fuseau: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const decalage = p.timeZoneName === 'GMT' ? '+00:00' : (p.timeZoneName ?? 'GMT').replace('GMT', '');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${decalage}`;
}

export function jourSemaine(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long' }).format(date);
}

/** Jour civil (AAAA-MM-JJ) d'un instant, dans le fuseau. */
export function jourLocal(date: Date, fuseau: string): string {
  return isoLocal(date, fuseau).slice(0, 10);
}

export function ajouterJours(jour: string, n: number): string {
  const [a, m, j] = jour.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Instant de 00:00 locale du jour civil. */
export function debutJour(jour: string, fuseau: string): Date {
  // Le décalage lu à 00:00 UTC est celui de minuit local : les changements d'heure ont lieu plus tard dans la nuit.
  const decalage = isoLocal(new Date(`${jour}T00:00:00Z`), fuseau).slice(19);
  return new Date(`${jour}T00:00:00${decalage}`);
}
