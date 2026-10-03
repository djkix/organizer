import { creerPrisma } from '@organizer/db';
import { viderBase } from '@organizer/db/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LiaisonService } from '../src/telegram/liaison.service.js';

const prisma = creerPrisma();
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await viderBase(prisma);
  await prisma.utilisateur.createMany({ data: [{ nom: 'a' }, { nom: 'b' }] });
});

let horloge = new Date('2026-10-06T08:00:00Z');
const service = () => new LiaisonService(prisma, () => horloge);

describe('LiaisonService', () => {
  it('un code de six chiffres lie le chat au compte, une seule fois', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    const code = await service().creerCode('a');
    expect(code).toMatch(/^\d{6}$/);
    expect(await service().lier(code, 7)).toBe('lie');
    expect((await service().utilisateurDuChat(7))?.id).toBe((await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'a' } })).id);
    expect(await service().lier(code, 8)).toBe('invalide');
  });

  it('un code expire au bout de 10 minutes', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    const code = await service().creerCode('a');
    horloge = new Date('2026-10-06T08:10:01Z');
    expect(await service().lier(code, 7)).toBe('invalide');
  });

  it('un chat déjà lié à un autre compte est refusé', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    await service().lier(await service().creerCode('a'), 7);
    expect(await service().lier(await service().creerCode('b'), 7)).toBe('invalide');
  });

  it('un chat inconnu n\'a pas de compte', async () => {
    expect(await service().utilisateurDuChat(999)).toBeNull();
  });

  it('dix échecs bloquent toute liaison jusqu\'à la fin de la fenêtre', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    const code = await service().creerCode('a');
    const s = service();
    for (let i = 0; i < 10; i++) expect(await s.lier('000000', 100 + i)).toBe('invalide');
    expect(await s.lier(code, 7)).toBe('invalide');
    horloge = new Date('2026-10-06T08:10:01Z');
    const code2 = await s.creerCode('a');
    expect(await s.lier(code2, 7)).toBe('lie');
  });

  it('un compte déjà lié ne peut pas être pris par un autre chat', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    await service().lier(await service().creerCode('a'), 7);
    expect(await service().lier(await service().creerCode('a'), 8)).toBe('invalide');
    expect((await service().utilisateurDuChat(7))?.id).toBeDefined();
    expect(await service().utilisateurDuChat(8)).toBeNull();
  });

  it('le même chat peut se relier au même compte', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    await service().lier(await service().creerCode('a'), 7);
    expect(await service().lier(await service().creerCode('a'), 7)).toBe('lie');
  });

  it('délier libère le compte pour un nouveau chat', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    await service().lier(await service().creerCode('a'), 7);
    await service().delier('a');
    expect(await service().utilisateurDuChat(7)).toBeNull();
    expect(await service().lier(await service().creerCode('a'), 8)).toBe('lie');
  });

  it('deux usages simultanés du même code : un seul gagne', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    const code = await service().creerCode('a');
    const r = await Promise.all([service().lier(code, 7), service().lier(code, 8)]);
    expect([...r].sort()).toEqual(['invalide', 'lie']);
  });
});

describe('lierDirectement (CLI, avant la bascule)', () => {
  it('lier-chat lie un compte sans code, et le rejouer ne change rien', async () => {
    await service().lierDirectement('a', 7n);
    await service().lierDirectement('a', 7n);
    expect((await service().utilisateurDuChat(7))?.id).toBe((await prisma.utilisateur.findUniqueOrThrow({ where: { nom: 'a' } })).id);
  });

  it('refuse un chat déjà lié à un autre compte', async () => {
    await service().lierDirectement('a', 7n);
    await expect(service().lierDirectement('b', 7n)).rejects.toThrow('Ce chat est déjà lié à un autre compte.');
  });

  it('refuse d\'écraser le lien d\'un compte : delier d\'abord', async () => {
    await service().lierDirectement('a', 7n);
    await expect(service().lierDirectement('a', 8n)).rejects.toThrow('delier');
  });

  it('refuse un compte inconnu', async () => {
    await expect(service().lierDirectement('inconnu', 9n)).rejects.toThrow('Compte introuvable.');
  });
});

describe('purge des codes', () => {
  it('supprime les codes expirés, garde les valides', async () => {
    horloge = new Date('2026-10-06T08:00:00Z');
    await service().creerCode('a');
    horloge = new Date('2026-10-06T08:20:00Z');
    const valide = await service().creerCode('b');
    expect(await service().purgerCodesExpires()).toBe(1);
    expect((await prisma.codeLiaison.findMany()).map((c) => c.code)).toEqual([valide]);
  });
});
