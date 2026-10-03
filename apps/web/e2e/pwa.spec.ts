import { expect, test } from '@playwright/test';
import { ligne } from './simul';

test.use({ serviceWorkers: 'allow' });

test('le manifeste annonce le raccourci privé', async ({ request }) => {
  const m = (await (await request.get('/manifest.webmanifest')).json()) as { display: string; shortcuts: { url: string }[] };
  expect(m.display).toBe('standalone');
  expect(m.shortcuts[0]!.url).toBe('/prive/enregistrer');
});

test('la coquille s\'ouvre hors ligne, et /api ne vient jamais du cache', async ({ page, context }) => {
  let version = 1;
  await context.route('**/api/**', (route) => {
    const chemin = new URL(route.request().url()).pathname;
    if (chemin === '/api/session/moi') return route.fulfill({ json: { nom: 'test' } });
    if (chemin === '/api/vues/aujourdhui') {
      return route.fulfill({ json: { jour: '2026-10-06', actions: [ligne(1, `Version ${version}`)], suggestions: [] } });
    }
    return route.fulfill({ status: 404, json: { message: 'Introuvable.' } });
  });

  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.getByText('Version 1')).toBeVisible();
  version = 2;
  await page.reload();
  await expect(page.getByText('Version 2')).toBeVisible();

  await context.unroute('**/api/**');
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Enregistrement privé' })).toBeVisible();
  await expect(page.getByText('Pas de réseau. La liste reviendra.')).toBeVisible();
  await expect(page.getByText('Version 2')).toHaveCount(0);

  // Aucune réponse /api dans les caches du service worker.
  const urlsEnCache = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const nom of await caches.keys()) for (const r of await (await caches.open(nom)).keys()) urls.push(r.url);
    return urls;
  });
  expect(urlsEnCache.length).toBeGreaterThan(0);
  expect(urlsEnCache.filter((u) => new URL(u).pathname.startsWith('/api/'))).toEqual([]);
});

test('l\'enregistreur privé s\'ouvre hors ligne, comme depuis le raccourci Android', async ({ page, context }) => {
  await context.route('**/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Introuvable.' } }));
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();

  await context.unroute('**/api/**');
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await context.setOffline(true);
  await page.goto('/prive/enregistrer');
  await expect(page.getByText('Ça reste à la maison.')).toBeVisible();
  await expect(page.getByRole('button', { name: "Commencer l'enregistrement" })).toBeVisible();
});

test('le service worker vide la file privée sur la synchronisation « organizer-prive »', async ({ page, context }) => {
  const recus: { id: string | undefined; taille: number }[] = [];
  await context.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/captures/privees') {
      recus.push({ id: req.headers()['x-capture-id'], taille: req.postDataBuffer()?.length ?? 0 });
      return route.fulfill({ status: 201, json: { id: 'x' } });
    }
    return route.fulfill({ status: 404, json: { message: 'Introuvable.' } });
  });
  await page.goto('/connexion');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });

  // Une capture déjà en file, comme après une coupure.
  await page.evaluate(async () => {
    const base = await new Promise<IDBDatabase>((ok, ko) => {
      const r = indexedDB.open('organizer', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('captures-privees', { keyPath: 'id' });
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    await new Promise<void>((ok, ko) => {
      const tx = base.transaction('captures-privees', 'readwrite');
      tx.objectStore('captures-privees').put({
        id: '00000000-0000-4000-8000-0000000000aa', blob: new Blob(['abcd'], { type: 'audio/webm' }),
        mime: 'audio/webm', dureeS: 2, emisLe: '2026-10-06T08:00:00.000Z',
      });
      tx.oncomplete = () => ok();
      tx.onerror = () => ko(tx.error);
    });
    base.close();
  });

  const cdp = await context.newCDPSession(page);
  const idRegistration = new Promise<string>((ok) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e: { registrations: { registrationId: string }[] }) => {
      if (e.registrations[0]) ok(e.registrations[0].registrationId);
    });
  });
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.dispatchSyncEvent', { origin: new URL(page.url()).origin, registrationId: await idRegistration, tag: 'organizer-prive', lastChance: false });

  await expect.poll(() => recus.length).toBe(1);
  expect(recus[0]).toEqual({ id: '00000000-0000-4000-8000-0000000000aa', taille: 4 });
  await expect.poll(() => page.evaluate(async () => {
    const base = await new Promise<IDBDatabase>((ok) => { const r = indexedDB.open('organizer'); r.onsuccess = () => ok(r.result); });
    const n = await new Promise<number>((ok) => { const r = base.transaction('captures-privees').objectStore('captures-privees').count(); r.onsuccess = () => ok(r.result); });
    base.close();
    return n;
  })).toBe(0);
});
