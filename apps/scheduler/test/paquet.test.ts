import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { empaqueter, importsExternes } from '../../../scripts/empaquetage.mjs';

const APP = join(import.meta.dirname, '..');
const ENV_VIDE = { PATH: process.env.PATH ?? '', NODE_ENV: 'production' };

describe('paquet du scheduler', () => {
  it('chaque paquet importé à l\'exécution est une dépendance directe du scheduler', async () => {
    const r = await empaqueter(APP, ['src/main.ts', 'src/sonde.ts']);
    const deps = Object.keys((JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies);
    expect(importsExternes(r.metafile).filter((n) => !deps.includes(n))).toEqual([]);
  }, 60_000);

  it('dist/main.mjs se charge sans module manquant et s\'arrête sur la configuration', () => {
    const r = spawnSync(process.execPath, [join(APP, 'dist/main.mjs')], { env: ENV_VIDE, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/);
    expect(r.stderr).toContain('Variable manquante');
  });

  it('dist/sonde.mjs affiche son usage', () => {
    const r = spawnSync(process.execPath, [join(APP, 'dist/sonde.mjs')], { env: ENV_VIDE, encoding: 'utf8', timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Usage : sonde sortie <url>');
  });
});
