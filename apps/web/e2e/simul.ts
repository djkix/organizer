import type { LigneAction } from '@organizer/shared/api';
import type { Page, Request, Route } from '@playwright/test';

export interface Appel { cle: string; entetes: Record<string, string>; texte: string | null; taille: number }
export type Gestion = (route: Route, req: Request) => Promise<void> | void;
/** Clé : « MÉTHODE /chemin », sans la requête. La table peut changer en cours de test. */
export type Table = Record<string, Gestion>;

export async function simuler(page: Page, table: Table): Promise<Appel[]> {
  const appels: Appel[] = [];
  await page.route('**/api/**', async (route, req) => {
    const cle = `${req.method()} ${new URL(req.url()).pathname}`;
    const json = req.headers()['content-type']?.startsWith('application/json') ?? false;
    appels.push({ cle, entetes: req.headers(), texte: json ? req.postData() : null, taille: req.postDataBuffer()?.length ?? 0 });
    const gestion = table[cle];
    await (gestion ? gestion(route, req) : route.fulfill({ status: 404, json: { message: 'Introuvable.' } }));
  });
  return appels;
}

export const json = (status: number, corps?: unknown): Gestion => (route) =>
  route.fulfill(corps === undefined ? { status } : { status, json: corps });

/** Corps JSON du dernier appel de cette clé. */
export function corpsDe(appels: Appel[], cle: string): unknown {
  const a = appels.filter((x) => x.cle === cle).at(-1);
  return a?.texte ? JSON.parse(a.texte) : undefined;
}

export function ligne(n: number, texte: string, plus: Partial<LigneAction> = {}): LigneAction {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return {
    itemId: id, captureId: id.replace('-4000-', '-4001-'), texte, theme: null, echeanceType: null, echeanceExpr: null,
    echeanceDate: null, fenetreFin: null, alarme: false, aAudio: false, ...plus,
  };
}

export const CONNECTE: Table = { 'GET /api/session/moi': json(200, { nom: 'test' }) };
