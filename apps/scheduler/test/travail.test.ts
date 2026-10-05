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
  it('client OAuth refusé : ClientRefuse relancé tel quel', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.forcer(/^POST \/token$/, 401, { error: 'invalid_client' });
    await expect(travailSynchro(depsSynchro(prisma, faux))(itemId)).rejects.toBeInstanceOf(ClientRefuse);
  });

  it('autorisation retirée : issue revoque sans erreur, alerte une seule fois ; ensuite sans_agenda', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.rafraichissements.clear();
    const alerter = vi.fn(async () => {});
    const t = travailSynchro(depsSynchro(prisma, faux, undefined, alerter));
    await expect(t(itemId)).resolves.toBe('revoque');
    await expect(t(itemId)).resolves.toBe('sans_agenda');
    expect(alerter).toHaveBeenCalledTimes(1);
    expect(alerter).toHaveBeenCalledWith({ type: 'autorisation_retiree', utilisateurId: uid });
  });

  it('alerteur en échec : classification inchangée', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.rafraichissements.clear();
    const t = travailSynchro(depsSynchro(prisma, faux, undefined, async () => { throw new Error('boum'); }));
    await expect(t(itemId)).resolves.toBe('revoque');
  });

  it('panne de base : erreur d\'origine, réessayable (pas Unrecoverable)', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const panne = new Error('Can\'t reach database server');
    // Faux prisma isolé : un spyOn sur le client partagé abîmait ses délégués pour les tests suivants.
    const enPanne = { action: { findUnique: vi.fn().mockRejectedValue(panne), findUniqueOrThrow: vi.fn().mockRejectedValue(panne) } };
    const d = { ...depsSynchro(prisma, faux), prisma: enPanne as never };
    const err = await travailSynchro(d)(itemId).catch((e: unknown) => e);
    expect(err).toBe(panne);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });

  it('GoogleRefuse : échec final', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    faux.forcer(/^POST \/calendar\//, 403, { error: { errors: [{ reason: 'forbidden' }] } });
    await expect(travailSynchro(depsSynchro(prisma, faux))(itemId)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('requête invalide : échec final ; 429 : erreur d\'origine, réessayable', async () => {
    const { uid } = await compteConnecte(prisma, faux);
    const itemId = await actionDatee(prisma, uid);
    const t = travailSynchro(depsSynchro(prisma, faux));
    faux.forcer(/^POST \/calendar\//, 400);
    await expect(t(itemId)).rejects.toBeInstanceOf(UnrecoverableError);
    faux.forcer(/^POST \/calendar\//, 429, { error: { errors: [{ reason: 'rateLimitExceeded' }] } });
    await expect(t(itemId)).rejects.toBeInstanceOf(GoogleIndisponible);
  });
});
