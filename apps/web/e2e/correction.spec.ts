import { expect, test } from '@playwright/test';
import { CONNECTE, corpsDe, json, ligne, simuler } from './simul';

const garage = ligne(1, 'Rappeler le garage', { echeanceType: 'datee', echeanceDate: '2026-10-06T08:00:00.000Z', aAudio: true });
const draps = ligne(2, 'Changer les draps');

test('deux gestes : ouvrir, puis « pas une chose à faire » ou une date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [garage, draps], suggestions: [] }),
    [`PATCH /api/items/${garage.itemId}`]: json(204),
    [`PATCH /api/items/${draps.itemId}`]: json(204),
  });
  await page.goto('/');

  await page.getByRole('button', { name: /Rappeler le garage/ }).click();
  await expect(page.getByText('Mardi 6 octobre, 10:00')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réécouter' })).toBeVisible();
  await page.getByRole('button', { name: "Ce n'est pas une chose à faire" }).click();
  await expect.poll(() => corpsDe(appels, `PATCH /api/items/${garage.itemId}`)).toEqual({ nature: 'pensee' });
  await expect(page.getByText('Rangé dans les pensées.')).toBeVisible();

  await page.getByRole('button', { name: /Changer les draps/ }).click();
  await page.getByLabel('Un jour').fill('2026-10-08');
  await expect.poll(() => corpsDe(appels, `PATCH /api/items/${draps.itemId}`))
    .toEqual({ echeance: { type: 'jour', date: '2026-10-08T00:00:00+02:00' } });
});

test('À revoir : trancher un item ambigu ; une capture seule reste en lecture', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/a-revoir': json(200, {
      items: [{ itemId: garage.itemId, captureId: garage.captureId, texte: 'vendredi ou samedi', emisLe: '2026-10-06T06:12:00.000Z', aAudio: true }],
      captures: [{ captureId: draps.captureId, texte: null, emisLe: '2026-10-05T18:00:00.000Z', aAudio: true }],
    }),
    [`PATCH /api/items/${garage.itemId}`]: json(204),
  });
  await page.goto('/a-revoir');
  await expect(page.getByText('Vocal sans texte.')).toBeVisible();
  await page.getByRole('button', { name: "C'est à faire" }).click();
  await expect.poll(() => corpsDe(appels, `PATCH /api/items/${garage.itemId}`))
    .toEqual({ nature: 'action', echeance: { type: 'jour', date: '2026-10-06T00:00:00+02:00' } });
  await expect(page.getByText('« vendredi ou samedi »')).toHaveCount(0);
  await expect(page.getByRole('button', { name: "C'est à faire" })).toHaveCount(0);
});

test('pastilles : alarme dans la liste, « À revoir » sur une pensée ambiguë', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [{ ...garage, alarme: true }, draps], suggestions: [] }),
    'GET /api/vues/a-revoir': json(200, {
      items: [{ itemId: draps.itemId, captureId: draps.captureId, texte: 'peut-être une idée', emisLe: '2026-10-06T06:12:00.000Z', aAudio: false }],
      captures: [],
    }),
  });
  await page.goto('/');
  const l = page.locator(`[data-item="${garage.itemId}"]`);
  await expect(l.getByText('Alarme', { exact: true })).toBeVisible();
  await expect(l.getByText('10:00', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Rappeler le garage.*Alarme/ })).toBeVisible();
  await page.goto('/a-revoir');
  await expect(page.locator('article').filter({ hasText: 'peut-être une idée' }).getByText('À revoir', { exact: true })).toBeVisible();
});

