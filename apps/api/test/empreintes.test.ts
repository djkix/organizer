import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DelaiDepasse, type MagasinDefis } from '../src/auth/empreintes/defis.js';
import { EmpreintesService, MAX_CLES_PAR_COMPTE, TropDeCles } from '../src/auth/empreintes/empreintes.service.js';
import { AuthentificateurLogiciel, CONFIG_ESSAI, MagasinDefisMemoire } from './aides-webauthn.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());

let horloge: number;
let journal: string[];
let defis: MagasinDefisMemoire;
let service: EmpreintesService;
let u: { id: string; nom: string };
const telephone = (croissant = false) => new AuthentificateurLogiciel(CONFIG_ESSAI.rpId, CONFIG_ESSAI.origine, croissant);

beforeEach(async () => {
  horloge = Date.parse('2026-10-06T08:00:00Z');
  journal = [];
  await viderBase(prisma);
  u = await prisma.utilisateur.create({ data: { nom: 'l' }, select: { id: true, nom: true } });
  defis = new MagasinDefisMemoire(() => horloge);
  service = new EmpreintesService(prisma, defis, CONFIG_ESSAI, () => new Date(horloge), (m) => { journal.push(m); });
});

describe('activer une empreinte', () => {
  it('options : RP configuré, clé découvrable, empreinte exigée, sans attestation, compte en UUID', async () => {
    const o = await service.optionsInscription(u);
    expect(o.rp).toEqual({ name: 'Organizer', id: 'organizer.djkix.ovh' });
    expect(Buffer.from(o.user.id, 'base64url').toString('utf8')).toBe(u.id);
    expect(o.user.name).toBe('l');
    expect(o.attestation).toBe('none');
    expect(o.timeout).toBe(60_000);
    expect(o.authenticatorSelection).toMatchObject({
      residentKey: 'required', requireResidentKey: true, userVerification: 'required', authenticatorAttachment: 'platform',
    });
    expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
  });

  it('garde la clé publique et le compte, compteur à zéro', async () => {
    const r = telephone().inscrire(await service.optionsInscription(u));
    expect(await service.inscrire(u, r)).toMatchObject({ identifiant: r.id, creeLe: '2026-10-06T08:00:00.000Z', utiliseeLe: null });
    const enBase = await prisma.cleAcces.findUniqueOrThrow({ where: { identifiant: r.id } });
    expect(enBase).toMatchObject({ utilisateurId: u.id, compteur: 0n, transports: ['internal'], sauvegardee: false });
    expect(enBase.clePublique.length).toBeGreaterThan(60);
  });

  it('les options suivantes excluent les clés déjà gardées : pas de doublon sur un téléphone', async () => {
    const r = telephone().inscrire(await service.optionsInscription(u));
    await service.inscrire(u, r);
    const o = await service.optionsInscription(u);
    expect(o.excludeCredentials?.map((c) => c.id)).toEqual([r.id]);
  });

  it('un défi ne sert qu\'une fois', async () => {
    const o = await service.optionsInscription(u);
    expect(await service.inscrire(u, telephone().inscrire(o))).not.toBeNull();
    expect(await service.inscrire(u, telephone().inscrire(o))).toBeNull();
  });

  it('le défi d\'un compte ne sert pas à un autre, et il est consommé', async () => {
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const r = telephone().inscrire(await service.optionsInscription(u));
    expect(await service.inscrire({ id: autre.id }, r)).toBeNull();
    expect(await service.inscrire(u, r)).toBeNull();
    expect(await prisma.cleAcces.count()).toBe(0);
  });

  it('un défi expire au bout de deux minutes', async () => {
    const o = await service.optionsInscription(u);
    horloge += 120_001;
    expect(await service.inscrire(u, telephone().inscrire(o))).toBeNull();
  });

  it.each([
    [{ origine: 'https://organizer.djkix.ovh.exemple.net' }],
    [{ origine: 'http://organizer.djkix.ovh' }],
    [{ rpId: 'exemple.net' }],
    [{ type: 'webauthn.get' }],
    [{ sansUv: true }],
  ])('refuse une réponse faussée (%o), sans rien garder, et le journalise', async (f) => {
    const r = telephone().inscrire(await service.optionsInscription(u), f);
    expect(await service.inscrire(u, r)).toBeNull();
    expect(await prisma.cleAcces.count()).toBe(0);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatch(/^Empreinte refusée \(inscription\) : /);
  });

  it(`${MAX_CLES_PAR_COMPTE} clés au plus par compte`, async () => {
    await prisma.cleAcces.createMany({
      data: Array.from({ length: MAX_CLES_PAR_COMPTE }, (_, i) => ({ identifiant: `cle-${i}`, utilisateurId: u.id, clePublique: new Uint8Array([1]) })),
    });
    await expect(service.optionsInscription(u)).rejects.toBeInstanceOf(TropDeCles);
  });

  it('Valkey muet : l\'erreur remonte, jamais une empreinte acceptée en silence', async () => {
    const o = await service.optionsInscription(u);
    const muet: MagasinDefis = { poser: async () => {}, prendre: () => Promise.reject(new DelaiDepasse()) };
    const s = new EmpreintesService(prisma, muet, CONFIG_ESSAI);
    await expect(s.inscrire(u, telephone().inscrire(o))).rejects.toBeInstanceOf(DelaiDepasse);
    expect(await prisma.cleAcces.count()).toBe(0);
  });
});

describe('lister et retirer', () => {
  it('chacun ne voit et ne retire que ses clés', async () => {
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const sienne = await prisma.cleAcces.create({ data: { identifiant: 'cle-autre', utilisateurId: autre.id, clePublique: new Uint8Array([1]) } });
    const r = telephone().inscrire(await service.optionsInscription(u));
    const cle = await service.inscrire(u, r);
    expect((await service.lister(u.id)).map((c) => c.identifiant)).toEqual([r.id]);
    expect(await service.retirer(u.id, sienne.id)).toBe(false);
    expect(await prisma.cleAcces.count()).toBe(2);
    expect(await service.retirer(u.id, cle!.id)).toBe(true);
    expect(await service.lister(u.id)).toEqual([]);
  });
});
