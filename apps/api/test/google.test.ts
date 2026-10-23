import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { clesGoogle, creerVerificateurGoogle, GoogleIndisponible, type VerificateurGoogle } from '../src/auth/google.js';

const CLIENT = 'client-essai.apps.googleusercontent.com';
let v: VerificateurGoogle;
let privee: CryptoKey;
let autrePrivee: CryptoKey;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  privee = privateKey;
  autrePrivee = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  v = creerVerificateurGoogle(CLIENT, createLocalJWKSet({ keys: [jwk] }));
});

async function jeton(charge: JWTPayload, opts: { iss?: string; aud?: string; exp?: number | string; cle?: CryptoKey } = {}): Promise<string> {
  return new SignJWT(charge)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? 'https://accounts.google.com')
    .setAudience(opts.aud ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.cle ?? privee);
}
const bon = { email: 'l@exemple.org', email_verified: true, sub: '123' };

describe('vérificateur Google', () => {
  it('jeton valide : profil', async () => {
    expect(await v.verifier(await jeton(bon))).toEqual({ sub: '123', email: 'l@exemple.org', emailVerifie: true });
  });
  it('adresse mise en minuscules', async () => {
    expect((await v.verifier(await jeton({ ...bon, email: 'L@Exemple.org' })))?.email).toBe('l@exemple.org');
  });
  it('émetteur court accepté', async () => {
    expect(await v.verifier(await jeton(bon, { iss: 'accounts.google.com' }))).not.toBeNull();
  });
  it('mauvaise audience : null', async () => {
    expect(await v.verifier(await jeton(bon, { aud: 'autre' }))).toBeNull();
  });
  it('expiré : null', async () => {
    expect(await v.verifier(await jeton(bon, { exp: Math.floor(Date.now() / 1000) - 3600 }))).toBeNull();
  });
  it('autre clé : null', async () => {
    expect(await v.verifier(await jeton(bon, { cle: autrePrivee }))).toBeNull();
  });
  it('autre émetteur : null', async () => {
    expect(await v.verifier(await jeton(bon, { iss: 'https://exemple.org' }))).toBeNull();
  });
  it('sans email ou sans sub : null', async () => {
    expect(await v.verifier(await jeton({ email_verified: true, sub: '123' }))).toBeNull();
    expect(await v.verifier(await jeton({ email: 'l@exemple.org', email_verified: true }))).toBeNull();
  });
  it('charabia : null', async () => {
    expect(await v.verifier('pas-un-jeton')).toBeNull();
  });
});

describe('certificats de Google injoignables', () => {
  const avec = (f: typeof fetch) => creerVerificateurGoogle(CLIENT, clesGoogle(f));
  it('réseau en échec : GoogleIndisponible, pas null', async () => {
    const v2 = avec(async () => { throw new TypeError('fetch failed'); });
    await expect(v2.verifier(await jeton(bon))).rejects.toBeInstanceOf(GoogleIndisponible);
  });
  it('réponse autre que 200 (proxy) : GoogleIndisponible', async () => {
    const v2 = avec(async () => new Response('refusé', { status: 403 }));
    await expect(v2.verifier(await jeton(bon))).rejects.toMatchObject({ code: 'ERR_JOSE_GENERIC' });
  });
  it('certificats joignables mais clé absente : null', async () => {
    const v2 = avec(async () => Response.json({ keys: [] }));
    expect(await v2.verifier(await jeton(bon))).toBeNull();
  });
});
