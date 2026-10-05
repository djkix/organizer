import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tokens from '../../../design/tokens.json';
import { manifeste } from '../src/lib/pwa/manifeste.js';

const STATIC = fileURLToPath(new URL('../static', import.meta.url));

function dimensions(fichier: string): string {
  const png = readFileSync(join(STATIC, fichier));
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

describe('manifeste', () => {
  it('Organizer, autonome, en portrait, aux couleurs des tokens', () => {
    expect(manifeste).toMatchObject({
      name: 'Organizer', short_name: 'Organizer', lang: 'fr', start_url: '/', scope: '/',
      display: 'standalone', orientation: 'portrait',
      theme_color: tokens.color.light.bg, background_color: tokens.color.light.bg,
    });
  });

  it('ni partage entrant ni notification : lots 2 et 3', () => {
    expect(manifeste).not.toHaveProperty('share_target');
    expect(manifeste).not.toHaveProperty('gcm_sender_id');
  });

  it('raccourcis : Enregistrer, l\'enregistreur privé (CAP-07), puis Aujourd\'hui', () => {
    expect(manifeste.shortcuts.map((s) => [s.name, s.url])).toEqual([
      ['Enregistrer', '/enregistrer'],
      ['Enregistrement privé', '/prive/enregistrer'],
      ["Aujourd'hui", '/?vue=aujourdhui'],
    ]);
  });

  it('une icône maskable de 512 px', () => {
    expect(manifeste.icons.filter((i) => 'purpose' in i && i.purpose === 'maskable').map((i) => i.sizes)).toEqual(['512x512']);
  });

  const icones = [...manifeste.icons, ...manifeste.shortcuts.flatMap((s) => s.icons)];
  it.each(icones.map((i) => [i.src, i.sizes]))('%s existe et mesure %s', (src, sizes) => {
    expect(dimensions(src!.replace(/^\//, ''))).toBe(sizes);
  });
});