test('À revoir : effacer après confirmation, cinq secondes pour annuler, puis une seule requête', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/a-revoir': json(200, {
      items: [{ itemId: garage.itemId, captureId: garage.captureId, texte: 'vendredi ou samedi', emisLe: '2026-10-06T06:12:00.000Z', aAudio: false }],
      captures: [],
    }),
    [`DELETE /api/items/${garage.itemId}`]: json(204),
  });
  await page.goto('/a-revoir');
  await page.getByRole('button', { name: 'Effacer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByText('« vendredi ou samedi »')).toBeVisible();
  expect(appels.filter((a) => a.cle === `DELETE /api/items/${garage.itemId}`)).toHaveLength(0);
  const requetes = () => appels.filter((a) => a.cle === `DELETE /api/items/${garage.itemId}`).length;
  await page.getByRole('button', { name: 'Effacer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer' }).click();
  await expect(page.getByText('« vendredi ou samedi »')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Effacé.' })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.getByText('« vendredi ou samedi »')).toBeVisible();
  await expect(page.locator(`[data-item="${garage.itemId}"] button`).first()).toBeFocused();
  await page.clock.fastForward(10_000);
  expect(requetes()).toBe(0);

  await page.getByRole('button', { name: 'Effacer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer' }).click();
  await page.clock.fastForward(4_900);
  expect(requetes()).toBe(0);
  await page.clock.fastForward(200);
  await expect.poll(requetes).toBe(1);
});

test.describe('focus et retour du détail', () => {
  const montage = async (page: import('@playwright/test').Page) => {
    await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
    const appels = await simuler(page, {
      ...CONNECTE,
      'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [garage, draps], suggestions: [] }),
      [`PATCH /api/items/${draps.itemId}`]: async (route) => { await new Promise((r) => setTimeout(r, 700)); await route.fulfill({ status: 204 }); },
      [`POST /api/items/${garage.itemId}/fait`]: json(204),
      [`DELETE /api/items/${garage.itemId}/fait`]: json(204),
    });
    await page.goto('/');
    return appels;
  };
  const ligneDraps = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /Changer les draps/ });
  const detail = (page: import('@playwright/test').Page) => page.getByRole('dialog');

  test('le focus entre dans le détail, le fond est inerte, Échap ferme et rend le focus à la ligne', async ({ page }) => {
    await montage(page);
    await ligneDraps(page).click();
    await expect(detail(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
    await expect(page.locator('main')).toHaveJSProperty('inert', true);
    await expect(page.getByRole('navigation', { name: 'Navigation' })).toHaveJSProperty('inert', true);

    await page.keyboard.press('Escape');
    await expect(detail(page)).toHaveCount(0);
    await expect(page.locator('main')).toHaveJSProperty('inert', false);
    await expect(ligneDraps(page)).toBeFocused();
  });

  test('le geste retour d\'Android ferme le détail et reste sur À faire', async ({ page }) => {
    await montage(page);
    await ligneDraps(page).click();
    await expect(detail(page)).toBeVisible();
    await page.goBack();
    await expect(detail(page)).toHaveCount(0);
    await expect(page).toHaveURL(/127\.0\.0\.1:4173\/?(\?.*)?$/);
    await expect(page.getByRole('heading', { name: 'Aujourd\'hui' })).toBeVisible();
    await expect(ligneDraps(page)).toBeFocused();
  });

  test('Retour et fermeture ne laissent pas d\'entrée d\'historique en trop', async ({ page }) => {
    await montage(page);
    const avant = await page.evaluate(() => history.length);
    await ligneDraps(page).click();
    await page.getByRole('button', { name: 'Retour' }).click();
    await expect(detail(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => history.state?.['sveltekit:states']?.detail ?? null)).toBeNull();
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(avant + 1);
  });

  test('le bandeau d\'annulation reste au-dessus du détail', async ({ page }) => {
    await montage(page);
    await page.getByRole('checkbox', { name: 'Cocher : Rappeler le garage' }).click();
    await ligneDraps(page).click();
    await expect(detail(page)).toBeVisible();
    const annuler = page.getByRole('button', { name: 'Annuler' });
    await expect(annuler).toBeVisible();
    await annuler.click({ trial: true });
  });

  test('un champ date garde son focus pendant l\'envoi', async ({ page }) => {
    await montage(page);
    await ligneDraps(page).click();
    const champ = page.getByLabel('Un jour');
    await champ.focus();
    await champ.fill('2026-10-08');
    await expect(champ).toHaveAttribute('aria-disabled', 'true');
    await expect(champ).toBeFocused();
    await expect(champ).not.toHaveAttribute('disabled', '');
  });

  test('après une correction qui retire la ligne, le focus va au titre de la page', async ({ page }) => {
    const appels = await montage(page);
    let corrige = false;
    await page.route('**/api/vues/aujourdhui', (route) => route.fulfill({
      json: { jour: '2026-10-06', actions: corrige ? [garage] : [garage, draps], suggestions: [] },
    }));
    await page.route(`**/api/items/${draps.itemId}`, async (route) => { corrige = true; await route.fulfill({ status: 204 }); });
    await ligneDraps(page).click();
    await page.getByRole('button', { name: "Ce n'est pas une chose à faire" }).click();
    await expect(detail(page)).toHaveCount(0);
    await expect(ligneDraps(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H1');
    expect(appels.length).toBeGreaterThan(0);
  });
});

test('une date corrigée est annoncée d\'une phrase courte', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [draps], suggestions: [] }),
    [`PATCH /api/items/${draps.itemId}`]: json(204),
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Changer les draps/ }).click();
  await page.getByLabel('Un jour').fill('2026-10-08');
  await expect(page.getByRole('status').filter({ hasText: "C'est noté." })).toBeVisible();
});

test('détail : « Ce que tu as dit » montre la transcription ; sans elle, le lecteur seul', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [garage, draps], suggestions: [] }),
    [`GET /api/captures/${garage.captureId}/transcription`]: json(200, { texte: 'Rappeler le garage demain à 10 heures.' }),
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Rappeler le garage/ }).click();
  await expect(page.getByText('« Rappeler le garage demain à 10 heures. »')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réécouter' })).toBeVisible();
  await page.getByRole('button', { name: 'Retour' }).click();

  // Ni transcription (404 du simulateur) ni audio : pas de carte du tout, aucun message d'erreur.
  await page.getByRole('button', { name: /Changer les draps/ }).click();
  await expect(page.getByRole('heading', { name: 'Quand' })).toBeVisible();
  await expect(page.getByText('Ce que tu as dit')).toHaveCount(0);
});

test('après « Lire tout », le focus va sur la transcription dépliée', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [garage], suggestions: [] }),
    [`GET /api/captures/${garage.captureId}/transcription`]: json(200, { texte: 'Rappeler le garage demain. '.repeat(20) }),
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Rappeler le garage/ }).click();
  await page.getByRole('button', { name: 'Lire tout' }).click();
  await expect(page.locator('blockquote.dit')).toBeFocused();
});
