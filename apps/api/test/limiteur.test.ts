import { expect, it } from 'vitest';
import { LimiteurDebit } from '../src/auth/limiteur.js';

it('autorise max appels par fenêtre glissante, par clé', () => {
  let t = 0;
  const l = new LimiteurDebit(2, 1000, () => t);
  expect([l.autoriser('a'), l.autoriser('a'), l.autoriser('a')]).toEqual([true, true, false]);
  expect(l.autoriser('b')).toBe(true);
  t = 1001;
  expect(l.autoriser('a')).toBe(true);
});

it('un refus ne prolonge pas le blocage', () => {
  let t = 0;
  const l = new LimiteurDebit(1, 1000, () => t);
  l.autoriser('a');
  t = 500;
  expect(l.autoriser('a')).toBe(false);
  t = 1001;
  expect(l.autoriser('a')).toBe(true);
});
