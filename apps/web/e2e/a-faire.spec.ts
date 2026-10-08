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
  const jours = page.getByRole('navigation', { name: 'Jours' });
  await expect(jours.locator('.jour')).toHaveCount(7);
  await expect(jours.locator('[aria-current="date"]')).toHaveCount(1);
  const lien = jours.getByRole('link').first();
  const cible = (await lien.getAttribute('href'))!;
  await expect(page.locator(cible)).toHaveCount(1);
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
  const dialogue = (page: import('@playwright/test').Page) => page.getByRole('alertdialog', { name: 'Effacer cette note ?' });
  async function glisser(page: import('@playwright/test').Page, distance = 170, vertical = 3): Promise<void> {
    const b = (await ligneGarage(page).locator('.piste').boundingBox())!;
    await page.mouse.move(b.x + b.width - 30, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 30 - distance / 3, b.y + b.height / 2 + vertical / 2, { steps: 4 });
    await page.mouse.move(b.x + b.width - 30 - distance, b.y + b.height / 2 + vertical, { steps: 4 });
    await page.mouse.up();
  }
  const requetes = (appels: { cle: string }[]) => appels.filter((a) => a.cle === EFFACER).length;

  test('glisser ouvre la confirmation tout de suite, la ligne revient en place', async ({ page }) => {
    await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await expect(dialogue(page)).toBeVisible();
    await expect(dialogue(page)).toContainText('Rappeler le garage');
    await expect(ligneGarage(page).locator('.piste')).toHaveAttribute('style', /translateX\(0px\)/);
    await expect(ligneGarage(page).getByRole('button', { name: /^Effacer/ })).toHaveCount(0);
  });

  test('un glissement court ou vertical n\'ouvre rien', async ({ page }) => {
    await simuler(page, serveur());
    await page.goto('/');
    await glisser(page, 60);
    await expect(dialogue(page)).toHaveCount(0);
    await glisser(page, 40, 160);
    await expect(dialogue(page)).toHaveCount(0);
  });

  test('confirmer : la ligne part, cinq secondes sans requête, puis une seule', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await expect(ligneGarage(page)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Effacé.' })).toBeVisible();
    await page.clock.fastForward(4_900);
    expect(requetes(appels)).toBe(0);
    await page.clock.fastForward(200);
    await expect.poll(() => requetes(appels)).toBe(1);
    await page.clock.fastForward(10_000);
    expect(requetes(appels)).toBe(1);
    await expect(page.getByText('Changer les draps')).toBeVisible();
  });

  test('« Annuler » dans les cinq secondes : la ligne revient, rien n\'est envoyé', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await expect(ligneGarage(page)).toHaveCount(0);
    await page.clock.fastForward(3_000);
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(ligneGarage(page)).toHaveCount(1);
    await page.clock.fastForward(10_000);
    expect(requetes(appels)).toBe(0);
  });

  test('« Annuler » dans la confirmation : rien ne change', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(ligneGarage(page)).toHaveCount(1);
    await page.clock.fastForward(10_000);
    expect(requetes(appels)).toBe(0);
  });

  test('depuis le détail : même confirmation, même délai', async ({ page }) => {
    const appels = await simuler(page, serveur());
    await page.goto('/');
    await page.getByText('Rappeler le garage').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Effacer' }).click();
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await expect(ligneGarage(page)).toHaveCount(0);
    await page.clock.fastForward(4_900);
    expect(requetes(appels)).toBe(0);
    await page.clock.fastForward(200);
    await expect.poll(() => requetes(appels)).toBe(1);
  });

  test('quitter l\'écran pendant le délai : l\'effacement part aussitôt', async ({ page }) => {
    const appels = await simuler(page, { ...serveur(), 'GET /api/captures/privees': json(200, []) });
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await page.getByRole('link', { name: 'Privé' }).last().click();
    await expect.poll(() => requetes(appels)).toBe(1);
  });

  test('le serveur ne répond pas : la ligne revient avec un mot calme', async ({ page }) => {
    await simuler(page, { ...table(), [EFFACER]: (r) => r.abort('internetdisconnected') });
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await page.clock.fastForward(5_100);
    await expect(page.getByText('Pas effacé. Réessaie dans un moment.')).toBeVisible();
    await expect(ligneGarage(page)).toHaveCount(1);
  });

  test('annuler un cochage ne fait pas revenir le bandeau d\'un effacement en attente', async ({ page }) => {
    await simuler(page, { ...serveur(), [`POST /api/items/${draps.itemId}/fait`]: json(204), [`DELETE /api/items/${draps.itemId}/fait`]: json(204) });
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await page.getByRole('checkbox', { name: 'Cocher : Changer les draps' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Fait.' })).toBeVisible();
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Effacé.' })).toHaveCount(0);
    await expect(ligneGarage(page)).toHaveCount(0);
  });

  test('un échec reste visible même si un autre effacement attend', async ({ page }) => {
    await simuler(page, { ...table(), [EFFACER]: (r) => r.abort('internetdisconnected'), [`DELETE /api/items/${draps.itemId}`]: json(204) });
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    const lDraps = page.locator(`[data-item="${draps.itemId}"]`);
    const b = (await lDraps.locator('.piste').boundingBox())!;
    await page.mouse.move(b.x + b.width - 30, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 90, b.y + b.height / 2 + 1, { steps: 4 });
    await page.mouse.move(b.x + b.width - 200, b.y + b.height / 2 + 2, { steps: 4 });
    await page.mouse.up();
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await expect(page.getByText('Pas effacé. Réessaie dans un moment.')).toBeVisible();
    await expect(ligneGarage(page)).toHaveCount(1);
  });

  test('après « Annuler », le focus revient sur la ligne rendue', async ({ page }) => {
    await simuler(page, serveur());
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByRole('checkbox', { name: 'Cocher : Rappeler le garage' })).toBeFocused();
  });

  test('aller-retour d\'écran pendant l\'envoi : la ligne effacée ne réapparaît pas', async ({ page }) => {
    await simuler(page, {
      ...table(), 'GET /api/pensees': json(200, { jours: [], themes: [], personnes: [] }),
      [EFFACER]: async (r) => { await new Promise((ok) => setTimeout(ok, 2_500)); await r.fulfill({ status: 204 }); },
    });
    await page.goto('/');
    await glisser(page);
    await dialogue(page).getByRole('button', { name: 'Effacer' }).click();
    await page.getByRole('link', { name: 'Pensées' }).click();
    await expect(page).toHaveURL(/pensees/);
    await page.getByRole('link', { name: 'À faire' }).click();
    await expect(page.getByText('Changer les draps')).toBeVisible();
    await expect(ligneGarage(page)).toHaveCount(0);
  });
});


test('focus clavier visible sur l\'onglet actif', async ({ page }) => {
  await simuler(page, table());
  await page.goto('/');
  const actif = page.getByRole('link', { name: "Aujourd'hui" }).first();
  await actif.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const style = await actif.evaluate((e) => { const s = getComputedStyle(e); return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`; });
  expect(style).toBe('solid 2px rgb(0, 103, 125)');
});

test('sur une carte haute, la case à cocher occupe toute la hauteur', async ({ page }) => {
  const longue = ligne(9, 'Penser à rappeler la mutuelle pour le remboursement des lunettes et demander le formulaire de prise en charge avant la fin du mois', {
    echeanceType: 'datee', echeanceDate: '2026-10-06T13:00:00.000Z', alarme: true,
  });
  await simuler(page, { ...table(), 'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [longue], suggestions: [] }) });
  await page.goto('/');
  const carte = page.locator('li.ligne').first();
  const caseB = (await carte.getByRole('checkbox').boundingBox())!;
  const carteB = (await carte.boundingBox())!;
  expect(caseB.height).toBeGreaterThan(carteB.height - 8);
});
