import { expect, test, type Page } from '@playwright/test';
import { CONNECTE, json, ligne, simuler } from './simul';

// Textes fabriqués, longs exprès : rien ne doit déborder à 360 px, en clair comme en sombre.
const longue = ligne(1, 'Penser à rappeler la mutuelle pour le remboursement des lunettes et demander le formulaire de prise en charge avant la fin du mois', {
  echeanceType: 'datee', echeanceDate: '2026-10-06T13:00:00.000Z', alarme: true, aAudio: true,
});
const jour = ligne(2, 'Appeler le garage', { echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' });
const MOT = 'Une idée pour le week-end, à reprendre calmement quand il y aura un moment tranquille ce soir';

const table = {
  ...CONNECTE,
  'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [longue, jour], suggestions: [] }),
  'GET /api/vues/semaine': json(200, { jours: [{ jour: '2026-10-06', actions: [longue] }, { jour: '2026-10-08', actions: [jour] }] }),
  [`GET /api/captures/${longue.captureId}/transcription`]: json(200, { texte: 'Penser à rappeler la mutuelle. '.repeat(20) }),
  'GET /api/captures/privees': json(200, [
    { jour: '2026-10-06', captures: [{ id: '00000000-0000-4000-8000-0000000000aa', heure: '12:06', dureeS: 7, etiquette: MOT.slice(0, 80), aAudio: true }] },
  ]),
};

async function sansDebordement(page: Page): Promise<void> {
  const { large, vue } = await page.evaluate(() => ({ large: document.documentElement.scrollWidth, vue: window.innerWidth }));
  expect(large).toBeLessThanOrEqual(vue);
  for (const el of await page.locator('main button:visible, main a:visible, nav a:visible').all()) {
    expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}

for (const schema of ['light', 'dark'] as const) {
  for (const taille of [{ width: 360, height: 780 }, { width: 390, height: 844 }]) {
    test(`apparence ${schema} à ${taille.width} px : accueil, semaine, détail, Privé`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema });
      await page.setViewportSize(taille);
      await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
      await simuler(page, table);

      await page.goto('/');
      await expect(page.getByText(/Penser à rappeler la mutuelle/)).toBeVisible();
      await expect(page.getByText('Dans la journée')).toBeVisible();
      await sansDebordement(page);

      await page.getByRole('link', { name: 'Semaine' }).click();
      await expect(page.getByRole('navigation', { name: 'Jours' })).toBeVisible();
      await sansDebordement(page);

      await page.getByRole('link', { name: "Aujourd'hui" }).click();
      await page.getByRole('button', { name: /Penser à rappeler la mutuelle/ }).click();
      await expect(page.getByRole('button', { name: 'Lire tout' })).toBeVisible();
      const { large, vue } = await page.evaluate(() => ({ large: document.documentElement.scrollWidth, vue: window.innerWidth }));
      expect(large).toBeLessThanOrEqual(vue);
      await page.getByRole('button', { name: 'Retour' }).click();

      await page.goto('/prive');
      await expect(page.getByText(MOT.slice(0, 80))).toBeVisible();
      await sansDebordement(page);
    });
  }
}

test('le thème sombre forcé par data-theme prend les jetons sombres', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await simuler(page, table);
  await page.goto('/');
  await expect(page.getByText(/Penser à rappeler la mutuelle/)).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 20, 22)');
});
