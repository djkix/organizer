import type { ResumeEmpreinte } from '@organizer/shared/api';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { describe, expect, it } from 'vitest';
import { ErreurApi, HorsLigne } from '../src/lib/api.js';
import {
  activerEmpreinte, CLE_INCONNUE, CLE_MEMO, connecterParEmpreinte, memoLocal, messageEmpreinte, retirerEmpreinte, type Ceremonies, type Memo,
} from '../src/lib/empreinte.js';
import { MESSAGES } from '../src/lib/messages.js';

class StockageFaux {
  readonly m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

const CREATION: PublicKeyCredentialCreationOptionsJSON = {
  challenge: 'defi', rp: { name: 'Organizer', id: 'localhost' }, user: { id: 'dQ', name: 'test', displayName: 'test' },
  pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
};
const DEMANDE: PublicKeyCredentialRequestOptionsJSON = { challenge: 'defi' };
const INSCRIPTION: RegistrationResponseJSON = {
  id: 'cle-1', rawId: 'cle-1', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'e30', attestationObject: 'oA' },
};
const CONNEXION: AuthenticationResponseJSON = {
  id: 'cle-1', rawId: 'cle-1', type: 'public-key', clientExtensionResults: {},
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
};
const CLE: ResumeEmpreinte = { id: '00000000-0000-4000-8000-000000000001', identifiant: 'cle-1', creeLe: '2026-10-06T08:00:00.000Z', utiliseeLe: null };

function ceremonies(echec?: unknown): Ceremonies & { appels: string[] } {
  const appels: string[] = [];
  return {
    appels,
    disponible: () => true,
    creer: async (o) => { appels.push(`creer ${o.challenge}`); if (echec) throw echec; return INSCRIPTION; },
    obtenir: async (o) => { appels.push(`obtenir ${o.challenge}`); if (echec) throw echec; return CONNEXION; },
  };
}
const memoFaux = (): Memo & { valeur: string | null } => {
  const m = { valeur: null as string | null, lire: () => m.valeur, poser: (v: string) => { m.valeur = v; }, effacer: () => { m.valeur = null; } };
  return m;
};

describe('memoLocal', () => {
  it('retient l\'identifiant de la clé de ce téléphone, sous une seule clé de stockage', () => {
    const s = new StockageFaux();
    const m = memoLocal(() => s);
    expect(m.lire()).toBeNull();
    m.poser('cle-1');
    expect(m.lire()).toBe('cle-1');
    expect([...s.m.keys()]).toEqual([CLE_MEMO]);
    m.effacer();
    expect(m.lire()).toBeNull();
  });

  it('stockage absent ou qui lève : rien ne casse, pas d\'empreinte retenue', () => {
    const leve = (): never => { throw new Error('SecurityError'); };
    for (const m of [memoLocal(() => undefined), memoLocal(leve), memoLocal(() => ({ getItem: leve, setItem: leve, removeItem: leve }))]) {
      expect(() => m.poser('cle-1')).not.toThrow();
      expect(m.lire()).toBeNull();
      expect(() => m.effacer()).not.toThrow();
    }
  });
});

describe('messageEmpreinte', () => {
  it.each([
    ['connexion', new DOMException('x', 'NotAllowedError'), MESSAGES.empreinteAnnulee],
    ['connexion', new DOMException('x', 'AbortError'), MESSAGES.empreinteAnnulee],
    ['activation', new DOMException('x', 'InvalidStateError'), MESSAGES.empreinteDejaActive],
    ['connexion', new DOMException('x', 'SecurityError'), MESSAGES.empreinteIndisponible],
    ['connexion', new Error('WebAuthn is not supported in this browser'), MESSAGES.empreinteIndisponible],
    ['connexion', new HorsLigne(), MESSAGES.horsLigne],
    ['connexion', new ErreurApi(401, 'Empreinte non reconnue. Essaie ton mot de passe.'), 'Empreinte non reconnue. Essaie ton mot de passe.'],
    ['connexion', new ErreurApi(429, 'Trop d\'essais. Réessaie dans une minute.'), 'Trop d\'essais. Réessaie dans une minute.'],
    ['activation', new ErreurApi(409, 'x'), MESSAGES.empreintesTrop],
    ['connexion', new ErreurApi(409, 'x'), MESSAGES.serveurIndisponible],
    ['activation', new ErreurApi(400, 'x'), MESSAGES.empreinteRefusee],
    ['connexion', new ErreurApi(400, 'x'), MESSAGES.empreinteNonReconnue],
    ['connexion', new ErreurApi(503, 'x'), MESSAGES.empreinteServeurIndisponible],
    ['activation', new ErreurApi(503, 'x'), MESSAGES.empreinteServeurIndisponible],
    ['connexion', new ErreurApi(500, 'x'), MESSAGES.serveurIndisponible],
  ] as const)('%s : %s', (contexte, err, message) => {
    expect(messageEmpreinte(err, contexte)).toBe(message);
  });

  it('à la connexion, jamais « non activée » ni « au plus »', () => {
    for (const statut of [400, 409, 503]) {
      const m = messageEmpreinte(new ErreurApi(statut, 'x'), 'connexion');
      expect(m).not.toContain('activée');
      expect(m).not.toContain('au plus');
    }
  });
});

