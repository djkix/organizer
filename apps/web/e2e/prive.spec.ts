import { expect, test, type Page } from '@playwright/test';
import { CONNECTE, json, simuler, type Appel, type Table } from './simul';

const DEPOT = 'POST /api/captures/privees';
const envois = (appels: Appel[]): Appel[] => appels.filter((a) => a.cle === DEPOT);

async function enregistrer(page: Page): Promise<void> {
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Mode privé' })).toBeVisible();
  await page.getByRole('button', { name: "Commencer l'enregistrement" }).click();
  await expect(page.getByRole('heading', { name: "J'écoute" })).toBeVisible();
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Arrêter et garder' }).click();
}

test('hors ligne, la capture privée reste sur le téléphone, puis part au retour du réseau', async ({ page }) => {
  let reseau = false;
  const table: Table = {
    ...CONNECTE,
    'GET /api/captures/privees': json(200, []),
    [DEPOT]: (r) => (reseau ? r.fulfill({ status: 201, json: { id: 'x' } }) : r.abort('internetdisconnected')),
  };
  const appels = await simuler(page, table);
  await page.goto('/prive/enregistrer');
  await enregistrer(page);

  await expect(page).toHaveURL(/\/prive$/);
  await expect(page.getByText('Il partira au retour du réseau.')).toBeVisible();
  await expect.poll(() => envois(appels).length).toBeGreaterThan(0);
  const premier = envois(appels)[0]!;
  const id = premier.entetes['x-capture-id'];
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(premier.entetes['content-type']).toMatch(/^audio\/webm/);
  expect(premier.entetes['x-emis-le']).toBeTruthy();

  await page.reload();
  await expect(page.getByText('Il partira au retour du réseau.')).toBeVisible();

  reseau = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Il partira au retour du réseau.')).toHaveCount(0);
  const dernier = envois(appels).at(-1)!;
  expect(dernier.entetes['x-capture-id']).toBe(id);
  expect(dernier.taille).toBeGreaterThan(0);
});

