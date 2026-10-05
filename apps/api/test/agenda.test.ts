import { createHash } from 'node:crypto';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { OPTIONS_JOB_ECHANGE, PORTEE_AGENDA } from '@organizer/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AgendaIndisponible, AgendaService } from '../src/agenda/agenda.service.js';
import { CONFIG_AGENDA as CONFIG, fausseFile, MagasinEtatsMemoire } from './aides-agenda.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
let etats: MagasinEtatsMemoire;
let file: ReturnType<typeof fausseFile>;
let service: AgendaService;
let uid: string;
beforeEach(async () => {
  await viderBase(prisma);
  etats = new MagasinEtatsMemoire();
  file = fausseFile();
  service = new AgendaService(prisma, etats, file, CONFIG);
  uid = (await prisma.utilisateur.create({ data: { nom: 'l' } })).id;
});

async function demarrer(): Promise<{ state: string; verificateur: string; url: URL }> {
  const url = new URL((await service.demarrer(uid)).url);
  const state = url.searchParams.get('state')!;
  const { verificateur } = JSON.parse(etats.m.get(state)!) as { verificateur: string };
  return { state, verificateur, url };
}

describe('AgendaService', () => {
  it('l\'adresse de Google : client, retour exact, portée unique, hors ligne, consentement, état, PKCE S256', async () => {
    const { url, state, verificateur } = await demarrer();
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CONFIG.clientId, redirect_uri: CONFIG.redirectUri, response_type: 'code', scope: PORTEE_AGENDA,
      access_type: 'offline', prompt: 'consent', state,
      code_challenge: createHash('sha256').update(verificateur).digest('base64url'), code_challenge_method: 'S256',
    });
    expect(state.length).toBeGreaterThanOrEqual(43);
    expect(verificateur).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('retour valable : connexion en cours, code et vérificateur confiés au scheduler, état à usage unique', async () => {
    const { state, verificateur } = await demarrer();
    expect(await service.retour({ state, code: 'code-1' }, uid)).toBe('retour');
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('en_cours');
    expect(file.ajouts).toEqual([{ nom: 'echanger', data: { type: 'echanger', utilisateurId: uid, code: 'code-1', verificateur }, opts: OPTIONS_JOB_ECHANGE }]);
    expect(await service.retour({ state, code: 'code-1' }, uid)).toBe('expire');
    expect(file.ajouts).toHaveLength(1);
  });

  it('file en panne ou muette après l\'upsert : état « echec » (échange), retour calme', async () => {
    const { state } = await demarrer();
    const muette = { add: () => new Promise(() => undefined) } as never;
    const s = new AgendaService(prisma, etats, muette, CONFIG, 50);
    expect(await s.retour({ state, code: 'c' }, uid)).toBe('expire');
    expect(await s.etat(uid)).toEqual({ etat: 'echec', erreur: 'echange' });
  });

  it('retour sur une autre session, sans session, ou état inconnu : expiré, rien d\'enfilé', async () => {
    const autre = (await prisma.utilisateur.create({ data: { nom: 'f' } })).id;
    const a = await demarrer();
    expect(await service.retour({ state: a.state, code: 'c' }, autre)).toBe('expire');
    const b = await demarrer();
    expect(await service.retour({ state: b.state, code: 'c' }, null)).toBe('expire');
    expect(await service.retour({ state: 'inconnu', code: 'c' }, uid)).toBe('expire');
    expect(await service.retour({ code: 'c' }, uid)).toBe('expire');
    expect(file.ajouts).toHaveLength(0);
    expect(await prisma.agendaGoogle.count()).toBe(0);
  });

  it('L annule sur l\'écran de Google : refus, état consommé, rien d\'enfilé', async () => {
    const { state } = await demarrer();
    expect(await service.retour({ state, error: 'access_denied' }, uid)).toBe('refus');
    expect(etats.m.size).toBe(0);
    expect(file.ajouts).toHaveLength(0);
  });

  it('état de la connexion : déconnecté par défaut, indisponible sans configuration', async () => {
    expect(await service.etat(uid)).toEqual({ etat: 'deconnecte', erreur: null });
    await prisma.agendaGoogle.create({ data: { utilisateurId: uid, etat: 'echec', erreur: 'portee_refusee' } });
    expect(await service.etat(uid)).toEqual({ etat: 'echec', erreur: 'portee_refusee' });
    const sans = new AgendaService(prisma, etats, file, null);
    expect(await sans.etat(uid)).toEqual({ etat: 'indisponible', erreur: null });
    await expect(sans.demarrer(uid)).rejects.toBeInstanceOf(AgendaIndisponible);
  });

  it('déconnecter : déconnexion en cours et job ; sans connexion, rien', async () => {
    await service.deconnecter(uid);
    expect(file.ajouts).toHaveLength(0);
    await prisma.agendaGoogle.create({ data: { utilisateurId: uid, etat: 'connecte', jetonChiffre: 'v1.x', calendrierId: 'a' } });
    await service.deconnecter(uid);
    expect((await prisma.agendaGoogle.findUniqueOrThrow({ where: { utilisateurId: uid } })).etat).toBe('deconnexion');
    expect(file.ajouts.map((a) => a.data)).toEqual([{ type: 'deconnecter', utilisateurId: uid }]);
  });
});
