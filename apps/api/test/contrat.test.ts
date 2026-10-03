import { EN_TETES_CAPTURE_PRIVEE, type CorpsConnexion, type CorpsCorrection, type CorpsEtiquette } from '@organizer/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { schemaConnexion } from '../src/auth/auth.controller.js';
import { schemaCorrection } from '../src/items/items.controller.js';
import { schemaEtiquette } from '../src/privees/privees.controller.js';

describe('contrat des requêtes de la PWA', () => {
  it('les schémas zod des contrôleurs restent alignés sur les types partagés', () => {
    expectTypeOf<z.infer<typeof schemaConnexion>>().toEqualTypeOf<CorpsConnexion>();
    expectTypeOf<z.infer<typeof schemaCorrection>>().toEqualTypeOf<CorpsCorrection>();
    expectTypeOf<z.infer<typeof schemaEtiquette>>().toEqualTypeOf<CorpsEtiquette>();
  });

  it('les en-têtes de dépôt privé sont figés', () => {
    expect(EN_TETES_CAPTURE_PRIVEE).toEqual({ id: 'X-Capture-Id', emisLe: 'X-Emis-Le', dureeS: 'X-Duree-S' });
  });
});
