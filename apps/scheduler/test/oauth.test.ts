import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ClientRefuse, ErreurGoogle, OctroiInvalide } from '../src/google/erreurs.js';
import { ClientOAuth, PORTEE_AGENDA } from '../src/google/oauth.js';
import { FauxGoogle, PORTEE, SECRET_ESSAI } from './faux-google.js';

let faux: FauxGoogle;
const client = (secret = SECRET_ESSAI) => new ClientOAuth({
  clientId: 'id.apps.googleusercontent.com', clientSecret: secret, redirectUri: 'https://organizer.essai/api/agenda/retour',
  baseOauth: faux.url, baseCalendrier: `${faux.url}/calendar/v3`,
}, fetch);

beforeAll(async () => { faux = new FauxGoogle(); await faux.demarrer(); });
afterAll(() => faux.arreter());
beforeEach(() => { faux.requetes.length = 0; });

describe('ClientOAuth', () => {
  it('échange le code avec le vérificateur PKCE et l\'adresse de retour exacte', async () => {
    expect(PORTEE_AGENDA).toBe(PORTEE);
    faux.codes.set('code-1', { portee: PORTEE, verificateur: 'verif-1' });
    const j = await client().echanger('code-1', 'verif-1');
    expect(j.portees).toEqual([PORTEE]);
    expect(j.rafraichissement).toMatch(/^rafr-/);
    const envoye = new URLSearchParams(faux.requetes[0]!.corps);
    expect(Object.fromEntries(envoye)).toMatchObject({
      grant_type: 'authorization_code', code: 'code-1', code_verifier: 'verif-1',
      client_id: 'id.apps.googleusercontent.com', redirect_uri: 'https://organizer.essai/api/agenda/retour',
    });
  });

  it('code inconnu ou mauvais vérificateur : OctroiInvalide, sans jeton dans le message', async () => {
    faux.codes.set('code-2', { portee: PORTEE, verificateur: 'bon' });
    const e = await client().echanger('code-2', 'mauvais').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(OctroiInvalide);
    expect((e as Error).message).toBe('Google HTTP 400 (invalid_grant)');
  });

  it('secret refusé : ClientRefuse', async () => {
    await expect(client('autre').rafraichir('rafr-x')).rejects.toBeInstanceOf(ClientRefuse);
  });

  it('rafraîchit un jeton valable ; un jeton révoqué donne OctroiInvalide', async () => {
    faux.connecte('rafr-ok');
    expect((await client().rafraichir('rafr-ok')).acces).toMatch(/^acces-/);
    await client().revoquer('rafr-ok');
    expect(faux.revoques).toContain('rafr-ok');
    await expect(client().rafraichir('rafr-ok')).rejects.toBeInstanceOf(OctroiInvalide);
  });

  it('5xx : ErreurGoogle simple (reprise) ; révocation d\'un jeton déjà mort : sans erreur', async () => {
    faux.forcer(/^POST \/token$/, 503, { error: 'backendError' });
    const e = await client().rafraichir('x').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErreurGoogle);
    expect((e as ErreurGoogle).constructor).toBe(ErreurGoogle);
    faux.forcer(/^POST \/revoke$/, 400, { error: 'invalid_token' });
    await expect(client().revoquer('mort')).resolves.toBeUndefined();
  });
});
