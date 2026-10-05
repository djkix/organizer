import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DelaiDepasse, type MagasinDefis } from '../src/auth/empreintes/defis.js';
import { EmpreintesService, MAX_CLES_PAR_COMPTE, retirerEmpreintes, TropDeCles } from '../src/auth/empreintes/empreintes.service.js';
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

describe('garde-fous de l\'activation', () => {
  it('des défis émis avant le plafond ne le dépassent pas', async () => {
    await prisma.cleAcces.createMany({
      data: Array.from({ length: MAX_CLES_PAR_COMPTE - 1 }, (_, i) => ({ identifiant: `cle-${i}`, utilisateurId: u.id, clePublique: new Uint8Array([1]) })),
    });
    const a = await service.optionsInscription(u);
    const b = await service.optionsInscription(u);
    const resultats = await Promise.all([service.inscrire(u, telephone().inscrire(a)), service.inscrire(u, telephone().inscrire(b))]);
    expect(resultats.filter((r) => r !== null)).toHaveLength(1);
    expect(await prisma.cleAcces.count()).toBe(MAX_CLES_PAR_COMPTE);
  });

  it('une panne Valkey quelconque devient DelaiDepasse, journalisée sans détail du client', async () => {
    const casse: MagasinDefis = { poser: async () => {}, prendre: () => Promise.reject(new Error('ECONNRESET secret')) };
    const s = new EmpreintesService(prisma, casse, CONFIG_ESSAI, () => new Date(horloge), (m) => { journal.push(m); });
    const o = await service.optionsInscription(u);
    await expect(s.inscrire(u, telephone().inscrire(o))).rejects.toBeInstanceOf(DelaiDepasse);
    expect(journal).toEqual(['Valkey en erreur : ECONNRESET secret']);
  });

  it('un refus de la bibliothèque ne journalise ni le défi ni l\'origine reçus', async () => {
    const o = await service.optionsInscription(u);
    await service.inscrire(u, telephone().inscrire(o, { origine: 'https://evil.example' }));
    expect(journal).toHaveLength(1);
    expect(journal[0]).not.toContain('evil.example');
    expect(journal[0]).not.toContain(o.challenge);
  });

  it('la même clé déjà gardée : refus, pas d\'erreur', async () => {
    const r = telephone().inscrire(await service.optionsInscription(u));
    await prisma.cleAcces.create({ data: { identifiant: r.id, utilisateurId: u.id, clePublique: new Uint8Array([1]) } });
    expect(await service.inscrire(u, r)).toBeNull();
  });

  it('retirer : un identifiant mal formé vaut faux', async () => {
    expect(await service.retirer(u.id, 'pas-un-uuid')).toBe(false);
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

async function inscrit(t = telephone()) {
  const r = t.inscrire(await service.optionsInscription(u));
  await service.inscrire(u, r);
  return t;
}

describe('se reconnecter par l\'empreinte', () => {
  it('options : RP configuré, empreinte exigée, aucune clé listée (le téléphone propose les siennes)', async () => {
    const o = await service.optionsConnexion();
    expect(o.rpId).toBe('organizer.djkix.ovh');
    expect(o.userVerification).toBe('required');
    expect(o.timeout).toBe(60_000);
    expect(o.allowCredentials ?? []).toEqual([]);
  });

  it('une empreinte valide désigne le compte et date la clé', async () => {
    const t = await inscrit();
    horloge += 3600_000;
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion()))).toBe(u.id);
    const cle = await prisma.cleAcces.findFirstOrThrow();
    expect(cle.utiliseeLe?.toISOString()).toBe('2026-10-06T09:00:00.000Z');
  });

  it('une réponse rejouée est refusée : un défi ne sert qu\'une fois', async () => {
    const t = await inscrit();
    const r = t.authentifier(await service.optionsConnexion());
    expect(await service.verifierConnexion(r)).toBe(u.id);
    expect(await service.verifierConnexion(r)).toBeNull();
  });

  it('un compteur toujours nul (clés Android) passe ; un compteur qui recule est refusé', async () => {
    const nul = await inscrit();
    expect(await service.verifierConnexion(nul.authentifier(await service.optionsConnexion()))).toBe(u.id);
    expect(await service.verifierConnexion(nul.authentifier(await service.optionsConnexion()))).toBe(u.id);

    await viderBase(prisma);
    u = await prisma.utilisateur.create({ data: { nom: 'l' }, select: { id: true, nom: true } });
    const croissant = await inscrit(telephone(true));
    expect(await service.verifierConnexion(croissant.authentifier(await service.optionsConnexion()))).toBe(u.id);
    expect(await service.verifierConnexion(croissant.authentifier(await service.optionsConnexion()))).toBe(u.id);
    expect((await prisma.cleAcces.findFirstOrThrow()).compteur).toBe(2n);
    expect(await service.verifierConnexion(croissant.authentifier(await service.optionsConnexion(), { compteur: 1 }))).toBeNull();
    expect(journal.at(-1)).toMatch(/compteur/);
  });

  it.each([
    [{ origine: 'https://organizer.djkix.ovh.exemple.net' }],
    [{ origine: 'http://organizer.djkix.ovh' }],
    [{ rpId: 'exemple.net' }],
    [{ type: 'webauthn.create' }],
    [{ sansUv: true }],
  ])('refuse une réponse faussée (%o)', async (f) => {
    const t = await inscrit();
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion(), f))).toBeNull();
    expect((await prisma.cleAcces.findFirstOrThrow()).utiliseeLe).toBeNull();
  });

  it('le compte renvoyé par le téléphone doit être celui de la clé, et il est exigé', async () => {
    const t = await inscrit();
    const autre = Buffer.from('00000000-0000-4000-8000-000000000000', 'utf8').toString('base64url');
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion(), { userHandle: autre }))).toBeNull();
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion(), { userHandle: null }))).toBeNull();
  });

  it('une clé retirée du serveur ne connecte plus', async () => {
    const t = await inscrit();
    await prisma.cleAcces.deleteMany();
    expect(await service.verifierConnexion(t.authentifier(await service.optionsConnexion()))).toBeNull();
  });

  it('un défi expiré, ou un défi d\'activation, ne sert pas à se connecter', async () => {
    const t = await inscrit();
    const o = await service.optionsConnexion();
    horloge += 120_001;
    expect(await service.verifierConnexion(t.authentifier(o))).toBeNull();
    const activation = await service.optionsInscription(u);
    expect(await service.verifierConnexion(t.authentifier({ challenge: activation.challenge }))).toBeNull();
  });

  it('un défi de connexion ne sert pas à activer une empreinte', async () => {
    const o = await service.optionsConnexion();
    expect(await service.inscrire(u, telephone().inscrire({ ...(await service.optionsInscription(u)), challenge: o.challenge }))).toBeNull();
  });
});

