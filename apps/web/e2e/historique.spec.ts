import { expect, test } from '@playwright/test';
import { CONNECTE, json, simuler } from './simul';

const ID = '00000000-0000-4001-8000-000000000001';
const MOIS = [
  { jour: '2026-10-06', envois: [
    { id: ID, heure: '12:05', source: 'pwa', vocal: true, dureeS: 42, debut: 'Rendez-vous chez le dentiste vendredi à 15 heures.', etat: 'classee', natures: ['action', 'pensee'] },
    { id: '00000000-0000-4001-8000-000000000002', heure: '08:30', source: 'telegram', vocal: true, dureeS: null, debut: null, etat: 'en_cours', natures: [] },
  ] },
  { jour: '2026-10-05', envois: [
    { id: '00000000-0000-4001-8000-000000000003', heure: '21:40', source: 'telegram', vocal: false, dureeS: null, debut: 'Truc à voir avec Paul.', etat: 'a_revoir', natures: ['ambigu'] },
  ] },
];
const DETAIL = {
  id: ID, emisLe: '2026-10-06T10:05:00.000Z', source: 'pwa', vocal: true, dureeS: 42, etat: 'classee',
  texte: 'Rendez-vous chez le dentiste vendredi à 15 heures. Et penser à marcher davantage.', aAudio: true,
  elements: [
    { itemId: 'i1', texte: 'Rendez-vous chez le dentiste', nature: 'action', statut: 'a_faire' },
    { itemId: 'i2', texte: 'Marcher davantage', nature: 'pensee', statut: 'note' },
    { itemId: 'i3', texte: 'Ancienne action', nature: 'action', statut: 'efface' },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T14:00:00Z') });
});

test('onglet Historique : les envois du mois par jour, avec source, début et pastilles', async ({ page }) => {
  await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }),
    'GET /api/historique': (r) => r.fulfill({ status: 200, json: new URL(r.request().url()).searchParams.get('mois') === '2026-10' ? MOIS : [] }),
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navigation' });
  await expect(nav.getByRole('link')).toHaveCount(4);
  await nav.getByRole('link', { name: 'Historique' }).click();
  await expect(page).toHaveURL(/\/historique$/);
  await expect(page.getByRole('heading', { name: 'Historique', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hier' })).toBeVisible();
  const premier = page.getByRole('button', { name: /12:05/ });
  await expect(premier).toContainText('Vocal · 42 s');
  await expect(premier).toContainText('Rendez-vous chez le dentiste');
  await expect(premier).toContainText('Action');
  await expect(premier).toContainText('Pensée');
  await expect(page.getByRole('button', { name: /08:30/ })).toContainText('En cours de tri');
  await expect(page.getByRole('button', { name: /08:30/ })).toContainText('Pas encore transcrit.');
  await expect(page.getByRole('button', { name: /21:40/ })).toContainText('Écrit');
  await expect(page.getByRole('button', { name: 'Mois suivant' })).toBeDisabled();
  await page.getByRole('button', { name: 'Mois précédent' }).click();
  await expect(page.getByText('Rien ce mois-ci.')).toBeVisible();
});

test('détail d\'un envoi : texte entier, lecteur, ce qui en est sorti ; Retour', async ({ page }) => {
  await simuler(page, {
    ...CONNECTE,
    'GET /api/historique': json(200, MOIS),
    [`GET /api/historique/${ID}`]: json(200, DETAIL),
  });
  await page.goto('/historique');
  await page.getByRole('button', { name: /12:05/ }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('heading', { name: 'Mardi 6 octobre, 12:05' })).toBeVisible();
  await expect(d).toContainText('Et penser à marcher davantage.');
  await expect(d.getByRole('button', { name: 'Réécouter' })).toBeVisible();
  const elements = d.getByRole('listitem');
  await expect(elements).toHaveCount(3);
  await expect(elements.nth(0)).toContainText('À faire');
  await expect(elements.nth(1)).not.toContainText('À faire');
  await expect(elements.nth(2)).toContainText('Effacé');
  // Détail ouvert : la barre du bas et le bouton privé, cachés sous le panneau, sont hors d'atteinte.
  await expect(d).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('nav[aria-label="Navigation"]')).toHaveAttribute('inert', '');
  await expect(page.locator('.fab')).toHaveAttribute('inert', '');
  await d.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('nav[aria-label="Navigation"]')).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: /12:05/ })).toBeFocused();
});