test('sans session, le raccourci ouvre quand même l\'enregistreur ; la capture part après la connexion', async ({ page }) => {
  let connecte = false;
  const table: Table = {
    'GET /api/session/moi': (r) => (connecte
      ? r.fulfill({ json: { nom: 'test' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
    'POST /api/session': (r) => {
      connecte = true;
      return r.fulfill({ status: 204 });
    },
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }),
    [DEPOT]: (r) => (connecte
      ? r.fulfill({ status: 201, json: { id: 'x' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
  };
  const appels = await simuler(page, table);
  await page.goto('/prive/enregistrer');
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await enregistrer(page);

  await expect(page).toHaveURL(/\/connexion$/);
  await expect(page.getByText('Il partira après ta connexion.')).toBeVisible();
  await page.getByLabel('Nom').fill('test');
  await page.getByLabel('Mot de passe').fill('un mot de passe assez long');
  await page.getByRole('button', { name: 'Me connecter' }).click();

  await expect.poll(() => envois(appels).length).toBeGreaterThanOrEqual(2);
  const ids = new Set(envois(appels).map((a) => a.entetes['x-capture-id']));
  expect(ids.size).toBe(1);
});

test('la vue Privé : par jour, lecteur ou note écrite, étiquette facultative', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T20:00:00Z') });
  const id = '00000000-0000-4000-8000-0000000000aa';
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/captures/privees': json(200, [
      { jour: '2026-10-05', captures: [
        { id, heure: '23:41', dureeS: 64, etiquette: null, aAudio: true },
        { id: '00000000-0000-4000-8000-0000000000bb', heure: '18:12', dureeS: null, etiquette: 'après le coup de fil', aAudio: false },
      ] },
    ]),
    [`PATCH /api/captures/privees/${id}`]: json(204),
  });
  await page.goto('/prive');
  await expect(page.getByRole('heading', { name: 'Hier' })).toBeVisible();
  await expect(page.getByText('23:41 · 1 min 04')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Écouter, 23:41' })).toBeVisible();
  await expect(page.getByText('Note écrite, gardée sur le serveur.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mois suivant' })).toBeDisabled();

  // Un mot existant s'affiche en titre, avec un crayon pour le changer.
  await expect(page.getByText('après le coup de fil')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Changer le mot : après le coup de fil' })).toBeVisible();

  await page.getByRole('button', { name: 'Ajouter un mot' }).click();
  await expect(page.getByLabel("Un mot pour t'y retrouver")).toBeFocused();
  await page.getByLabel("Un mot pour t'y retrouver").fill('au réveil');
  await page.getByRole('button', { name: 'Garder' }).click();
  await expect(page.getByText('au réveil')).toBeVisible();
  expect(appels.some((a) => a.cle === `PATCH /api/captures/privees/${id}`)).toBe(true);
  await page.getByRole('button', { name: 'Changer le mot : au réveil' }).click();
  await expect(page.getByLabel("Un mot pour t'y retrouver")).toHaveValue('au réveil');
  await expect(page.getByLabel("Un mot pour t'y retrouver")).toBeFocused();
  for (const b of await page.locator('main button:visible').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test('un refus définitif du serveur est dit calmement, la copie reste', async ({ page }) => {
  const appels = await simuler(page, { ...CONNECTE, 'GET /api/captures/privees': json(200, []), [DEPOT]: json(422) });
  await page.goto('/prive/enregistrer');
  await enregistrer(page);
  await expect(page).toHaveURL(/\/prive$/);
  await expect(page.getByText("Un enregistrement n'a pas pu partir.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Un enregistrement n'a pas pu partir.")).toBeVisible();
  expect(envois(appels).length).toBe(1);
});

test('si le téléphone ne peut pas garder, l\'audio reste en mémoire et part en direct', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new DOMException('indisponible', 'InvalidStateError'); };
  });
  let reseau = false;
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/captures/privees': json(200, []),
    [DEPOT]: (r) => (reseau ? r.fulfill({ status: 201, json: { id: 'x' } }) : r.abort('internetdisconnected')),
  });
  await page.goto('/prive/enregistrer');
  await enregistrer(page);
  await expect(page.getByText('Pas gardé sur le téléphone. Il reste ici, en mémoire.')).toBeVisible();
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await page.getByRole('button', { name: 'Envoyer maintenant' }).click();
  await expect(page.getByText('Pas parti. Il reste ici, réessaie dans un moment.')).toBeVisible();
  reseau = true;
  await page.getByRole('button', { name: 'Envoyer maintenant' }).click();
  await expect(page).toHaveURL(/\/prive$/);
  expect(envois(appels).at(-1)!.taille).toBeGreaterThan(0);
});

test('audio seulement en mémoire : le retour d\'Android ne quitte pas l\'écran, et l\'identifiant d\'envoi reste le même', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new DOMException('indisponible', 'InvalidStateError'); };
  });
  let reseau = false;
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/captures/privees': json(200, []),
    [DEPOT]: (r) => (reseau ? r.fulfill({ status: 201, json: { id: 'x' } }) : r.abort('internetdisconnected')),
  });
  await page.goto('/prive');
  await page.getByRole('link', { name: 'Enregistrement privé' }).click();
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await enregistrer(page);
  await expect(page.getByText('Pas gardé sur le téléphone. Il reste ici, en mémoire.')).toBeVisible();

  await page.goBack();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/prive\/enregistrer$/);
  await expect(page.getByRole('button', { name: 'Envoyer maintenant' })).toBeVisible();

  await page.getByRole('button', { name: 'Envoyer maintenant' }).click();
  await expect(page.getByText('Pas parti. Il reste ici, réessaie dans un moment.')).toBeVisible();
  reseau = true;
  await page.getByRole('button', { name: 'Envoyer maintenant' }).click();
  await expect(page).toHaveURL(/\/prive$/);
  const ids = new Set(envois(appels).map((a) => a.entetes['x-capture-id']));
  expect(ids.size).toBe(1);
});