describe('connecterParEmpreinte', () => {
  it('options, invite, vérification ; retient la clé de ce téléphone', async () => {
    const appels: string[] = [];
    const api = {
      optionsConnexionEmpreinte: async () => { appels.push('options'); return DEMANDE; },
      connecterParEmpreinte: async (r: AuthenticationResponseJSON) => { appels.push(`verifier ${r.id}`); },
    };
    const c = ceremonies();
    const memo = memoFaux();
    expect(await connecterParEmpreinte(api, c, memo)).toEqual({ ok: true });
    expect([...appels, ...c.appels]).toEqual(['options', 'verifier cle-1', 'obtenir defi']);
    expect(memo.valeur).toBe('cle-1');
  });

  it('invite fermée : un message calme, rien n\'est envoyé, rien n\'est oublié', async () => {
    let verifie = false;
    const api = { optionsConnexionEmpreinte: async () => DEMANDE, connecterParEmpreinte: async () => { verifie = true; } };
    const memo = memoFaux();
    memo.poser('cle-1');
    expect(await connecterParEmpreinte(api, ceremonies(new DOMException('x', 'NotAllowedError')), memo))
      .toEqual({ ok: false, message: MESSAGES.empreinteAnnulee });
    expect(verifie).toBe(false);
    expect(memo.valeur).toBe('cle-1');
  });

  it('serveur injoignable avant l\'invite : aucune invite ouverte', async () => {
    const api = { optionsConnexionEmpreinte: async (): Promise<PublicKeyCredentialRequestOptionsJSON> => { throw new HorsLigne(); }, connecterParEmpreinte: async () => {} };
    const c = ceremonies();
    expect(await connecterParEmpreinte(api, c, memoFaux())).toEqual({ ok: false, message: MESSAGES.horsLigne });
    expect(c.appels).toEqual([]);
  });
});

describe('activerEmpreinte et retirerEmpreinte', () => {
  it('activer renvoie la clé et la retient pour ce téléphone', async () => {
    const api = { optionsInscriptionEmpreinte: async () => CREATION, inscrireEmpreinte: async () => CLE };
    const memo = memoFaux();
    expect(await activerEmpreinte(api, ceremonies(), memo)).toEqual({ ok: true, cle: CLE });
    expect(memo.valeur).toBe('cle-1');
  });

  it('dix clés : un message, rien de retenu', async () => {
    const memo = memoFaux();
    const plein = { optionsInscriptionEmpreinte: async (): Promise<PublicKeyCredentialCreationOptionsJSON> => { throw new ErreurApi(409, 'x'); }, inscrireEmpreinte: async () => CLE };
    expect(await activerEmpreinte(plein, ceremonies(), memo)).toEqual({ ok: false, message: MESSAGES.empreintesTrop });
    expect(memo.valeur).toBeNull();
  });

  it('« déjà active » sans mémo : la clé présente est retenue sans identifiant, puis remplacée à la connexion', async () => {
    const api = { optionsInscriptionEmpreinte: async () => CREATION, inscrireEmpreinte: async () => CLE };
    const memo = memoFaux();
    expect(await activerEmpreinte(api, ceremonies(new DOMException('x', 'InvalidStateError')), memo))
      .toEqual({ ok: false, message: MESSAGES.empreinteDejaActive });
    expect(memo.valeur).toBe(CLE_INCONNUE);
    const connexion = { optionsConnexionEmpreinte: async () => DEMANDE, connecterParEmpreinte: async () => {} };
    expect(await connecterParEmpreinte(connexion, ceremonies(), memo)).toEqual({ ok: true });
    expect(memo.valeur).toBe('cle-1');
  });

  it('« déjà active » avec un identifiant connu : il n\'est pas écrasé', async () => {
    const api = { optionsInscriptionEmpreinte: async () => CREATION, inscrireEmpreinte: async () => CLE };
    const memo = memoFaux();
    memo.poser('cle-1');
    await activerEmpreinte(api, ceremonies(new DOMException('x', 'InvalidStateError')), memo);
    expect(memo.valeur).toBe('cle-1');
  });

  it('retirer la clé de ce téléphone l\'oublie ; une autre clé ne change rien ; déjà partie (404) vaut succès', async () => {
    const memo = memoFaux();
    memo.poser('cle-1');
    const ok = { retirerEmpreinte: async () => {} };
    expect(await retirerEmpreinte(ok, { ...CLE, identifiant: 'cle-2' }, memo)).toEqual({ ok: true });
    expect(memo.valeur).toBe('cle-1');
    const partie = { retirerEmpreinte: async () => { throw new ErreurApi(404, 'x'); } };
    expect(await retirerEmpreinte(partie, CLE, memo)).toEqual({ ok: true });
    expect(memo.valeur).toBeNull();
  });

  it('retrait raté : un message, la clé reste retenue', async () => {
    const memo = memoFaux();
    memo.poser('cle-1');
    expect(await retirerEmpreinte({ retirerEmpreinte: async () => { throw new HorsLigne(); } }, CLE, memo))
      .toEqual({ ok: false, message: MESSAGES.horsLigne });
    expect(await retirerEmpreinte({ retirerEmpreinte: async () => { throw new ErreurApi(500, 'x'); } }, CLE, memo))
      .toEqual({ ok: false, message: MESSAGES.retraitRate });
    expect(memo.valeur).toBe('cle-1');
  });
});
