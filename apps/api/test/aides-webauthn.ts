import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type {
  AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { ConfigWebauthn } from '../src/auth/empreintes/config.js';
import { DUREE_DEFI_MS, type MagasinDefis, type TypeDefi } from '../src/auth/empreintes/defis.js';

export const CONFIG_ESSAI: ConfigWebauthn = { rpId: 'organizer.djkix.ovh', origine: 'https://organizer.djkix.ovh', nomRp: 'Organizer' };

/** Magasin de défis en mémoire, à horloge réglable. Même contrat que Valkey : lu et effacé d'un coup. */
export class MagasinDefisMemoire implements MagasinDefis {
  private readonly defis = new Map<string, { valeur: string; expire: number }>();
  constructor(private readonly maintenant: () => number = Date.now) {}

  async poser(type: TypeDefi, defi: string, valeur: string): Promise<void> {
    this.defis.set(`${type}:${defi}`, { valeur, expire: this.maintenant() + DUREE_DEFI_MS });
  }

  async prendre(type: TypeDefi, defi: string): Promise<string | null> {
    const cle = `${type}:${defi}`;
    const d = this.defis.get(cle);
    this.defis.delete(cle);
    return d && d.expire > this.maintenant() ? d.valeur : null;
  }
}

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

function tete(majeur: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(majeur << 5) | n]);
  if (n < 0x100) return Buffer.from([(majeur << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(majeur << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (majeur << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

/** CBOR minimal et canonique (RFC 8949) : entiers, textes, octets, tableaux, tables. Assez pour une attestation « none ». */
export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? tete(0, v) : tete(1, -1 - v);
  if (typeof v === 'string') {
    const t = Buffer.from(v, 'utf8');
    return Buffer.concat([tete(3, t.length), t]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([tete(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([tete(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([tete(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const sha256 = (d: string | Uint8Array): Buffer => createHash('sha256').update(d).digest();
const b64u = (d: Uint8Array): string => Buffer.from(d).toString('base64url');
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

/** Ce qu'un test fausse dans la réponse du téléphone. `userHandle: null` retire le compte de la réponse. */
export interface Falsification {
  origine?: string; rpId?: string; sansUv?: boolean; compteur?: number; userHandle?: string | null; type?: string; id?: string;
}

interface Cle { prive: KeyObject; userHandle: string; compteur: number }

/**
 * Authentificateur WebAuthn logiciel : ES256, attestation « none », clés découvrables.
 * De vraies signatures, vérifiées par la vraie bibliothèque du serveur.
 */
export class AuthentificateurLogiciel {
  readonly cles = new Map<string, Cle>();

  constructor(private readonly rpId: string, private readonly origine: string, private readonly compteurCroissant = false) {}

  inscrire(o: PublicKeyCredentialCreationOptionsJSON, f: Falsification = {}): RegistrationResponseJSON {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = randomBytes(16);
    const cose = cbor(new Map<Cbor, Cbor>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
    ]));
    const drapeaux = UP | AT | (f.sansUv ? 0 : UV);
    const authData = Buffer.concat([
      sha256(f.rpId ?? this.rpId), Buffer.from([drapeaux]), u32(0), Buffer.alloc(16), Buffer.from([0, id.length]), id, cose,
    ]);
    const clientData = Buffer.from(JSON.stringify({
      type: f.type ?? 'webauthn.create', challenge: o.challenge, origin: f.origine ?? this.origine, crossOrigin: false,
    }));
    const attestation = cbor(new Map<Cbor, Cbor>([['fmt', 'none'], ['attStmt', new Map<Cbor, Cbor>()], ['authData', authData]]));
    this.cles.set(b64u(id), { prive: privateKey, userHandle: o.user.id, compteur: 0 });
    return {
      id: b64u(id), rawId: b64u(id), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestation), transports: ['internal'] },
    };
  }

  authentifier(o: PublicKeyCredentialRequestOptionsJSON, f: Falsification = {}): AuthenticationResponseJSON {
    const id = f.id ?? [...this.cles.keys()][0];
    const cle = id === undefined ? undefined : this.cles.get(id);
    if (id === undefined || !cle) throw new Error('aucune clé dans l\'authentificateur');
    if (this.compteurCroissant) cle.compteur++;
    const authData = Buffer.concat([
      sha256(f.rpId ?? this.rpId), Buffer.from([UP | (f.sansUv ? 0 : UV)]), u32(f.compteur ?? cle.compteur),
    ]);
    const clientData = Buffer.from(JSON.stringify({
      type: f.type ?? 'webauthn.get', challenge: o.challenge, origin: f.origine ?? this.origine, crossOrigin: false,
    }));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), cle.prive);
    const userHandle = f.userHandle === null ? undefined : (f.userHandle ?? cle.userHandle);
    return {
      id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature),
        ...(userHandle === undefined ? {} : { userHandle }),
      },
    };
  }
}