test('micro occupé ou absent : un message précis ; double appui : un seul micro', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __ouvertures: number; __erreur: string };
    w.__ouvertures = 0;
    w.__erreur = 'NotReadableError';
    navigator.mediaDevices.getUserMedia = async () => {
      w.__ouvertures += 1;
      await new Promise((ok) => setTimeout(ok, 300));
      throw new DOMException('x', w.__erreur);
    };
  });
  await simuler(page, { ...CONNECTE });
  await page.goto('/prive/enregistrer');
  const bouton = page.getByRole('button', { name: "Commencer l'enregistrement" });
  await bouton.dblclick();
  await expect(page.getByText('Le micro est pris, par un appel peut-être.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __ouvertures: number }).__ouvertures)).toBe(1);
  await page.evaluate(() => { (window as unknown as { __erreur: string }).__erreur = 'NotFoundError'; });
  await bouton.click();
  await expect(page.getByText('Aucun micro trouvé sur ce téléphone.')).toBeVisible();
});

test('« Réessayer » après un envoi direct raté garde le même identifiant : pas de doublon', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __casse: boolean };
    w.__casse = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...a: Parameters<IDBObjectStore['put']>) {
      if (w.__casse) throw new DOMException('indisponible', 'InvalidStateError');
      return put.apply(this, a);
    };
  });
  const appels = await simuler(page, {
    ...CONNECTE,
    'GET /api/captures/privees': json(200, []),
    [DEPOT]: (r) => r.abort('internetdisconnected'),
  });
  await page.goto('/prive/enregistrer');
  await enregistrer(page);
  await expect(page.getByText('Pas gardé sur le téléphone. Il reste ici, en mémoire.')).toBeVisible();
  await page.getByRole('button', { name: 'Envoyer maintenant' }).click();
  await expect(page.getByText('Pas parti. Il reste ici, réessaie dans un moment.')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __casse: boolean }).__casse = false; });
  const avant = envois(appels).length;
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page).toHaveURL(/\/prive$/);
  await expect.poll(() => envois(appels).length).toBeGreaterThan(avant);
  const ids = new Set(envois(appels).map((a) => a.entetes['x-capture-id']));
  expect(ids.size).toBe(1);
});

test('écran verrouillé pendant l\'ouverture du micro : on arrête et on range, rien n\'écoute', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __ouvrir: () => void };
    const reel = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      await new Promise<void>((ok) => { w.__ouvrir = ok; });
      return reel(c);
    };
  });
  await simuler(page, { ...CONNECTE, 'GET /api/captures/privees': json(200, []) });
  await page.goto('/prive/enregistrer');
  await page.getByRole('button', { name: "Commencer l'enregistrement" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    (window as unknown as { __ouvrir: () => void }).__ouvrir();
  });
  await expect(page.getByRole('heading', { name: 'Enregistrement privé' })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(page.getByRole('heading', { name: "J'écoute" })).toHaveCount(0);
});

test('un play interrompu par un pause rapide n\'annonce pas « audio indisponible »', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('interrompu', 'AbortError'));
  });
  await simuler(page, {
    ...CONNECTE,
    'GET /api/captures/privees': json(200, [
      { jour: '2026-10-05', captures: [{ id: '00000000-0000-4000-8000-0000000000aa', heure: '23:41', dureeS: 64, etiquette: null, aAudio: true }] },
    ]),
  });
  await page.goto('/prive');
  await page.getByRole('button', { name: 'Écouter, 23:41' }).click();
  await page.waitForTimeout(300);
  await expect(page.getByText('Audio indisponible.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Écouter, 23:41' })).toBeVisible();
});
