import { z } from 'zod';

const b64u = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/);

const commun = {
  id: b64u(1400),
  rawId: b64u(1400),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
};

/** Forme d'une réponse d'activation. La bibliothèque revérifie chaque champ. */
export const schemaInscription = z.looseObject({
  ...commun,
  response: z.looseObject({
    clientDataJSON: b64u(16_384),
    attestationObject: b64u(65_536),
    transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).max(10).optional(),
  }),
});

/** Forme d'une réponse de connexion. La bibliothèque revérifie chaque champ. */
export const schemaConnexionEmpreinte = z.looseObject({
  ...commun,
  response: z.looseObject({
    clientDataJSON: b64u(16_384),
    authenticatorData: b64u(16_384),
    signature: b64u(1024),
    userHandle: b64u(128).optional(),
  }),
});
