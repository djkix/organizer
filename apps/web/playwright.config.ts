import { defineConfig, devices } from '@playwright/test';

// L'API est simulée par page.route dans chaque test : aucun serveur NestJS, aucune base.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    ...devices['Pixel 7'],
    baseURL: 'http://127.0.0.1:4173',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    permissions: ['microphone'],
    // page.route n'intercepte pas ce que sert un service worker : bloqué, sauf dans le test qui l'éprouve.
    serviceWorkers: 'block',
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
