import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BUDGET_OCTETS, mesurer } from '../scripts/budget.mjs';

describe('budget du bundle', () => {
  it('150 Ko compressés', () => {
    expect(BUDGET_OCTETS).toBe(150 * 1024);
  });

  it('somme le JS et le CSS compressés, sous-dossiers compris, sans les images', async () => {
    const d = await mkdtemp(join(tmpdir(), 'budget-'));
    await mkdir(join(d, 'nodes'));
    const js = 'export const a = 1;'.repeat(200);
    const css = 'body{color:var(--text)}'.repeat(50);
    await writeFile(join(d, 'app.js'), js);
    await writeFile(join(d, 'nodes', 'page.css'), css);
    await writeFile(join(d, 'image.png'), 'x'.repeat(10_000));
    const attendu = gzipSync(js, { level: 9 }).length + gzipSync(css, { level: 9 }).length;
    expect(await mesurer(d)).toBe(attendu);
  });

  it('échoue si la construction manque', async () => {
    await expect(mesurer(join(tmpdir(), 'absent-' + Date.now()))).rejects.toThrow();
  });
});
