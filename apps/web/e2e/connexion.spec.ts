import { expect, test } from '@playwright/test';
import { json, simuler, type Table } from './simul';

test('sans session, la connexion ; un mauvais mot de passe le dit ; le bon ouvre Aujourd\'hui', async ({ page }) => {
  let connecte = false;
  const table: Table = {
    'GET /api/session/moi': (r) => (connecte
      ? r.fulfill({ json: { nom: 'test' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
    'POST /api/session': (r, req) => {
      if ((req.postDataJSON() as { motDePasse: string }).motDePasse !== 'le bon mot de passe') {
        return r.fulfill({ status: 401, json: { message: 'Identifiants invalides.' } });
      }
      connecte = true;
      return r.fulfill({ status: 204 });
    },
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }),
  };
  await simuler(page, table);

  await page.goto('/');
  await expect(page).toHaveURL(/\/connexion$/);
  await page.getByLabel('Nom').fill('test');
  await page.getByLabel('Mot de passe').fill('mauvais');
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(page.getByText('Identifiants invalides.')).toBeVisible();

  await page.getByLabel('Mot de passe').fill('le bon mot de passe');
  await page.getByRole('button', { name: 'Me connecter' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible();
});

test('la déconnexion depuis Réglages ramène à la connexion', async ({ page }) => {
  let connecte = true;
  const appels = await simuler(page, {
    'GET /api/session/moi': (r) => (connecte
      ? r.fulfill({ json: { nom: 'test' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
    'DELETE /api/session': (r) => {
      connecte = false;
      return r.fulfill({ status: 204 });
    },
  });
  await page.goto('/reglages');
  await expect(page.getByText('Ce qui sort de la maison')).toBeVisible();
  await page.getByRole('button', { name: 'Me déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion$/);
  expect(appels.some((a) => a.cle === 'DELETE /api/session')).toBe(true);
});

test('sur un réseau muet, l\'écran s\'affiche après 2,5 s ; un 401 tardif ramène à la connexion', async ({ page }) => {
  let repondre!: () => void;
  const attente = new Promise<void>((ok) => { repondre = ok; });
  await simuler(page, {
    'GET /api/session/moi': async (r) => { await attente; await r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } }); },
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }),
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible({ timeout: 8_000 });
  await expect(page).toHaveURL(/\/$/);
  repondre();
  await expect(page).toHaveURL(/\/connexion$/);
});

test('depuis la connexion, le bouton violet mène à l\'enregistreur privé', async ({ page }) => {
  await simuler(page, { 'GET /api/session/moi': json(401, { message: 'Connecte-toi pour continuer.' }) });
  await page.goto('/connexion');
  await page.getByRole('link', { name: 'Enregistrement privé' }).click();
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
});
