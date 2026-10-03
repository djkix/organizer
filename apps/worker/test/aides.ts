import type { PrismaClient } from '@organizer/db';
import { sortieExemple } from '../../../packages/shared/test/sortie-exemple.js';
import type { ClassificationProvider, EntreeClassement, ResultatClassement } from '../src/classement/provider.js';

export const resultatExemple = (): ResultatClassement => ({
  sortie: { ...sortieExemple(), items: sortieExemple().items.map((i) => ({ ...i, theme: i.theme.toLowerCase() })) },
  modele: 'modele-test', tokensEntree: 10, tokensSortie: 5,
});

export class FauxProvider implements ClassificationProvider {
  appels: EntreeClassement[] = [];
  constructor(public reponses: Array<ResultatClassement | Error> = []) {}

  async classer(e: EntreeClassement): Promise<ResultatClassement> {
    this.appels.push(e);
    const r = this.reponses.length > 1 ? this.reponses.shift() : this.reponses[0];
    if (!r) return resultatExemple();
    if (r instanceof Error) throw r;
    return r;
  }

  async verifierPalierPaye(): Promise<void> {}
}

export async function creerCaptureTexte(prisma: PrismaClient, texte = 'rappeler le garage jeudi'): Promise<{ id: string }> {
  const u = await prisma.utilisateur.upsert({ where: { nom: 'test' }, create: { nom: 'test' }, update: {} });
  return prisma.capture.create({
    data: {
      utilisateurId: u.id, canal: 'telegram', prive: false, etat: 'en_file',
      texteEcrit: texte, emisLe: new Date('2026-10-06T06:12:00Z'),
    },
    select: { id: true },
  });
}
