import type { PrismaClient } from '@organizer/db';
import type { ResumeEmpreinte } from '@organizer/shared/api';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { ConfigWebauthn } from './config.js';
import { DelaiDepasse, type MagasinDefis } from './defis.js';

/** Durée laissée au téléphone pour l'invite (options.timeout). Le défi vit deux fois plus. */
export const DELAI_CEREMONIE_MS = 60_000;
export const MAX_CLES_PAR_COMPTE = 10;
/** ES256 (toutes les clés Android), puis RS256. */
const ALGORITHMES = [-7, -257];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TropDeCles extends Error {
  override name = 'TropDeCles';
}

interface LigneCle { id: string; identifiant: string; creeLe: Date; utiliseeLe: Date | null }

const resume = (c: LigneCle): ResumeEmpreinte => ({
  id: c.id, identifiant: c.identifiant, creeLe: c.creeLe.toISOString(), utiliseeLe: c.utiliseeLe?.toISOString() ?? null,
});

/** Identifiant WebAuthn du compte (user.id) : l'UUID du compte en UTF-8, rien de nominatif. */
const handleDe = (utilisateurId: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(utilisateurId));

export class EmpreintesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly defis: MagasinDefis,
    private readonly config: ConfigWebauthn,
    private readonly maintenant: () => Date = () => new Date(),
    private readonly journal: (m: string) => void = (m) => { console.warn(m); },
  ) {}

  /** Vérification de la bibliothèque : un refus vaut null et se journalise (message technique, jamais de corps). */
  protected async verifier<T>(etape: string, verification: () => Promise<T>): Promise<T | null> {
    try {
      return await verification();
    } catch (err) {
      if (err instanceof DelaiDepasse) throw err;
      // Jamais le message de la bibliothèque : il reprend le défi et l'origine envoyés par le client.
      const e = err as Error;
      this.journal(`Empreinte refusée (${etape}) : ${/counter/i.test(e.message) ? 'compteur' : e.name}`);
      return null;
    }
  }

  /** Toute panne de Valkey (pas seulement le délai) devient DelaiDepasse : refus propre, sans détail interne. */
  private async defi<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (!(err instanceof DelaiDepasse)) this.journal(`Valkey en erreur : ${(err as Error).message}`);
      throw err instanceof DelaiDepasse ? err : new DelaiDepasse();
    }
  }

  async optionsInscription(u: { id: string; nom: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const cles = await this.prisma.cleAcces.findMany({ where: { utilisateurId: u.id }, select: { identifiant: true, transports: true } });
    if (cles.length >= MAX_CLES_PAR_COMPTE) throw new TropDeCles();
    const options = await generateRegistrationOptions({
      rpName: this.config.nomRp,
      rpID: this.config.rpId,
      userName: u.nom,
      userDisplayName: u.nom,
      userID: handleDe(u.id),
      attestationType: 'none',
      timeout: DELAI_CEREMONIE_MS,
      supportedAlgorithmIDs: ALGORITHMES,
      excludeCredentials: cles.map((c) => ({ id: c.identifiant, transports: c.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    });
    await this.defi(() => this.defis.poser('inscription', options.challenge, u.id));
    return options;
  }

  async inscrire(u: { id: string }, reponse: RegistrationResponseJSON): Promise<ResumeEmpreinte | null> {
    const v = await this.verifier('inscription', () => verifyRegistrationResponse({
      response: reponse,
      // Lu et effacé d'un coup : un défi ne sert qu'une fois, et seulement au compte qui l'a demandé.
      expectedChallenge: async (defi) => (await this.defi(() => this.defis.prendre('inscription', defi))) === u.id,
      expectedOrigin: this.config.origine,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMES,
    }));
    if (v === null || !v.verified) return null;
    const { credential, credentialBackedUp } = v.registrationInfo;
    try {
      // Plafond recompté ici, sous verrou du compte : des défis émis avant le plafond ne le dépassent pas.
      const c = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${u.id}))`;
        if (await tx.cleAcces.count({ where: { utilisateurId: u.id } }) >= MAX_CLES_PAR_COMPTE) return null;
        return tx.cleAcces.create({
          data: {
            identifiant: credential.id, utilisateurId: u.id, clePublique: new Uint8Array(credential.publicKey), creeLe: this.maintenant(),
            compteur: BigInt(credential.counter), transports: credential.transports ?? [], sauvegardee: credentialBackedUp,
          },
        });
      });
      return c && resume(c);
    } catch (err) {
      // Même clé déjà gardée (identifiant unique) : refus, pas d'erreur interne.
      if ((err as { code?: string }).code === 'P2002') return null;
      throw err;
    }
  }

  async optionsConnexion(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    // Aucune clé listée : le téléphone propose les siennes (clés découvrables), sans nom à saisir.
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId, userVerification: 'required', timeout: DELAI_CEREMONIE_MS,
    });
    // Défi sans compte : rangé sous son propre type, il ne sert jamais à activer une empreinte (et inversement).
    await this.defi(() => this.defis.poser('connexion', options.challenge, 'connexion'));
    return options;
  }

  /** Compte authentifié par l'empreinte, ou null : clé inconnue, compte différent, défi, origine, signature ou compteur. */
  async verifierConnexion(reponse: AuthenticationResponseJSON): Promise<string | null> {
    const cle = await this.prisma.cleAcces.findUnique({ where: { identifiant: reponse.id } });
    if (!cle) return null;
    // Clé découvrable : le téléphone renvoie le compte, qui doit être celui de la clé.
    const handle = reponse.response.userHandle;
    if (!handle || Buffer.from(handle, 'base64url').toString('utf8') !== cle.utilisateurId) return null;
    const v = await this.verifier('connexion', () => verifyAuthenticationResponse({
      response: reponse,
      expectedChallenge: async (defi) => (await this.defi(() => this.defis.prendre('connexion', defi))) === 'connexion',
      expectedOrigin: this.config.origine,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
      credential: {
        id: cle.identifiant, publicKey: new Uint8Array(cle.clePublique), counter: Number(cle.compteur), transports: cle.transports,
      },
    }));
    if (v === null || !v.verified) return null;
    await this.prisma.cleAcces.update({
      where: { id: cle.id },
      data: {
        compteur: BigInt(v.authenticationInfo.newCounter), utiliseeLe: this.maintenant(),
        sauvegardee: v.authenticationInfo.credentialBackedUp,
      },
    });
    return cle.utilisateurId;
  }

  async lister(utilisateurId: string): Promise<ResumeEmpreinte[]> {
    const cles = await this.prisma.cleAcces.findMany({ where: { utilisateurId }, orderBy: { creeLe: 'asc' } });
    return cles.map(resume);
  }

  /** Faux si la clé n'existe pas ou appartient à un autre compte. */
  async retirer(utilisateurId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const { count } = await this.prisma.cleAcces.deleteMany({ where: { id, utilisateurId } });
    return count > 0;
  }
}