describe('retirerEmpreintes (CLI, téléphone perdu)', () => {
  it('retire toutes les clés du compte et ferme ses sessions, sans toucher à l\'autre compte', async () => {
    const autre = await prisma.utilisateur.create({ data: { nom: 'f' } });
    const cle = (identifiant: string, utilisateurId: string) => ({ identifiant, utilisateurId, clePublique: new Uint8Array([1]) });
    await prisma.cleAcces.createMany({ data: [cle('a', u.id), cle('b', u.id), cle('c', autre.id)] });
    const expireLe = new Date('2027-01-01T00:00:00Z');
    await prisma.session.createMany({ data: [{ jetonHash: 'x', utilisateurId: u.id, expireLe }, { jetonHash: 'y', utilisateurId: autre.id, expireLe }] });
    expect(await retirerEmpreintes(prisma, 'l')).toBe(2);
    expect(await prisma.cleAcces.findMany({ select: { identifiant: true } })).toEqual([{ identifiant: 'c' }]);
    expect(await prisma.session.findMany({ select: { jetonHash: true } })).toEqual([{ jetonHash: 'y' }]);
  });

  it('compte inconnu : erreur claire', async () => {
    await expect(retirerEmpreintes(prisma, 'inconnu')).rejects.toThrow('Compte introuvable.');
  });
});
