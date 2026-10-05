import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { balayer } from '../src/agenda/balayer.js';
import { synchroniserAction } from '../src/agenda/synchroniser.js';
import { actionDatee, compteConnecte, depsSynchro, MAINTENANT } from './aides.js';
import { FauxGoogle } from './faux-google.js';

const prisma = creerPrisma();
let faux: FauxGoogle;
beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.requetes.length = 0; });

describe('balayer', () => {
  it('n\'enfile que les actions divergentes, sans appeler Google', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const d = depsSynchro(prisma, faux);
    const ajour = await actionDatee(prisma, uid, { texte: 'à jour' });
    await synchroniserAction(ajour, d);
    const cochee = await actionDatee(prisma, uid, { texte: 'cochée' });
    await synchroniserAction(cochee, d);
    await prisma.action.update({ where: { itemId: cochee }, data: { faitLe: MAINTENANT } });
    const nouvelle = await actionDatee(prisma, uid, { texte: 'nouvelle' });
    await actionDatee(prisma, uid, { texte: 'passée', date: '2026-10-01T08:00:00Z' });
    await actionDatee(prisma, uid, { texte: 'un jour', type: 'jour' });
    faux.requetes.length = 0;
    const enfiles: string[] = [];
    expect(await balayer({ prisma, jetons: d.jetons, enfiler: async (i) => { enfiles.push(i); }, maintenant: () => MAINTENANT })).toBe(2);
    expect(enfiles.sort()).toEqual([cochee, nouvelle].sort());
    expect(faux.requetes).toHaveLength(0);
  });

  it('ignore un compte non connecté ; filtre sur un compte quand on le demande', async () => {
    const u = await prisma.utilisateur.create({ data: { nom: 'f' } });
    await actionDatee(prisma, u.id);
    const { uid } = await compteConnecte(prisma, faux);
    const sienne = await actionDatee(prisma, uid);
    const enfiles: string[] = [];
    const d = { prisma, jetons: depsSynchro(prisma, faux).jetons, enfiler: async (i: string) => { enfiles.push(i); }, maintenant: () => MAINTENANT };
    expect(await balayer(d, u.id)).toBe(0);
    expect(await balayer(d)).toBe(1);
    expect(enfiles).toEqual([sienne]);
  });

  it('entretient un jeton resté inutilisé 7 jours ; une révocation découverte est signalée', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { rafraichiLe: new Date('2026-10-01T00:00:00Z') } });
    const d = depsSynchro(prisma, faux);
    await balayer({ prisma, jetons: d.jetons, enfiler: async () => {}, maintenant: () => MAINTENANT });
    expect(faux.requetes.filter((r) => r.chemin === '/token')).toHaveLength(1);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { rafraichiLe: new Date('2026-10-01T00:00:00Z') } });
    faux.rafraichissements.clear();
    const revoques: string[] = [];
    await balayer({ prisma, jetons: d.jetons, enfiler: async () => {}, surRevocation: async (u) => { revoques.push(u); }, maintenant: () => MAINTENANT });
    expect(revoques).toEqual([uid]);
  });

  it('surRevocation en panne : le balayage ne s\'arrête pas', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { rafraichiLe: new Date('2026-10-01T00:00:00Z') } });
    faux.rafraichissements.clear();
    const d = depsSynchro(prisma, faux);
    await expect(balayer({ prisma, jetons: d.jetons, enfiler: async () => {}, surRevocation: async () => { throw new Error('file'); }, maintenant: () => MAINTENANT })).resolves.toBeGreaterThanOrEqual(0);
  });

  it('parcourt par lots : toutes les actions divergentes, sans doublon, même au-delà d\'un lot', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await actionDatee(prisma, uid, { texte: `a${i}` }));
    const enfiles: string[] = [];
    const d = { prisma, jetons: depsSynchro(prisma, faux).jetons, enfiler: async (i: string) => { enfiles.push(i); }, maintenant: () => MAINTENANT, lot: 2 };
    expect(await balayer(d)).toBe(5);
    expect([...enfiles].sort()).toEqual([...ids].sort());
    expect(new Set(enfiles).size).toBe(5);
    enfiles.length = 0;
    expect(await balayer(d)).toBe(5); // rien n'a été synchronisé : même résultat, idempotent
  });

  it('un enfilage en panne n\'arrête pas le balayage des autres comptes', async () => {
    const a = await compteConnecte(prisma, faux, 'a');
    const b = await compteConnecte(prisma, faux, 'b');
    const ia = await actionDatee(prisma, a.uid);
    const ib = await actionDatee(prisma, b.uid);
    const enfiles: string[] = [];
    const d = {
      prisma, jetons: depsSynchro(prisma, faux).jetons, maintenant: () => MAINTENANT,
      enfiler: async (i: string) => { if (i === ia) throw new Error('valkey'); enfiles.push(i); },
    };
    expect(await balayer(d)).toBe(1);
    expect(enfiles).toEqual([ib]);
  });
});
