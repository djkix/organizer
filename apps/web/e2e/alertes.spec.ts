import { expect, test } from '@playwright/test';
import { CONNECTE, json, simuler, type Table } from './simul';

const ADMIN: Table = { 'GET /api/session/moi': json(200, { nom: 'f', admin: true, versionServeur: '1.7.0' }) };
const VIDE = { 'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-08', actions: [], suggestions: [] }), 'GET /api/empreintes': json(200, []), 'GET /api/agenda': json(200, { etat: 'deconnecte' }) };
const ALERTE = { id: 'a1', message: 'Crédit Gemini épuisé : classement suspendu.', creeLe: '2026-10-08T07:30:00.000Z', vue: false };

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T10:00:00Z') });
});

test('admin : un point sur Réglages, la liste des alertes, « Tout marquer comme vu »', async ({ page }) => {
  let vues = false;
  const appels = await simuler(page, {
    ...ADMIN, ...VIDE,
    'GET /api/alertes': (r) => r.fulfill({ status: 200, json: { alertes: [{ ...ALERTE, vue: vues }], nonVues: !vues } }),
    'POST /api/alertes/vues': (r) => { vues = true; return r.fulfill({ status: 204 }); },
  });
  await page.goto('/');
  const reglages = page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name: /Réglages/ });
  await expect(reglages.locator('.point')).toBeVisible();
  await expect(reglages).toHaveAccessibleName('Réglages, alerte technique à voir');
  await reglages.click();
  await expect(page.getByRole('heading', { name: 'Alertes techniques' })).toBeVisible();
  await expect(page.getByText('Crédit Gemini épuisé : classement suspendu.')).toBeVisible();
  await page.getByRole('button', { name: 'Tout marquer comme vu' }).click();
  await expect(reglages.locator('.point')).toHaveCount(0);
  expect(appels.filter((a) => a.cle === 'POST /api/alertes/vues')).toHaveLength(1);
});

test('admin sans alerte : ni point, « Aucune alerte. »', async ({ page }) => {
  await simuler(page, { ...ADMIN, ...VIDE, 'GET /api/alertes': json(200, { alertes: [], nonVues: false }) });
  await page.goto('/reglages');
  await expect(page.getByText('Aucune alerte.')).toBeVisible();
  await expect(page.locator('nav[aria-label="Navigation"] .point')).toHaveCount(0);
});

test('compte ordinaire : ni point, ni section, aucune requête d\'alertes', async ({ page }) => {
  const appels = await simuler(page, { ...CONNECTE, ...VIDE });
  await page.goto('/reglages');
  await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alertes techniques' })).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Navigation"] .point')).toHaveCount(0);
  expect(appels.filter((a) => a.cle.includes('/api/alertes'))).toHaveLength(0);
});

test('changement de compte sur le même téléphone : le point de l\'admin ne reste pas pour L', async ({ page }) => {
  let qui: 'admin' | 'l' | null = 'admin';
  await simuler(page, {
    ...VIDE,
    'GET /api/session/moi': (r) => (qui === null ? r.fulfill({ status: 401, json: { message: 'Non connecté.' } })
      : r.fulfill({ status: 200, json: qui === 'admin' ? { nom: 'f', admin: true, versionServeur: '1.7.0' } : { nom: 'l', admin: false } })),
    'GET /api/alertes': json(200, { alertes: [ALERTE], nonVues: true }),
    'DELETE /api/session': (r) => { qui = null; return r.fulfill({ status: 204 }); },
    'POST /api/session': (r) => { qui = 'l'; return r.fulfill({ status: 204 }); },
    'GET /api/empreintes/options-connexion': json(404),
  });
  await page.goto('/reglages');
  const point = page.locator('nav[aria-label="Navigation"] .point');
  await expect(point).toBeVisible();
  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await page.getByLabel('Nom').fill('l');
  await page.getByLabel('Mot de passe').fill('un mot de passe assez long');
  await page.getByRole('button', { name: /Me connecter|Connexion|Entrer/ }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
  await expect(point).toHaveCount(0);
});
