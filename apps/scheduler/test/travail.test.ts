import { UnrecoverableError } from 'bullmq';
import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { estReessayable, travailSynchro } from '../src/agenda/travail.js';
import { ClientRefuse, DejaPresent, ErreurGoogle, GoogleIndisponible, GoogleRefuse, Introuvable, JetonRefuse, OctroiInvalide, RequeteInvalide } from '../src/google/erreurs.js';
import { actionDatee, compteConnecte, depsSynchro } from './aides.js';
import { FauxGoogle } from './faux-google.js';

describe('estReessayable', () => {
  it('réessaie les pannes passagères', () => {
    expect(estReessayable(new GoogleIndisponible(429, null))).toBe(true);
    expect(estReessayable(new ErreurGoogle(503, null))).toBe(true);
    expect(estReessayable(new TypeError('fetch failed'))).toBe(true);
    expect(estReessayable(new DOMException('t', 'TimeoutError'))).toBe(true);
  });
  it('ne réessaie jamais les refus définitifs', () => {
    for (const E of [JetonRefuse, Introuvable, DejaPresent, OctroiInvalide, ClientRefuse, GoogleRefuse, RequeteInvalide]) {
      expect(estReessayable(new E(400, null))).toBe(false);
    }
  });
});

const prisma = creerPrisma();
let faux: FauxGoogle;
beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(async () => { await faux.arreter(); await prisma.$disconnect(); });
beforeEach(async () => { await viderBase(prisma); });

describe('travailSynchro', () => {
  it('autorisation retirée : échec final et alerte une seule fois', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.rafraichissements.clear();
    const alerter = vi.fn(async () => {});
    const t = travailSynchro(depsSynchro(prisma, faux), { alerter });
    await expect(t(itemId)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(t(itemId)).resolves.toBe('sans_agenda');
    expect(alerter).toHaveBeenCalledTimes(1);
    expect(alerter).toHaveBeenCalledWith({ type: 'autorisation_retiree', utilisateurId: uid });
  });

  it('requête invalide : échec final ; 429 : erreur d\'origine, réessayable', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const t = travailSynchro(depsSynchro(prisma, faux), { alerter: async () => {} });
    faux.forcer(/^POST \/calendar\//, 400);
    await expect(t(itemId)).rejects.toBeInstanceOf(UnrecoverableError);
    faux.forcer(/^POST \/calendar\//, 429, { error: { errors: [{ reason: 'rateLimitExceeded' }] } });
    await expect(t(itemId)).rejects.toBeInstanceOf(GoogleIndisponible);
  });
});
