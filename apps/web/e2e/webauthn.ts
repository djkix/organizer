import type { ResumeEmpreinte } from '@organizer/shared/api';
import type { CDPSession, Page } from '@playwright/test';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON, type WebAuthnCredential,
} from '@simplewebauthn/server';
import { json, type Table } from './simul';

// WebAuthn refuse une adresse IP comme identifiant de RP : les tests d'empreinte passent par localhost.
export const RP_ID = 'localhost';
export const ORIGINE = 'http://localhost:4173';
const COMPTE = '00000000-0000-4000-8000-000000000001';
export const idCle = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Authentificateur de plateforme virtuel de Chromium : clés découvrables, empreinte toujours reconnue. */
export async function authentificateurVirtuel(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  return cdp;
}

/** Compte les invites WebAuthn de la page (create et get), remis à zéro à chaque chargement. */
export async function compterInvites(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { invites: number };
    w.invites = 0;
    const c = navigator.credentials;
    const creer = c.create.bind(c);
    const obtenir = c.get.bind(c);
    c.create = (o?: CredentialCreationOptions) => { w.invites++; return creer(o); };
    c.get = (o?: CredentialRequestOptions) => { w.invites++; return obtenir(o); };
  });
}

export const invites = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { invites: number }).invites);

/**
 * API simulée avec la vraie bibliothèque du serveur : défis, vérifications, clés en mémoire.
 * `etat.connecte` porte la session ; `erreurs` recueille les refus de vérification, qui doivent rester vides.
 */
export function serveurEmpreinte(etat: { connecte: boolean }): { table: Table; cles: ResumeEmpreinte[]; erreurs: string[] } {
  let defi: string | undefined;
  const cles: ResumeEmpreinte[] = [];
  const publiques = new Map<string, WebAuthnCredential>();
  const erreurs: string[] = [];
  let suivante = 1;
  const prendre = (): string => {
    const d = defi;
    defi = undefined;
    if (!d) throw new Error('aucun défi');
    return d;
  };
  const table: Table = {
    'GET /api/session/moi': (r) => (etat.connecte
      ? r.fulfill({ json: { nom: 'test' } })
      : r.fulfill({ status: 401, json: { message: 'Connecte-toi pour continuer.' } })),
    'DELETE /api/session': (r) => {
      etat.connecte = false;
      return r.fulfill({ status: 204 });
    },
    'GET /api/vues/aujourdhui': json(200, { jour: '2026-10-06', actions: [], suggestions: [] }),
    'GET /api/empreintes': (r) => r.fulfill({ json: cles }),
    'POST /api/empreintes/options': async (r) => {
      const o = await generateRegistrationOptions({
        rpName: 'Organizer', rpID: RP_ID, userName: 'test', userID: new TextEncoder().encode(COMPTE), attestationType: 'none',
        excludeCredentials: [...publiques.keys()].map((id) => ({ id })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
      });
      defi = o.challenge;
      await r.fulfill({ json: o });
    },
    'POST /api/empreintes': async (r, req) => {
      try {
        const v = await verifyRegistrationResponse({
          response: req.postDataJSON() as RegistrationResponseJSON, expectedChallenge: prendre(),
          expectedOrigin: ORIGINE, expectedRPID: RP_ID, requireUserVerification: true,
        });
        if (!v.verified) throw new Error('activation non vérifiée');
        const c = v.registrationInfo.credential;
        publiques.set(c.id, c);
        const resume: ResumeEmpreinte = { id: idCle(suivante++), identifiant: c.id, creeLe: '2026-10-05T08:00:00.000Z', utiliseeLe: null };
        cles.push(resume);
        await r.fulfill({ status: 201, json: resume });
      } catch (e) {
        erreurs.push((e as Error).message);
        await r.fulfill({ status: 400, json: { message: 'Empreinte non activée. Réessaie.' } });
      }
    },
    'POST /api/session/empreinte/options': async (r) => {
      const o = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'required' });
      defi = o.challenge;
      await r.fulfill({ json: o });
    },
    'POST /api/session/empreinte': async (r, req) => {
      try {
        const reponse = req.postDataJSON() as AuthenticationResponseJSON;
        const credential = publiques.get(reponse.id);
        if (!credential) throw new Error('clé inconnue');
        const v = await verifyAuthenticationResponse({
          response: reponse, expectedChallenge: prendre(), expectedOrigin: ORIGINE, expectedRPID: RP_ID, credential, requireUserVerification: true,
        });
        if (!v.verified) throw new Error('connexion non vérifiée');
        etat.connecte = true;
        await r.fulfill({ status: 204 });
      } catch (e) {
        erreurs.push((e as Error).message);
        await r.fulfill({ status: 401, json: { message: 'Empreinte non reconnue. Essaie ton mot de passe.' } });
      }
    },
  };
  for (let n = 1; n <= 3; n++) {
    table[`DELETE /api/empreintes/${idCle(n)}`] = (r) => {
      const i = cles.findIndex((c) => c.id === idCle(n));
      if (i >= 0) cles.splice(i, 1);
      return r.fulfill({ status: 204 });
    };
  }
  return { table, cles, erreurs };
}
