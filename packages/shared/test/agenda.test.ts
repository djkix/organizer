import { describe, expect, it } from 'vitest';
import { PORTEE_AGENDA, titreCourt } from '../src/agenda.js';
import { dateHeureEnClair } from '../src/dates.js';
import { enfilerSynchro, OPTIONS_JOB_AGENDA, type JobAgenda } from '../src/files.js';

describe('titreCourt', () => {
  it('garde un texte court tel quel, sans espaces superflus', () => {
    expect(titreCourt('  dentiste   jeudi ')).toBe('dentiste jeudi');
  });
  it('coupe à un mot sous 60 caractères, avec « … »', () => {
    const t = titreCourt('appeler la mutuelle pour le remboursement des lunettes de la petite avant la fin du mois');
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith('…')).toBe(true);
    expect(t).toBe('appeler la mutuelle pour le remboursement des lunettes de…');
  });
  it('coupe dans le mot quand le premier mot dépasse seul', () => {
    expect(titreCourt('a'.repeat(80))).toBe(`${'a'.repeat(59)}…`);
  });
  it('un texte vide donne « Rendez-vous »', () => {
    expect(titreCourt('   ')).toBe('Rendez-vous');
  });
});

describe('PORTEE_AGENDA', () => {
  it('est la portée calendar.app.created', () => {
    expect(PORTEE_AGENDA).toBe('https://www.googleapis.com/auth/calendar.app.created');
  });
});

describe('dateHeureEnClair', () => {
  it('jour, date et heure à Paris, en été comme en hiver', () => {
    expect(dateHeureEnClair(new Date('2026-10-14T08:00:00Z'), 'Europe/Paris')).toBe('mercredi 14 octobre, 10:00');
    expect(dateHeureEnClair(new Date('2026-12-03T14:30:00Z'), 'Europe/Paris')).toBe('jeudi 3 décembre, 15:30');
  });
});

describe('enfilerSynchro', () => {
  it('enfile un job synchroniser, sans identifiant de job, avec le délai demandé', async () => {
    const ajouts: Array<[string, JobAgenda, object | undefined]> = [];
    await enfilerSynchro({ add: async (n, d, o) => { ajouts.push([n, d, o]); } }, 'i1', 15_000);
    expect(ajouts).toEqual([['synchroniser', { type: 'synchroniser', itemId: 'i1' }, { ...OPTIONS_JOB_AGENDA, delay: 15_000 }]]);
    expect(ajouts[0]![2]).not.toHaveProperty('jobId');
  });
});
