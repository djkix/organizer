import { expect, test, type Page } from '@playwright/test';
import { CONNECTE, json, simuler } from './simul';

async function surveillerViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { violations: string[] };
    w.violations = [];
    document.addEventListener('securitypolicyviolation', (e) => { w.violations.push(`${e.violatedDirective} ${e.blockedURI}`); });
  });
}

const violations = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { violations: string[] }).violations);

test('la coquille démarre sous la CSP sans violation', async ({ page }) => {
  await surveillerViolations(page);
  await simuler(page, { ...CONNECTE, 'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }) });
  const r = await page.goto('/');
  expect(r?.headers()['content-security-policy']).toContain("script-src 'self' 'sha256-");
  expect(r?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  await expect(page.locator('h1')).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test('l\'enregistreur privé enregistre sous la CSP, micro compris', async ({ page }) => {
  await surveillerViolations(page);
  await simuler(page, { ...CONNECTE, 'GET /api/captures/privees': json(200, []), 'POST /api/captures/privees': json(201, { id: 'x' }) });
  const r = await page.goto('/prive/enregistrer');
  expect(r?.headers()['permissions-policy']).toContain('microphone=(self)');
  await page.getByRole('button', { name: "Commencer l'enregistrement" }).click();
  await expect(page.getByRole('heading', { name: "J'écoute" })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Arrêter et garder' }).click();
  await expect(page).toHaveURL(/\/prive$/);
  expect(await violations(page)).toEqual([]);
});

test('l\'audio de /api se lit sous la CSP (media-src), sans violation', async ({ page }) => {
  await surveillerViolations(page);
  const id = '00000000-0000-4000-8000-0000000000aa';
  // WAV muet de 0,1 s, 8 kHz, 8 bits.
  const donnees = 800;
  const wav = Buffer.alloc(44 + donnees, 0x80);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + donnees, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(donnees, 40);
  let audioDemande = false;
  await simuler(page, {
    ...CONNECTE,
    'GET /api/captures/privees': json(200, [
      { jour: '2026-10-05', captures: [{ id, heure: '23:41', dureeS: 1, etiquette: null, aAudio: true }] },
    ]),
    [`GET /api/captures/${id}/audio`]: (route) => { audioDemande = true; return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav }); },
  });
  await page.goto('/prive');
  await page.getByRole('button', { name: 'Écouter, 23:41' }).click();
  await expect.poll(() => audioDemande).toBe(true);
  await expect(page.getByText('Audio indisponible.')).toHaveCount(0);
  expect(await violations(page)).toEqual([]);
});
