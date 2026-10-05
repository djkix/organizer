import { expect, test } from '@playwright/test';
import { CONNECTE, json, simuler, type Appel, type Table } from './simul';

const ORDINAIRE = 'POST /api/captures';
const PRIVE = 'POST /api/captures/privees';
const envois = (appels: Appel[], cle: string): Appel[] => appels.filter((a) => a.cle === cle);
const ACCUEIL: Table = { ...CONNECTE, 'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }) };

async function enregistrerUnPeu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: "Commencer l'enregistrement" }).click();
  await expect(page.getByRole('heading', { name: "J'écoute" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Arrêter et garder' }).click();
}

test('l\'accueil porte deux grands boutons côte à côte, dans le tiers inférieur', async ({ page }) => {
  await simuler(page, ACCUEIL);
  await page.goto('/');
  const ordinaire = page.getByRole('link', { name: /Enregistrer/ });
  const prive = page.getByRole('link', { name: 'Enregistrement privé' });
  await expect(ordinaire).toBeVisible();
  await expect(prive).toBeVisible();
  await expect(ordinaire).toContainText('Rangé tout seul');
  await expect(prive).toContainText('Reste sur le serveur');
  const a = (await ordinaire.boundingBox())!;
  const b = (await prive.boundingBox())!;
  expect(a.height).toBeGreaterThanOrEqual(64);
  expect(b.height).toBeGreaterThanOrEqual(64);
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  expect(a.x).toBeLessThan(b.x);
  const hauteur = page.viewportSize()!.height;
  expect(a.y).toBeGreaterThan((hauteur * 2) / 3);
});

test('enregistrer en ordinaire : POST /api/captures, jamais la route privée, puis « Reçu. »', async ({ page }) => {
  const appels = await simuler(page, { ...ACCUEIL, [ORDINAIRE]: json(201, { id: 'x' }), [PRIVE]: json(201, { id: 'x' }) });
  await page.goto('/');
  await page.getByRole('link', { name: /Enregistrer/ }).click();
  await expect(page).toHaveURL(/\/enregistrer$/);
  await expect(page.getByText('Envoyé au tri.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mode privé' })).toHaveCount(0);
  await enregistrerUnPeu(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Reçu.')).toBeVisible();
  expect(envois(appels, ORDINAIRE)).toHaveLength(1);
  expect(envois(appels, ORDINAIRE)[0]!.entetes['x-capture-id']).toMatch(/^[0-9a-f-]{36}$/);
  expect(envois(appels, PRIVE)).toHaveLength(0);
});

test('enregistrer en privé : POST /api/captures/privees, jamais la route ordinaire', async ({ page }) => {
  const appels = await simuler(page, {
    ...ACCUEIL, 'GET /api/captures/privees': json(200, []), [ORDINAIRE]: json(201, { id: 'x' }), [PRIVE]: json(201, { id: 'x' }),
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Enregistrement privé' }).click();
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
  await enregistrerUnPeu(page);
  await expect(page).toHaveURL(/\/prive$/);
  await expect.poll(() => envois(appels, PRIVE).length).toBe(1);
  expect(envois(appels, ORDINAIRE)).toHaveLength(0);
});

test('INVARIANT : hors ligne, une capture privée et une ordinaire en file repartent chacune vers leur seule route', async ({ page }) => {
  let reseau = false;
  const depot = (r: import('@playwright/test').Route) => (reseau ? r.fulfill({ status: 201, json: { id: 'x' } }) : r.abort('internetdisconnected'));
  const appels = await simuler(page, { ...ACCUEIL, 'GET /api/captures/privees': json(200, []), [ORDINAIRE]: depot, [PRIVE]: depot });

  await page.goto('/prive/enregistrer');
  await enregistrerUnPeu(page);
  await expect(page).toHaveURL(/\/prive$/);
  await expect.poll(() => envois(appels, PRIVE).length).toBeGreaterThan(0);
  const idPrive = envois(appels, PRIVE)[0]!.entetes['x-capture-id'];

  await page.goto('/enregistrer');
  await enregistrerUnPeu(page);
  await expect(page).toHaveURL(/\/$/);
  // Hors ligne, le vidage s'arrête au premier échec : l'ordinaire attend derrière, il ne passe jamais ailleurs.
  const avant = envois(appels, PRIVE).length;
  expect(envois(appels, ORDINAIRE).length).toBeLessThanOrEqual(1);

  // La file privée n'affiche pas l'ordinaire.
  await page.goto('/prive');
  await expect(page.getByText('Il partira au retour du réseau.')).toHaveCount(1);

  reseau = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Il partira au retour du réseau.')).toHaveCount(0);
  await expect.poll(() => envois(appels, ORDINAIRE).length).toBeGreaterThan(0);
  expect(envois(appels, PRIVE).length).toBeGreaterThan(avant);
  const idOrdinaire = envois(appels, ORDINAIRE)[0]!.entetes['x-capture-id'];
  expect(idOrdinaire).not.toBe(idPrive);

  const sur = (cle: string) => new Set(envois(appels, cle).map((a) => a.entetes['x-capture-id']));
  expect(sur(PRIVE)).toEqual(new Set([idPrive]));
  expect(sur(ORDINAIRE)).toEqual(new Set([idOrdinaire]));
});
