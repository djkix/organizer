import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { UnrecoverableError } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deconnecterAgenda, echangerCode, type DepsConnexion } from '../src/agenda/connexion.js';
import { dechiffrer } from '../src/chiffre.js';
import { ErreurGoogle } from '../src/google/erreurs.js';
import { CLE, compteConnecte, depsSynchro } from './aides.js';
import { FauxGoogle, PORTEE } from './faux-google.js';

const prisma = creerPrisma();
let faux: FauxGoogle;
let balayages: string[];
beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); faux.requetes.length = 0; faux.revoques.length = 0; balayages = []; });

const deps = (): DepsConnexion => ({ ...depsSynchro(prisma, faux), cle: CLE, enfilerBalayage: async (uid) => { balayages.push(uid); } });
async function enCours(nom = 'l'): Promise<string> {
  const u = await prisma.utilisateur.create({ data: { nom } });
  await prisma.agendaGoogle.create({ data: { utilisateurId: u.id, etat: 'en_cours' } });
  return u.id;
}
const ligne = (uid: string) => prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } });

describe('echangerCode', () => {
  it('connecte : agenda « Organizer » à Paris, jeton chiffré, balayage enfilé', async () => {
    const uid = await enCours();
    faux.codes.set('code-ok', { portee: PORTEE, verificateur: 'verif' });
    expect(await echangerCode({ utilisateurId: uid, code: 'code-ok', verificateur: 'verif' }, deps())).toBe('connecte');
    const a = await ligne(uid);
    expect(a).toMatchObject({ etat: 'connecte', erreur: null });
    expect(faux.agendas.get(a.calendrierId!)).toMatchObject({ summary: 'Organizer', timeZone: 'Europe/Paris' });
    expect(a.jetonChiffre).not.toMatch(/rafr-/);
    expect(dechiffrer(a.jetonChiffre!, CLE, uid)).toMatch(/^rafr-/);
    expect(balayages).toEqual([uid]);
  });

  it('reconnexion : l\'agenda existant est repris, pas recréé', async () => {
    const uid = await enCours();
    const agenda = faux.agenda('agenda-garde@group.calendar.google.com');
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { calendrierId: agenda } });
    faux.codes.set('code-re', { portee: PORTEE });
    const avant = faux.agendas.size;
    await echangerCode({ utilisateurId: uid, code: 'code-re', verificateur: 'v' }, deps());
    expect((await ligne(uid)).calendrierId).toBe(agenda);
    expect(faux.agendas.size).toBe(avant);
  });

  it('accès à l\'agenda décoché par L : rien gardé, autorisation révoquée, portee_refusee', async () => {
    const uid = await enCours();
    faux.codes.set('code-sans', { portee: 'openid' });
    const avant = faux.agendas.size;
    expect(await echangerCode({ utilisateurId: uid, code: 'code-sans', verificateur: 'v' }, deps())).toBe('portee_refusee');
    expect(await ligne(uid)).toMatchObject({ etat: 'echec', erreur: 'portee_refusee', jetonChiffre: null });
    expect(faux.revoques).toHaveLength(1);
    expect(faux.agendas.size).toBe(avant);
    expect(balayages).toEqual([]);
  });

  it('code refusé par Google : echec « echange », sans reprise', async () => {
    const uid = await enCours();
    expect(await echangerCode({ utilisateurId: uid, code: 'inconnu', verificateur: 'v' }, deps())).toBe('echange');
    expect(await ligne(uid)).toMatchObject({ etat: 'echec', erreur: 'echange' });
  });

  it('connexion annulée entre-temps (déconnexion demandée) : ignore, le code n\'est pas utilisé', async () => {
    const uid = await enCours();
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnexion' } });
    faux.codes.set('code-tard', { portee: PORTEE });
    expect(await echangerCode({ utilisateurId: uid, code: 'code-tard', verificateur: 'v' }, deps())).toBe('ignore');
    expect(faux.requetes).toHaveLength(0);
  });
});

