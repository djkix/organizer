import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CorpsCorrection } from '@organizer/shared/api';
import { appliquerCorrection, choixDepuisChamp, corpsEcheance, corpsNature } from '../src/lib/correction.js';

const F = 'Europe/Paris';

describe('corpsEcheance', () => {
  it('aucune : vide l\'échéance', () => {
    expect(corpsEcheance({ type: 'aucune' }, F)).toEqual({ echeance: { type: 'aucune' } });
  });

  it('un jour : minuit local, avec le décalage', () => {
    expect(corpsEcheance({ type: 'jour', jour: '2026-10-08' }, F)).toEqual({ echeance: { type: 'jour', date: '2026-10-08T00:00:00+02:00' } });
    expect(corpsEcheance({ type: 'jour', jour: '2026-12-08' }, F)).toEqual({ echeance: { type: 'jour', date: '2026-12-08T00:00:00+01:00' } });
  });

  it('un jour et une heure, y compris l\'heure sautée du 29 mars', () => {
    expect(corpsEcheance({ type: 'datee', jour: '2026-10-08', heure: '10:00' }, F)).toEqual({ echeance: { type: 'datee', date: '2026-10-08T10:00:00+02:00' } });
    expect(corpsEcheance({ type: 'datee', jour: '2026-03-29', heure: '02:30' }, F)).toEqual({ echeance: { type: 'datee', date: '2026-03-29T03:30:00+02:00' } });
    expect(corpsEcheance({ type: 'datee', jour: '2026-10-25', heure: '02:30' }, F)).toEqual({ echeance: { type: 'datee', date: '2026-10-25T02:30:00+02:00' } });
  });

  it('avant une date : une fenêtre qui finit à minuit local du jour choisi', () => {
    expect(corpsEcheance({ type: 'avant', jour: '2026-10-25' }, F)).toEqual({ echeance: { type: 'fenetre', debut: null, fin: '2026-10-25T00:00:00+02:00' } });
  });

  it('n\'envoie que des types admis par le schéma de la version de prompt (décision 21)', () => {
    const schema = JSON.parse(readFileSync(new URL('../../../prompts/tri/v1/response-schema.json', import.meta.url), 'utf8')) as {
      properties: { items: { items: { properties: { echeance_type: { enum: string[] } } } } };
    };
    const admis = schema.properties.items.items.properties.echeance_type.enum;
    for (const c of [{ type: 'aucune' }, { type: 'jour', jour: '2026-10-08' }, { type: 'datee', jour: '2026-10-08', heure: '10:00' }, { type: 'avant', jour: '2026-10-08' }] as const) {
      expect(admis).toContain(corpsEcheance(c, F).echeance!.type);
    }
  });
});

describe('corpsNature', () => {
  it('ne porte que la nature', () => {
    expect(corpsNature('pensee')).toEqual({ nature: 'pensee' });
    expect(corpsNature('action')).toEqual({ nature: 'action' });
  });
});

describe('choixDepuisChamp', () => {
  it('lit les valeurs des champs date et date-heure de Chrome', () => {
    expect(choixDepuisChamp('jour', '2026-10-08')).toEqual({ type: 'jour', jour: '2026-10-08' });
    expect(choixDepuisChamp('avant', '2026-10-25')).toEqual({ type: 'avant', jour: '2026-10-25' });
    expect(choixDepuisChamp('datee', '2026-10-08T10:00')).toEqual({ type: 'datee', jour: '2026-10-08', heure: '10:00' });
    expect(choixDepuisChamp('datee', '2026-10-08T10:00:30')).toEqual({ type: 'datee', jour: '2026-10-08', heure: '10:00' });
  });

  it('un champ vidé ne corrige rien', () => {
    expect(choixDepuisChamp('jour', '')).toBeNull();
    expect(choixDepuisChamp('datee', '')).toBeNull();
  });
});

describe('appliquerCorrection', () => {
  it('un corps impossible à construire (date illisible) : correction ratée, rien n\'est envoyé', async () => {
    const envoyer = vi.fn<(c: CorpsCorrection) => Promise<undefined>>(async () => undefined);
    const r = await appliquerCorrection(() => corpsEcheance({ type: 'datee', jour: '2026-02-31', heure: '10:00' }, F), envoyer);
    expect(r).toBe('rate');
    expect(envoyer).not.toHaveBeenCalled();
  });

  it('un envoi refusé : correction ratée ; un envoi réussi : faite', async () => {
    expect(await appliquerCorrection(() => corpsNature('pensee'), async () => { throw new Error('x'); })).toBe('rate');
    const envoyer = vi.fn<(c: CorpsCorrection) => Promise<undefined>>(async () => undefined);
    expect(await appliquerCorrection(() => corpsNature('pensee'), envoyer)).toBe('faite');
    expect(envoyer).toHaveBeenCalledWith({ nature: 'pensee' });
  });
});
