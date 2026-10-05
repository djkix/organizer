import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AutorisationRetiree } from '../src/agenda/jetons.js';
import { AgendaSupprime, synchroniserAction } from '../src/agenda/synchroniser.js';
import { GoogleIndisponible } from '../src/google/erreurs.js';
import { actionDatee, compteConnecte, depsSynchro } from './aides.js';
import { FauxGoogle } from './faux-google.js';

const prisma = creerPrisma();
let faux: FauxGoogle;
beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.requetes.length = 0; });

const hex = (id: string) => id.replace(/-/g, '');
const action = (itemId: string) => prisma.action.findUniqueOrThrow({ where: { itemId } });
const appelsAgenda = () => faux.requetes.filter((r) => r.chemin.startsWith('/calendar/'));

describe('synchroniserAction', () => {
  it('crée un événement silencieux, sans description ; un second passage ne touche pas Google', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid, { texte: 'dentiste pour la petite' });
    const d = depsSynchro(prisma, faux);
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    const ev = faux.evenement(agenda, hex(itemId))!;
    expect(ev.corps).toEqual({
      id: hex(itemId), summary: 'dentiste pour la petite',
      start: { dateTime: '2026-10-14T10:00:00+02:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-10-14T10:30:00+02:00', timeZone: 'Europe/Paris' },
      reminders: { useDefault: false, overrides: [] },
    });
    expect(await action(itemId)).toMatchObject({ evenementId: hex(itemId), evenementCalendrierId: agenda, evenementGeneration: 0 });
    const avant = appelsAgenda().length;
    expect(await synchroniserAction(itemId, d)).toBe('rien');
    expect(appelsAgenda().length).toBe(avant);
  });

  it('alarme activée : le même événement reçoit un rappel de 10 minutes', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    await prisma.action.update({ where: { itemId }, data: { alarme: true } });
    expect(await synchroniserAction(itemId, d)).toBe('remplace');
    expect(faux.evenement(agenda, hex(itemId))!.corps.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] });
    expect(faux.agendas.get(agenda)!.evenements.size).toBe(1);
  });

  it('cochée : l\'événement est supprimé ; décochée : un nouvel événement sous la génération suivante', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    await prisma.action.update({ where: { itemId }, data: { faitLe: new Date() } });
    expect(await synchroniserAction(itemId, d)).toBe('supprime');
    expect(faux.evenement(agenda, hex(itemId))!.status).toBe('cancelled');
    expect(await action(itemId)).toMatchObject({ evenementId: null, evenementEmpreinte: null, evenementGeneration: 1 });
    await prisma.action.update({ where: { itemId }, data: { faitLe: null } });
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    expect(faux.evenement(agenda, `${hex(itemId)}g1`)!.status).toBe('confirmed');
  });

  it('supprimé par L dans Google : rien tant que l\'action ne change pas, puis un nouvel événement', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    faux.supprimerParL(agenda, hex(itemId));
    expect(await synchroniserAction(itemId, d)).toBe('rien');
    expect(faux.evenement(agenda, hex(itemId))!.status).toBe('cancelled');
    await prisma.action.update({ where: { itemId }, data: { echeanceDate: new Date('2026-10-15T08:00:00Z') } });
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    expect(faux.evenement(agenda, `${hex(itemId)}g1`)!.corps.start).toEqual({ dateTime: '2026-10-15T10:00:00+02:00', timeZone: 'Europe/Paris' });
    expect(await action(itemId)).toMatchObject({ evenementId: `${hex(itemId)}g1`, evenementGeneration: 1 });
  });

  it('corrigée en pensée : l\'événement part ; une pensée n\'en a jamais', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const pensee = await actionDatee(prisma, uid, { nature: 'pensee' });
    const d = depsSynchro(prisma, faux);
    await synchroniserAction(itemId, d);
    await prisma.item.update({ where: { id: itemId }, data: { nature: 'pensee' } });
    expect(await synchroniserAction(itemId, d)).toBe('supprime');
    expect(await synchroniserAction(pensee, d)).toBe('rien');
    expect(faux.evenement(agenda, hex(pensee))).toBeUndefined();
  });

  it('insertion déjà faite (réponse perdue) : remplacée, jamais en double', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.agendas.get(agenda)!.evenements.set(hex(itemId), { id: hex(itemId), status: 'confirmed', corps: { summary: 'ancien' } });
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('cree');
    expect(faux.agendas.get(agenda)!.evenements.size).toBe(1);
    expect(faux.evenement(agenda, hex(itemId))!.corps.summary).toBe('dentiste');
  });

  it('jeton d\'accès périmé (401) : un nouveau jeton, un second essai', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const d = depsSynchro(prisma, faux);
    d.jetons.retenir(uid, 'perime', 3600);
    expect(await synchroniserAction(itemId, d)).toBe('cree');
    expect(faux.evenement(agenda, hex(itemId))).toBeDefined();
  });

  it('autorisation retirée : état revoque, jeton effacé, AutorisationRetiree', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.rafraichissements.clear();
    await expect(synchroniserAction(itemId, depsSynchro(prisma, faux))).rejects.toBeInstanceOf(AutorisationRetiree);
    expect(await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).toMatchObject({ etat: 'revoque', jetonChiffre: null });
  });

  it('agenda Organizer supprimé par L : état agenda_supprime, AgendaSupprime, rien d\'écrit', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.agendas.delete(agenda);
    await expect(synchroniserAction(itemId, depsSynchro(prisma, faux))).rejects.toBeInstanceOf(AgendaSupprime);
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('agenda_supprime');
    expect((await action(itemId)).evenementId).toBeNull();
  });

  it('compte sans agenda connecté : aucun appel à Google', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const itemId = await actionDatee(prisma, u.id);
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('sans_agenda');
    expect(faux.requetes).toHaveLength(0);
  });

  it('rendez-vous passé depuis plus de 24 h : jamais créé', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid, { date: '2026-10-01T08:00:00Z' });
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('rien');
    expect(appelsAgenda()).toHaveLength(0);
  });

  it('429 : GoogleIndisponible remonte, rien n\'est noté en base', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.forcer(/^POST \/calendar\//, 429, { error: { code: 429, errors: [{ reason: 'rateLimitExceeded' }] } });
    await expect(synchroniserAction(itemId, depsSynchro(prisma, faux))).rejects.toBeInstanceOf(GoogleIndisponible);
    expect((await action(itemId)).evenementId).toBeNull();
  });
});

