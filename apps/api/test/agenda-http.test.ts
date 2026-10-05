import 'reflect-metadata';
import { Module, type Type } from '@nestjs/common';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgendaController } from '../src/agenda/agenda.controller.js';
import { AgendaService } from '../src/agenda/agenda.service.js';
import type { ConfigAgendaApi } from '../src/agenda/config.js';
import { AuthService } from '../src/auth/auth.service.js';
import { NOM_COOKIE } from '../src/auth/cookies.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { AGENDA, AUTH } from '../src/jetons.js';
import { demarrerAppTest } from './aides-http.js';
import { CONFIG_AGENDA, fausseFile, MagasinEtatsMemoire } from './aides-agenda.js';

const prisma = creerPrisma();
const auth = new AuthService(prisma);

function moduleAvec(config: ConfigAgendaApi | null): Type<unknown> {
  class ModuleTest {}
  const agenda = new AgendaService(prisma, new MagasinEtatsMemoire(), fausseFile(), config);
  Module({ controllers: [AgendaController], providers: [{ provide: AUTH, useValue: auth }, { provide: AGENDA, useValue: agenda }, SessionGuard] })(ModuleTest);
  return ModuleTest;
}

let app: { url: string; fermer(): Promise<void> } | undefined;
let cookie: string;
beforeEach(async () => {
  await viderBase(prisma);
  const u = await prisma.utilisateur.create({ data: { nom: 'l' } });
  cookie = `${NOM_COOKIE}=${(await auth.ouvrirSessionPour(u.id)).jeton}`;
});
afterEach(async () => { await app?.fermer(); app = undefined; });
afterAll(() => prisma.$disconnect());

describe('routes de l\'agenda', () => {
  it('sans session : 401 sur l\'état et la connexion ; le retour redirige vers Réglages, « expire »', async () => {
    app = await demarrerAppTest(moduleAvec(CONFIG_AGENDA));
    expect((await fetch(`${app.url}/api/agenda`)).status).toBe(401);
    expect((await fetch(`${app.url}/api/agenda/connexion`, { method: 'POST' })).status).toBe(401);
    const r = await fetch(`${app.url}/api/agenda/retour?state=x&code=y`, { redirect: 'manual' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/reglages?agenda=expire');
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('parcours complet : adresse de Google, retour avec la session, état en cours, déconnexion', async () => {
    app = await demarrerAppTest(moduleAvec(CONFIG_AGENDA));
    const r = await fetch(`${app.url}/api/agenda/connexion`, { method: 'POST', headers: { cookie } });
    expect(r.status).toBe(200);
    const state = new URL(((await r.json()) as { url: string }).url).searchParams.get('state')!;
    const retour = await fetch(`${app.url}/api/agenda/retour?state=${encodeURIComponent(state)}&code=code-1&scope=x`, { headers: { cookie }, redirect: 'manual' });
    expect(retour.headers.get('location')).toBe('/reglages?agenda=retour');
    expect(await (await fetch(`${app.url}/api/agenda`, { headers: { cookie } })).json()).toEqual({ etat: 'en_cours', erreur: null });
    expect((await fetch(`${app.url}/api/agenda`, { method: 'DELETE', headers: { cookie } })).status).toBe(202);
  });

  it('non configuré : 503 calme sur la connexion, état « indisponible »', async () => {
    app = await demarrerAppTest(moduleAvec(null));
    const r = await fetch(`${app.url}/api/agenda/connexion`, { method: 'POST', headers: { cookie } });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ message: "Google Agenda n'est pas configuré." });
    expect(await (await fetch(`${app.url}/api/agenda`, { headers: { cookie } })).json()).toEqual({ etat: 'indisponible', erreur: null });
  });
});
