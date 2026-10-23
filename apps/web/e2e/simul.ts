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
    const gestion = table[cle] ?? DEFAUTS[cle];
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

/** Réponses par défaut, que la table d'un test peut remplacer. Sans identifiant client : formulaire déplié. */
const DEFAUTS: Table = { 'GET /api/session/google': json(200, { clientId: null }) };

export const CONNECTE: Table = { 'GET /api/session/moi': json(200, { nom: 'test', admin: false }) };

// Faux Google Identity Services : un bouton à la largeur demandée, qui rend un jeton fabriqué.
const FAUX_GIS = `window.google = { accounts: { id: {
  initialize(o) { window.__rappel = o.callback; },
  renderButton(el, o) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Continuer avec Google';
    b.style.minHeight = '44px'; b.style.width = o.width + 'px';
    b.onclick = () => window.__rappel({ credential: 'jeton-essai' }); el.appendChild(b);
  },
} } };`;
export const GIS = 'https://accounts.google.com/gsi/client';
export const servirGis = (page: Page) => page.route(GIS, (r) => r.fulfill({ contentType: 'text/javascript', body: FAUX_GIS }));
/** Sans session, avec un identifiant client fabriqué : l'écran de connexion propose Google. */
export const SANS_SESSION_GOOGLE: Table = {
  'GET /api/session/moi': json(401, { message: 'Connecte-toi pour continuer.' }),
  'GET /api/session/google': json(200, { clientId: 'client-essai.apps.googleusercontent.com' }),
};
