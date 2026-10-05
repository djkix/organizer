import { expect, test, type Page } from '@playwright/test';
import { simuler, type Appel } from './simul';
import { authentificateurVirtuel, compterInvites, invites, serveurEmpreinte } from './webauthn';

test.use({ baseURL: 'http://localhost:4173' });

const DEPOT = 'POST /api/captures/privees';
const BOUTON_EMPREINTE = "Me connecter avec l'empreinte";

async function activer(page: Page): Promise<void> {
  await page.goto('/reglages');
  await page.getByRole('button', { name: "Activer l'empreinte" }).click();
  await expect(page.getByText('Empreinte activée sur ce téléphone.')).toBeVisible();
  await expect(page.getByText('Ce téléphone', { exact: true })).toBeVisible();
}

async function enregistrer(page: Page): Promise<void> {
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
  await page.getByRole('button', { name: "Commencer l'enregistrement" }).click();
  await expect(page.getByRole('heading', { name: "J'écoute" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Arrêter et garder' }).click();
}

test('activer l\'empreinte dans Réglages, puis se reconnecter sans mot de passe, sous la CSP', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener('securitypolicyviolation', (e) => { w.violations.push(`${e.violatedDirective} ${e.blockedURI}`); });
  });
  await authentificateurVirtuel(page);
  const s = serveurEmpreinte({ connecte: true });
  const appels = await simuler(page, s.table);

  const r = await page.goto('/reglages');
  expect(r?.headers()['permissions-policy']).toContain('publickey-credentials-get=(self)');
  await activer(page);
  await expect(page.getByRole('button', { name: "Activer l'empreinte" })).toHaveCount(0);

  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible();

  expect(appels.some((a) => a.cle === 'POST /api/session')).toBe(false);
  expect(s.erreurs).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { violations: string[] }).violations)).toEqual([]);
});

test('session expirée, empreinte active : le raccourci privé enregistre sans invite, la capture part après l\'empreinte', async ({ page }) => {
  await compterInvites(page);
  await authentificateurVirtuel(page);
  const etat = { connecte: true };
  const s = serveurEmpreinte(etat);
  const appels: Appel[] = await simuler(page, {
    ...s.table,
    [DEPOT]: (r) => (etat.connecte
      ? r.fulfill({ status: 201, json: { id: 'x' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
  });
  await activer(page);

  etat.connecte = false;
  await page.goto('/prive/enregistrer');
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await enregistrer(page);
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByText('Il partira après ta connexion.')).toBeVisible();
  // Rien ne s'est mis devant l'enregistrement, et l'écran de connexion n'a rien ouvert de lui-même.
  expect(await invites(page)).toBe(0);

  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await invites(page)).toBe(1);
  await expect.poll(() => appels.filter((a) => a.cle === DEPOT).length).toBeGreaterThanOrEqual(2);
  expect(new Set(appels.filter((a) => a.cle === DEPOT).map((a) => a.entetes['x-capture-id'])).size).toBe(1);
  expect(s.erreurs).toEqual([]);
});

test('une empreinte refusée se dit calmement ; le mot de passe reste là', async ({ page }) => {
  await authentificateurVirtuel(page);
  const etat = { connecte: true };
  const s = serveurEmpreinte(etat);
  await simuler(page, s.table);
  await activer(page);
  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);

  s.table['POST /api/session/empreinte'] = (r) => r.fulfill({ status: 401, json: { message: 'Empreinte non reconnue. Essaie ton mot de passe.' } });
  s.table['POST /api/session'] = (r) => {
    etat.connecte = true;
    return r.fulfill({ status: 204 });
  };
  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page.getByText('Empreinte non reconnue. Essaie ton mot de passe.')).toBeVisible();
  await page.getByLabel('Nom').fill('test');
  await page.getByLabel('Mot de passe').fill('un mot de passe assez long');
  await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('retirer l\'empreinte de ce téléphone : Réglages la repropose, la connexion n\'offre plus que le mot de passe', async ({ page }) => {
  await authentificateurVirtuel(page);
  const s = serveurEmpreinte({ connecte: true });
  await simuler(page, s.table);
  await activer(page);
  await page.getByRole('button', { name: /^Retirer/ }).click();
  await expect(page.getByText('Empreinte retirée.')).toBeVisible();
  await expect(page.getByRole('button', { name: "Activer l'empreinte" })).toBeVisible();
  expect(s.cles).toEqual([]);

  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByRole('button', { name: 'Me connecter', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: BOUTON_EMPREINTE })).toHaveCount(0);
});

test('API d\'empreinte indisponible (503) : message calme, mot de passe toujours là', async ({ page }) => {
  await authentificateurVirtuel(page);
  const etat = { connecte: true };
  const s = serveurEmpreinte(etat);
  await simuler(page, s.table);
  await activer(page);
  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);

  // Le serveur dit « x » : le texte affiché vient du client, pas de l'API.
  s.table['POST /api/session/empreinte/options'] = (r) => r.fulfill({ status: 503, json: { message: 'x' } });
  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page.getByText('Empreinte indisponible. Essaie ton mot de passe.')).toBeVisible();
  await expect(page.getByText('x', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Mot de passe')).toBeVisible();
});

test('mémo vide, clé déjà sur le téléphone : « déjà active », puis le bouton de connexion revient', async ({ page }) => {
  await authentificateurVirtuel(page);
  const etat = { connecte: true };
  const s = serveurEmpreinte(etat);
  await simuler(page, s.table);
  await activer(page);
  // PWA réinstallée : la clé est toujours sur le téléphone, le mémo local a disparu.
  await page.evaluate(() => localStorage.removeItem('organizer.empreinte'));
  // Le serveur exclut les clés connues : le téléphone répond « déjà active ».
  await page.reload();
  await expect(page.getByRole('button', { name: "Activer l'empreinte" })).toBeVisible();
  await page.getByRole('button', { name: "Activer l'empreinte" }).click();
  await expect(page.getByText("L'empreinte est déjà active sur ce téléphone.")).toBeVisible();
  await expect(page.getByRole('button', { name: "Activer l'empreinte" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('organizer.empreinte'))).toBe('?');

  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  await page.getByRole('button', { name: BOUTON_EMPREINTE }).click();
  await expect(page).toHaveURL(/\/$/);
  const memo = await page.evaluate(() => localStorage.getItem('organizer.empreinte'));
  expect(memo).toBe(s.cles[0]?.identifiant);
  expect(s.erreurs).toEqual([]);
});