describe('synchroniserAction : corrections de revue', () => {
  it('suppression dans le calendrier propre à l\'événement, pas dans le courant', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const ancien = faux.agenda('ancien@group.calendar.google.com');
    faux.agendas.get(ancien)!.evenements.set(hex(itemId), { id: hex(itemId), status: 'confirmed', corps: {} });
    await prisma.action.update({ where: { itemId }, data: { evenementId: hex(itemId), evenementCalendrierId: ancien, evenementEmpreinte: 'x' } });
    await prisma.item.update({ where: { id: itemId }, data: { nature: 'pensee' } });
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('supprime');
    expect(faux.evenement(ancien, hex(itemId))!.status).toBe('cancelled');
    expect(faux.requetes.some((r) => r.chemin.includes(encodeURIComponent(agenda)))).toBe(false);
  });

  it('evenementId sans calendrier : aucun appel distant pour supprimer, champs vidés, puis création sous nouvelle génération', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    await prisma.action.update({ where: { itemId }, data: { evenementId: hex(itemId), evenementCalendrierId: null, evenementEmpreinte: 'x' } });
    expect(await synchroniserAction(itemId, depsSynchro(prisma, faux))).toBe('cree');
    expect(faux.requetes.filter((r) => r.methode === 'DELETE')).toHaveLength(0);
    expect(faux.evenement(agenda, `${hex(itemId)}g1`)).toBeDefined();
    expect(await action(itemId)).toMatchObject({ evenementId: `${hex(itemId)}g1`, evenementCalendrierId: agenda, evenementGeneration: 1 });
  });

  it('evenementId sans calendrier et plus de contenu : champs vidés, rien d\'envoyé', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid, { nature: 'pensee' });
    await prisma.action.update({ where: { itemId }, data: { evenementId: hex(itemId), evenementCalendrierId: null, evenementEmpreinte: 'x' } });
    await synchroniserAction(itemId, depsSynchro(prisma, faux));
    expect(await action(itemId)).toMatchObject({ evenementId: null, evenementEmpreinte: null });
    expect(appelsAgenda()).toHaveLength(0);
  });
});