describe('echangerCode : échecs après la consommation du code (R6)', () => {
  it('création de l\'agenda en panne : jeton révoqué, échec sans reprise, rien gardé', async () => {
    const uid = await enCours();
    faux.codes.set('code-panne', { portee: PORTEE });
    faux.forcer(/^POST \/calendar\/v3\/calendars$/, 503, {});
    await expect(echangerCode({ utilisateurId: uid, code: 'code-panne', verificateur: 'v' }, deps())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await ligne(uid)).toMatchObject({ etat: 'echec', erreur: 'echange', jetonChiffre: null });
    expect(faux.revoques).toHaveLength(1);
    expect(balayages).toEqual([]);
  });

  it('enfilage du balayage en panne : la connexion reste, sans reprise du code', async () => {
    const uid = await enCours();
    faux.codes.set('code-file', { portee: PORTEE });
    const d = { ...deps(), enfilerBalayage: async () => { throw new Error('valkey'); } };
    expect(await echangerCode({ utilisateurId: uid, code: 'code-file', verificateur: 'v' }, d)).toBe('connecte');
    expect((await ligne(uid)).etat).toBe('connecte');
  });
});

describe('echangerCode : course et doublon', () => {
  it('déconnexion demandée pendant l\'échange : pas écrasée, jeton révoqué, agenda neuf retiré', async () => {
    const uid = await enCours();
    faux.codes.set('code-course', { portee: PORTEE });
    const base = deps();
    const calendrier = Object.assign(Object.create(base.calendrier) as typeof base.calendrier, {
      creerAgenda: async (j: string, n: string, f: string) => {
        await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnexion' } });
        return base.calendrier.creerAgenda(j, n, f);
      },
    });
    const avant = faux.agendas.size;
    expect(await echangerCode({ utilisateurId: uid, code: 'code-course', verificateur: 'v' }, { ...base, calendrier })).toBe('ignore');
    expect(await ligne(uid)).toMatchObject({ etat: 'deconnexion', jetonChiffre: null });
    expect(faux.revoques).toHaveLength(1);
    expect(faux.agendas.size).toBe(avant);
    expect(balayages).toEqual([]);
  });

  it('écriture en base en panne après la création de l\'agenda : l\'agenda neuf est retiré', async () => {
    const uid = await enCours();
    faux.codes.set('code-bd', { portee: PORTEE });
    const base = deps();
    const prismaEnPanne = { agendaGoogle: {
      findUnique: (a: never) => prisma.agendaGoogle.findUnique(a),
      updateMany: async () => { throw new Error('base'); },
    } };
    const avant = faux.agendas.size;
    await expect(echangerCode({ utilisateurId: uid, code: 'code-bd', verificateur: 'v' }, { ...base, prisma: prismaEnPanne as never })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(faux.agendas.size).toBe(avant);
    expect(faux.revoques).toHaveLength(1);
  });
});

describe('echangerCode : données du job', () => {
  it.each([
    [{ utilisateurId: 'pas-un-uuid', code: 'c', verificateur: 'v' }],
    [{ utilisateurId: '00000000-0000-4000-8000-000000000000', code: '', verificateur: 'v' }],
    [{ utilisateurId: '00000000-0000-4000-8000-000000000000' }],
  ])('refuse des données invalides sans appeler Google ni citer les données', async (j) => {
    const err = await echangerCode(j as never, deps()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).not.toMatch(/pas-un-uuid/);
    expect(faux.requetes).toHaveLength(0);
  });
});

describe('deconnecterAgenda', () => {
  it('révoque le vrai jeton, l\'efface, garde l\'agenda pour une reconnexion', async () => {
    const { uid, agenda } = await compteConnecte(prisma, faux);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnexion' } });
    await deconnecterAgenda(uid, deps());
    expect(faux.revoques).toEqual(['rafr-l']);
    expect(await ligne(uid)).toMatchObject({ etat: 'deconnecte', jetonChiffre: null, calendrierId: agenda });
    expect(faux.agendas.has(agenda)).toBe(true);
  });

  it('Google en panne : l\'erreur remonte (reprise), le jeton reste pour le prochain essai', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    await prisma.agendaGoogle.update({ where: { utilisateurId: uid }, data: { etat: 'deconnexion' } });
    faux.forcer(/^POST \/revoke$/, 503, {});
    await expect(deconnecterAgenda(uid, deps())).rejects.toBeInstanceOf(ErreurGoogle);
    expect((await ligne(uid)).jetonChiffre).not.toBeNull();
  });
});
