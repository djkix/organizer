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
  await expect.poll(() => corpsDe(appels, `PATCH /api/items/${garage.itemId}`)).toEqual({ nature: 'action' });
  await expect(page.getByText('« vendredi ou samedi »')).toHaveCount(0);
  await expect(page.getByRole('button', { name: "C'est à faire" })).toHaveCount(0);
});
