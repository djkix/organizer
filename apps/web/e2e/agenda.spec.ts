import { expect, test } from '@playwright/test';
import { CONNECTE, corpsDe, json, ligne, simuler } from './simul';

const rdv = ligne(1, 'Dentiste', { echeanceType: 'datee', echeanceDate: '2026-10-14T08:00:00.000Z' });
const draps = ligne(2, 'Changer les draps', { echeanceType: 'jour', echeanceDate: '2026-10-05T22:00:00.000Z' });
const REGLAGES = { ...CONNECTE, 'GET /api/empreintes': json(200, []) };

test('alarme : un interrupteur sur un rendez-vous daté, rien sur un jour sans heure', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T07:00:00Z') });
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [rdv, draps], suggestions: [] }),
    [`PATCH /api/items/${rdv.itemId}`]: json(204),
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Dentiste/ }).click();
  const interrupteur = page.getByRole('switch', { name: 'Alarme 10 minutes avant' });
  await expect(interrupteur).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Elle sonne par Google Agenda, seulement pour ce rendez-vous.')).toBeVisible();
  await interrupteur.click();
  await expect.poll(() => corpsDe(appels, `PATCH /api/items/${rdv.itemId}`)).toEqual({ alarme: true });
  await expect(page.getByText('Alarme activée, 10 minutes avant.')).toBeVisible();
  await page.getByRole('button', { name: /Changer les draps/ }).click();
  await expect(page.getByRole('switch')).toHaveCount(0);
});

test('Réglages : « Connecter Google Agenda » mène à l\'écran de Google', async ({ page }) => {
  await simuler(page, {
    ...REGLAGES,
    'GET /api/agenda': json(200, { etat: 'deconnecte', erreur: null }),
    'POST /api/agenda/connexion': json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=s' }),
  });
  await page.route('https://accounts.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Écran de Google</p>' }));
  await page.goto('/reglages');
  await expect(page.getByText('Tes rendez-vous datés peuvent aller dans ton Google Agenda.')).toBeVisible();
  await page.getByRole('button', { name: 'Connecter Google Agenda' }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
});

test('retour de Google : « en cours » puis connecté, adresse nettoyée, déconnexion', async ({ page }) => {
  let n = 0;
  await simuler(page, {
    ...REGLAGES,
    'GET /api/agenda': (route) => route.fulfill({ status: 200, json: n++ === 0 ? { etat: 'en_cours', erreur: null } : { etat: n > 3 ? 'deconnecte' : 'connecte', erreur: null } }),
    'DELETE /api/agenda': json(202),
  });
  await page.goto('/reglages?agenda=retour');
  await expect(page.getByText('Tes rendez-vous datés vont dans Google Agenda.')).toBeVisible();
  await expect(page).toHaveURL(/\/reglages$/);
  n = 3;
  await page.getByRole('button', { name: 'Déconnecter Google Agenda' }).click();
  await expect(page.getByText("L'agenda Organizer reste dans ton Google Agenda.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connecter Google Agenda' })).toBeVisible();
});

test('refus et accès décoché : des mots calmes, le bouton reste', async ({ page }) => {
  await simuler(page, { ...REGLAGES, 'GET /api/agenda': json(200, { etat: 'echec', erreur: 'portee_refusee' }) });
  await page.goto('/reglages?agenda=refus');
  await expect(page.getByText("Connexion annulée. Rien n'a changé.")).toBeVisible();
  await expect(page.getByText("Coche l'accès à l'agenda pour connecter.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connecter Google Agenda' })).toBeVisible();
});
