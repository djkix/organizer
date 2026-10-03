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
