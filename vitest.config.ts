import { defineConfig } from 'vitest/config';

// Base et file de test : la stack de dev de la VM, via infra/dev/tunnel.sh.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    env: {
      DATABASE_URL: 'postgresql://organizer:organizer@127.0.0.1:55432/organizer_test',
      REDIS_URL: 'redis://127.0.0.1:56379/1',
      TZ: 'Europe/Paris',
    },
    testTimeout: 15_000,
  },
});
