import { expect, test } from '@playwright/test';
import { corpsDe, GIS, json, SANS_SESSION_GOOGLE as SANS_SESSION, servirGis, simuler, type Table } from './simul';

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
    'GET /api/agenda': json(200, { etat: 'deconnecte', erreur: null }),
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


test('Google : le jeton part à l\'API et ouvre Aujourd\'hui', async ({ page }) => {
  let connecte = false;
  await servirGis(page);
  const appels = await simuler(page, {
    ...SANS_SESSION,
    'GET /api/session/moi': (r) => (connecte ? r.fulfill({ json: { nom: 'test' } }) : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
    'POST /api/session/google': (r) => { connecte = true; return r.fulfill({ status: 204 }); },
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }),
  });
  await page.goto('/connexion');
  await page.getByRole('button', { name: 'Continuer avec Google' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: "Aujourd'hui" })).toBeVisible();
  expect(corpsDe(appels, 'POST /api/session/google')).toEqual({ jeton: 'jeton-essai' });
  // Vrai rechargement : le script de Google ne survit pas à l'écran de connexion.
  expect(await page.evaluate(() => 'google' in window)).toBe(false);
});

test('Google : compte non reconnu, le message unique', async ({ page }) => {
  await servirGis(page);
  await simuler(page, { ...SANS_SESSION, 'POST /api/session/google': json(401, { message: "Ce compte Google n'est pas reconnu." }) });
  await page.goto('/connexion');
  await expect(page.getByLabel('Nom')).toBeHidden();
  await page.getByRole('button', { name: 'Continuer avec Google' }).click();
  await expect(page.getByText("Ce compte Google n'est pas reconnu.")).toHaveCount(1);
  await expect(page).toHaveURL(/\/connexion$/);
});

test('Google indisponible : formulaire déplié et message', async ({ page }) => {
  await page.route(GIS, (r) => r.abort());
  await simuler(page, SANS_SESSION);
  await page.goto('/connexion');
  await expect(page.getByLabel('Nom')).toBeVisible();
  await expect(page.getByText('Google indisponible. Utilise ton mot de passe.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toHaveCount(0);
});

test('sans identifiant client : formulaire déplié, pas de bouton Google', async ({ page }) => {
  let gis = false;
  await page.route(GIS, (r) => { gis = true; return r.abort(); });
  await simuler(page, { 'GET /api/session/moi': json(401, { message: 'Connecte-toi pour continuer.' }) });
  await page.goto('/connexion');
  await expect(page.getByLabel('Nom')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Me connecter', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Me connecter avec un mot de passe' })).toHaveCount(0);
  await expect(page.getByText('Google indisponible. Utilise ton mot de passe.')).toHaveCount(0);
  expect(gis).toBe(false);
});

test('lien du mot de passe sans attendre Google', async ({ page }) => {
  await page.route(GIS, async (r) => { await new Promise((ok) => setTimeout(ok, 5_000)); await r.abort().catch(() => undefined); });
  await simuler(page, SANS_SESSION);
  await page.goto('/connexion');
  await page.getByRole('button', { name: 'Me connecter avec un mot de passe' }).click({ timeout: 2_000 });
  await expect(page.getByLabel('Nom')).toBeVisible({ timeout: 1_000 });
});

test('le cadenas privé reste sur l\'écran de connexion', async ({ page }) => {
  await servirGis(page);
  await simuler(page, SANS_SESSION);
  await page.goto('/connexion');
  await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Enregistrement privé' })).toBeVisible();
});

test('le cadenas depuis la connexion laisse le script Google derrière lui', async ({ page }) => {
  await servirGis(page);
  await simuler(page, SANS_SESSION);
  await page.goto('/connexion');
  await expect(page.getByRole('button', { name: 'Continuer avec Google' })).toBeVisible();
  await page.getByRole('link', { name: 'Enregistrement privé' }).click();
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
  expect(await page.evaluate(() => 'google' in window)).toBe(false);
});

test('Google : certificats injoignables, message et formulaire déplié', async ({ page }) => {
  await servirGis(page);
  await simuler(page, { ...SANS_SESSION, 'POST /api/session/google': json(503, { message: 'Google indisponible. Utilise ton mot de passe.' }) });
  await page.goto('/connexion');
  await expect(page.getByLabel('Nom')).toBeHidden();
  await page.getByRole('button', { name: 'Continuer avec Google' }).click();
  await expect(page.getByText('Google indisponible. Utilise ton mot de passe.')).toHaveCount(1);
  await expect(page.getByLabel('Nom')).toBeVisible();
  await expect(page).toHaveURL(/\/connexion$/);
});
