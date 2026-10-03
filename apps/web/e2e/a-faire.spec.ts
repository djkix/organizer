import { expect, test } from '@playwright/test';
import { CONNECTE, json, ligne, simuler, type Table } from './simul';

const garage = ligne(1, 'Rappeler le garage', { echeanceType: 'datee', echeanceDate: '2026-10-06T08:00:00.000Z' });
const draps = ligne(2, 'Changer les draps', { echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' });

const table = (): Table => ({
  ...CONNECTE,
  'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [garage, draps], suggestions: [] }),
  'GET /api/vues/semaine': json(200, { jours: [{ jour: '2026-10-07', actions: [draps] }] }),
  [`POST /api/items/${garage.itemId}/fait`]: json(204),
  [`DELETE /api/items/${garage.itemId}/fait`]: json(204),
});

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
});

test('cocher d\'un geste, annuler, puis laisser passer les 10 s', async ({ page }) => {
  const appels = await simuler(page, table());
  const compte = (cle: string): number => appels.filter((a) => a.cle === cle).length;
  await page.goto('/');
  const caseGarage = page.getByRole('checkbox', { name: 'Cocher : Rappeler le garage' });

  await caseGarage.click();
  await expect(caseGarage).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Fait.')).toBeVisible();
  await expect.poll(() => compte(`POST /api/items/${garage.itemId}/fait`)).toBe(1);

  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(caseGarage).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => compte(`DELETE /api/items/${garage.itemId}/fait`)).toBe(1);

  await caseGarage.click();
  await page.clock.fastForward(10_000);
  await expect(page.getByText('Rappeler le garage')).toHaveCount(0);
  await expect(page.getByText('Fait.')).toHaveCount(0);
  expect(compte(`DELETE /api/items/${garage.itemId}/fait`)).toBe(1);
});

test('les onglets Semaine et Horizons, et un état vide neutre', async ({ page }) => {
  await simuler(page, { ...table(), 'GET /api/vues/horizons': json(200, { bornes: [] }) });
  await page.goto('/');
  await page.getByRole('link', { name: 'Semaine' }).click();
  await expect(page.getByRole('heading', { name: 'Cette semaine' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Demain' })).toBeVisible();
  await page.getByRole('link', { name: 'Horizons' }).click();
  await expect(page.getByText('Rien en attente.')).toBeVisible();
});

test('cibles de 48 px, texte de 17 px, actions principales dans le tiers bas', async ({ page }) => {
  await simuler(page, table());
  await page.goto('/');
  await expect(page.getByText('Rappeler le garage')).toBeVisible();
  for (const el of await page.locator('main button:visible, main a:visible, nav a:visible, a.fab').all()) {
    const b = (await el.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(48);
    expect(b.height).toBeGreaterThanOrEqual(48);
  }
  expect(await page.locator('.texte').first().evaluate((e) => getComputedStyle(e).fontSize)).toBe('17px');
  const hauteur = page.viewportSize()!.height;
  expect((await page.getByRole('link', { name: 'Enregistrement privé' }).boundingBox())!.y).toBeGreaterThan((hauteur * 2) / 3);
  await page.getByRole('checkbox', { name: 'Cocher : Rappeler le garage' }).click();
  expect((await page.getByRole('button', { name: 'Annuler' }).boundingBox())!.y).toBeGreaterThan((hauteur * 2) / 3);
});
