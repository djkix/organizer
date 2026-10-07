import { expect, test } from '@playwright/test';
import { CONNECTE, json, ligne, simuler, type Table } from './simul';

const garage = ligne(1, 'Rappeler le garage', { echeanceType: 'datee', echeanceDate: '2026-10-06T08:00:00.000Z' });
const draps = ligne(2, 'Changer les draps', { echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' });

const POST = `POST /api/items/${garage.itemId}/fait`;
const DELETE = `DELETE /api/items/${garage.itemId}/fait`;

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
  await expect.poll(() => compte(`POST /api/items/${garage.itemId}/fait`)).toBe(2);
  const ecritures = appels.map((a) => a.cle).filter((c) => c.includes('/fait'));
  expect(ecritures).toEqual([POST, DELETE, POST]);
});

test('Annuler avant la réponse du cochage : le DELETE part après le POST', async ({ page }) => {
  let liberer!: () => void;
  const attente = new Promise<void>((ok) => { liberer = ok; });
  const appels = await simuler(page, {
    ...table(),
    [POST]: async (route) => { await attente; await route.fulfill({ status: 204 }); },
  });
  await page.goto('/');
  const caseGarage = page.getByRole('checkbox', { name: 'Cocher : Rappeler le garage' });
  await caseGarage.click();
  await expect.poll(() => appels.some((a) => a.cle === POST)).toBe(true);
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(caseGarage).toHaveAttribute('aria-checked', 'false');
  await page.waitForTimeout(100);
  expect(appels.map((a) => a.cle).filter((c) => c.includes('/fait'))).toEqual([POST]);
  liberer();
  await expect.poll(() => appels.map((a) => a.cle).filter((c) => c.includes('/fait'))).toEqual([POST, DELETE]);
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

test('cibles de 48 px, texte de 16 px, actions principales dans le tiers bas', async ({ page }) => {
  await simuler(page, table());
  await page.goto('/');
  await expect(page.getByText('Rappeler le garage')).toBeVisible();
  for (const el of await page.locator('main button:visible, main a:visible, nav a:visible, a.fab').all()) {
    const b = (await el.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(48);
    expect(b.height).toBeGreaterThanOrEqual(48);
  }
  expect(await page.locator('.texte').first().evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px');
  const hauteur = page.viewportSize()!.height;
  expect((await page.getByRole('link', { name: 'Enregistrement privé' }).boundingBox())!.y).toBeGreaterThan((hauteur * 2) / 3);
  await page.getByRole('checkbox', { name: 'Cocher : Rappeler le garage' }).click();
  expect((await page.getByRole('button', { name: 'Annuler' }).boundingBox())!.y).toBeGreaterThan((hauteur * 2) / 3);
});

test('une ligne cochée qui quitte la liste : le focus passe à la suivante, sinon au titre', async ({ page }) => {
  await simuler(page, { ...table(), [`POST /api/items/${draps.itemId}/fait`]: json(204) });
  await page.goto('/');
  const premiere = page.getByRole('checkbox', { name: 'Cocher : Rappeler le garage' });
  await premiere.click();
  await expect(premiere).toBeFocused();
  await page.clock.fastForward(10_000);
  await expect(page.getByText('Rappeler le garage')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Cocher : Changer les draps' })).toBeFocused();

  await page.getByRole('checkbox', { name: 'Cocher : Changer les draps' }).click();
  await page.clock.fastForward(10_000);
  await expect(page.getByText('Changer les draps')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
});

test.describe('effacer', () => {
  const EFFACER = `DELETE /api/items/${garage.itemId}`;
  /** Après l'effacement, le serveur ne renvoie plus la ligne. */
  const serveur = (): Table => {
    let efface = false;
    return {
      ...table(),
      'GET /api/vues/aujourdhui': (r) => r.fulfill({ status: 200, json: { jour: '2026-10-06', actions: efface ? [draps] : [garage, draps], suggestions: [] } }),
      [EFFACER]: (r) => { efface = true; return r.fulfill({ status: 204 }); },
    };
  };
  const ligneGarage = (page: import('@playwright/test').Page) => page.locator(`[data-item="${garage.itemId}"]`);
  async function glisser(page: import('@playwright/test').Page): Promise<void> {
    const b = (await ligneGarage(page).locator('.piste').boundingBox())!;
    await page.mouse.move(b.x + b.width - 30, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 80, b.y + b.height / 2 + 2, { steps: 4 });
    await page.mouse.move(b.x + b.width - 170, b.y + b.height / 2 + 3, { steps: 4 });
    await page.mouse.up();
  }

  test('glisser, confirmer : la ligne disparaît, une seule requête', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await ligneGarage(page).getByRole('button', { name: /^Effacer/ }).click();
    const dialogue = page.getByRole('alertdialog', { name: 'Effacer cette note ?' });
    await expect(dialogue).toBeVisible();
    await dialogue.getByRole('button', { name: 'Effacer' }).click();
    await expect(ligneGarage(page)).toHaveCount(0);
    await expect(page.getByText('Changer les draps')).toBeVisible();
    expect(appels.filter((a) => a.cle === EFFACER)).toHaveLength(1);
  });

  test('glisser, annuler : la ligne reste, rien n\'est envoyé', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await ligneGarage(page).getByRole('button', { name: /^Effacer/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler' }).click();
    await expect(ligneGarage(page)).toHaveCount(1);
    expect(appels.filter((a) => a.cle === EFFACER)).toHaveLength(0);
  });

  test('ouverte, un appui ailleurs la referme sans confirmation', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await expect(ligneGarage(page).getByRole('button', { name: /^Effacer/ })).toBeVisible();
    await page.getByRole('heading').first().click();
    await expect(ligneGarage(page).getByRole('button', { name: /^Effacer/ })).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(appels.filter((a) => a.cle === EFFACER)).toHaveLength(0);
  });

  test('ouverte, le premier appui sur la case d\'une autre ligne ne fait que refermer', async ({ page }) => {
    await simuler(page, { ...serveur(), [`POST /api/items/${draps.itemId}/fait`]: (r) => r.fulfill({ status: 204 }) });
    await page.goto('/');
    await glisser(page);
    const caseDraps = page.getByRole('checkbox', { name: 'Cocher : Changer les draps' });
    await caseDraps.click();
    await expect(ligneGarage(page).getByRole('button', { name: /^Effacer/ })).toHaveCount(0);
    await expect(caseDraps).toHaveAttribute('aria-checked', 'false');
    await caseDraps.click();
    await expect(caseDraps).toHaveAttribute('aria-checked', 'true');
  });

  test('ouverte, un glissement vers la droite la referme', async ({ page }) => {
    await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    const b = (await ligneGarage(page).locator('.piste').boundingBox())!;
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 100, y);
    await page.mouse.down();
    await page.mouse.move(b.x + 150, y + 2, { steps: 4 });
    await page.mouse.move(b.x + 230, y + 3, { steps: 4 });
    await page.mouse.up();
    await expect(ligneGarage(page).getByRole('button', { name: /^Effacer/ })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('depuis le détail : même confirmation', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await page.getByText('Rappeler le garage').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Effacer' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer' }).click();
    await expect(ligneGarage(page)).toHaveCount(0);
    expect(appels.filter((a) => a.cle === EFFACER)).toHaveLength(1);
  });

  test('le serveur ne répond pas : la ligne revient avec un mot calme', async ({ page }) => {
    await simuler(page, { ...table(), [EFFACER]: (r) => r.abort('internetdisconnected') });
    await page.goto('/');
    await glisser(page);
    await ligneGarage(page).getByRole('button', { name: /^Effacer/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer' }).click();
    await expect(page.getByText('Pas effacé. Réessaie dans un moment.')).toBeVisible();
    await expect(ligneGarage(page)).toHaveCount(1);
  });
});
