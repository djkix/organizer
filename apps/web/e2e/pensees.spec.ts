import { expect, test } from '@playwright/test';
import { CONNECTE, corpsDe, json, simuler } from './simul';

const P1 = { itemId: '00000000-0000-4000-8000-0000000000a1', captureId: '00000000-0000-4001-8000-0000000000a1', texte: 'Je devrais marcher davantage le soir, ça me fait du bien.', heure: '20:00', theme: 'santé', personnes: [], aAudio: true };
const P2 = { itemId: '00000000-0000-4000-8000-0000000000a2', captureId: '00000000-0000-4001-8000-0000000000a2', texte: 'Je réfléchis à changer de travail l\'an prochain.', heure: '10:00', theme: 'travail', personnes: ['Paul'], aAudio: false };
const VUE = { jours: [{ jour: '2026-10-07', pensees: [P1, P2] }], themes: ['santé', 'travail'], personnes: ['Paul'] };

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T10:00:00Z') });
});

test('barre : À faire, Pensées, Privé, Réglages ; l\'Historique est dans Réglages', async ({ page }) => {
  await simuler(page, {
    ...CONNECTE, 'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-08', actions: [], suggestions: [] }),
    'GET /api/empreintes': json(200, []), 'GET /api/agenda': json(200, { etat: 'deconnecte' }), 'GET /api/historique': json(200, []),
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navigation' });
  await expect(nav.getByRole('link')).toHaveText(['À faire', 'Pensées', 'Privé', 'Réglages']);
  await nav.getByRole('link', { name: 'Réglages' }).click();
  await page.getByRole('link', { name: 'Historique des envois' }).click();
  await expect(page).toHaveURL(/\/historique$/);
  await expect(nav.getByRole('link', { name: 'Réglages' })).toHaveAttribute('aria-current', 'page');
});

test('Pensées : par jour, sans case à cocher, filtres par thème et par personne', async ({ page }) => {
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/pensees': (r) => {
      const q = new URL(r.request().url()).searchParams;
      const jours = q.get('personne') === 'Paul' ? [{ jour: '2026-10-07', pensees: [P2] }] : q.get('mois') === '2026-10' ? VUE.jours : [];
      return r.fulfill({ status: 200, json: { ...VUE, jours } });
    },
  });
  await page.goto('/pensees');
  await expect(page.getByRole('heading', { name: 'Pensées', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hier' })).toBeVisible();
  await expect(page.getByText(P1.texte)).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Paul', exact: true }).click();
  await expect(page.getByText(P1.texte)).toHaveCount(0);
  await expect(page.getByText(P2.texte)).toBeVisible();
  expect(appels.some((a) => a.cle === 'GET /api/pensees')).toBe(true);
  await page.getByRole('button', { name: 'Toutes', exact: true }).click();
  await expect(page.getByText(P1.texte)).toBeVisible();
});

test('détail : ce que tu as dit, « C\'est une chose à faire », effacer en deux temps', async ({ page }) => {
  let vue = VUE;
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/pensees': (r) => r.fulfill({ status: 200, json: vue }),
    [`GET /api/captures/${P1.captureId}/transcription`]: json(200, { texte: 'Je me dis que je devrais marcher davantage le soir.' }),
    [`PATCH /api/items/${P1.itemId}`]: (r) => { vue = { ...VUE, jours: [{ jour: '2026-10-07', pensees: [P2] }] }; return r.fulfill({ status: 204 }); },
    [`DELETE /api/items/${P2.itemId}`]: json(204),
  });
  await page.goto('/pensees');
  await page.getByRole('button', { name: /marcher davantage/ }).click();
  const d = page.getByRole('dialog');
  await expect(d).toContainText('« Je me dis que je devrais marcher davantage le soir. »');
  await d.getByRole('button', { name: "C'est une chose à faire" }).click();
  await expect.poll(() => corpsDe(appels, `PATCH /api/items/${P1.itemId}`)).toEqual({ nature: 'action' });
  await expect(page.getByText(P1.texte)).toHaveCount(0);
  await expect(page.getByText('Rangé dans les choses à faire.')).toBeVisible();

  await page.getByRole('button', { name: /changer de travail/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Effacer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Effacer' }).click();
  await expect(page.getByText(P2.texte)).toHaveCount(0);
  await page.clock.fastForward(4_900);
  expect(appels.filter((a) => a.cle === `DELETE /api/items/${P2.itemId}`)).toHaveLength(0);
  await page.clock.fastForward(200);
  await expect.poll(() => appels.filter((a) => a.cle === `DELETE /api/items/${P2.itemId}`).length).toBe(1);
});
