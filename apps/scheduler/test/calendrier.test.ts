import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClientCalendrier, type CorpsEvenement } from '../src/google/calendrier.js';
import { DejaPresent, GoogleIndisponible, JetonRefuse } from '../src/google/erreurs.js';
import { FauxGoogle } from './faux-google.js';

let faux: FauxGoogle;
let cal: ClientCalendrier;
const corps: CorpsEvenement = {
  summary: 'dentiste',
  start: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: 'Europe/Paris' },
  end: { dateTime: '2026-10-14T10:30:00+02:00', timeZone: 'Europe/Paris' },
  reminders: { useDefault: false, overrides: [] },
};

beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); cal = new ClientCalendrier(`${faux.url}/calendar/v3`, fetch); });
afterAll(() => faux.arreter());
beforeEach(() => { faux.acces.add('acces-t'); faux.requetes.length = 0; });

describe('ClientCalendrier', () => {
  it('crée l\'agenda dédié au fuseau de Paris', async () => {
    const id = await cal.creerAgenda('acces-t', 'Organizer', 'Europe/Paris');
    expect(faux.agendas.get(id)).toMatchObject({ summary: 'Organizer', timeZone: 'Europe/Paris' });
    expect(faux.requetes[0]!.autorisation).toBe('Bearer acces-t');
    expect(await cal.agendaExiste('acces-t', id)).toBe(true);
    expect(await cal.agendaExiste('acces-t', 'inconnu@group.calendar.google.com')).toBe(false);
  });

  it('insère avec l\'identifiant donné ; la même insertion répond DejaPresent', async () => {
    const a = faux.agenda('agenda-a@group.calendar.google.com');
    await cal.inserer('acces-t', a, 'abcdef0123', corps);
    expect(faux.evenement(a, 'abcdef0123')?.corps).toEqual({ id: 'abcdef0123', ...corps });
    await expect(cal.inserer('acces-t', a, 'abcdef0123', corps)).rejects.toBeInstanceOf(DejaPresent);
  });

  it('lit, remplace, supprime ; une seconde suppression est sans erreur ; un inconnu se lit null', async () => {
    const a = faux.agenda('agenda-b@group.calendar.google.com');
    await cal.inserer('acces-t', a, 'ev00001', corps);
    await cal.remplacer('acces-t', a, 'ev00001', { ...corps, summary: 'dentiste lundi' });
    expect(faux.evenement(a, 'ev00001')?.corps.summary).toBe('dentiste lundi');
    await cal.supprimer('acces-t', a, 'ev00001');
    expect(await cal.lire('acces-t', a, 'ev00001')).toEqual({ id: 'ev00001', status: 'cancelled' });
    await expect(cal.supprimer('acces-t', a, 'ev00001')).resolves.toBeUndefined();
    expect(await cal.lire('acces-t', a, 'jamais0')).toBeNull();
  });

  it('401 : JetonRefuse ; 429 et 403 : GoogleIndisponible avec la raison technique seulement', async () => {
    const a = faux.agenda('agenda-c@group.calendar.google.com');
    await expect(cal.lire('perime', a, 'ev00001')).rejects.toBeInstanceOf(JetonRefuse);
    faux.forcer(/^POST /, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }], message: 'texte libre' } });
    const e = await cal.inserer('acces-t', a, 'ev00002', corps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GoogleIndisponible);
    expect((e as Error).message).toBe('Google HTTP 429 (rateLimitExceeded)');
    faux.forcer(/^POST /, 403, { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } });
    await expect(cal.inserer('acces-t', a, 'ev00003', corps)).rejects.toBeInstanceOf(GoogleIndisponible);
  });
});
