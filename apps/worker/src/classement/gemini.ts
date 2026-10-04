import type { Prompt } from '@organizer/shared';
import { z } from 'zod';
import {
  CreditEpuise, ErreurFournisseur, FournisseurIndisponible, PalierNonPaye, SortieNonConforme,
  type ClassificationProvider, type EntreeClassement, type ResultatClassement,
} from './provider.js';

const URL_API = 'https://generativelanguage.googleapis.com/v1beta/models/';

export interface OptionsGemini {
  cle: string;
  modele: string;
  repli: string;
  prompt: Prompt;
  /** Valeurs de usageMetadata.serviceTier reconnues comme palier payé. */
  tiersPayes: string[];
  /** generationConfig.thinkingConfig.thinkingLevel ; absent = non envoyé. */
  niveauReflexion?: string;
  /** Délai d'un appel, en ms. Défaut : 120 s. */
  delaiMs?: number;
  fetch?: typeof fetch;
}

interface ReponseGemini {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; serviceTier?: string };
}

interface Brut { texte: string; entree: number; sortie: number; reflexion: number; tier: string | undefined }

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

const CONTROLE: EntreeClassement = { systeme: 'Contrôle de palier. Réponds le JSON minimal.', texte: 'ok' };

export interface Diagnostic {
  statut: number;
  tier: string | null;
  paye: boolean;
  niveauReflexion: string | null;
  jetons: { entree: number; sortie: number; reflexion: number } | null;
}

/** Une ligne pour l'exploitation : statut, palier, réflexion, jetons. Aucun contenu. */
export function formaterDiagnostic(d: Diagnostic): string {
  if (d.statut !== 200 || !d.jetons) return `HTTP ${d.statut} : palier non vérifiable.`;
  return `HTTP 200 · palier « ${d.tier ?? 'absent'} » : ${d.paye ? 'payé' : 'REFUSÉ'} · réflexion ${d.niveauReflexion ?? 'non demandée'}`
    + ` · jetons : entrée ${d.jetons.entree}, sortie ${d.jetons.sortie}, réflexion ${d.jetons.reflexion}`;
}

export class GeminiProvider implements ClassificationProvider {
  constructor(private readonly o: OptionsGemini) {}

  async classer(e: EntreeClassement): Promise<ResultatClassement> {
    let derniereRaison = '';
    for (const modele of [this.o.modele, this.o.repli]) {
      const brut = await this.appeler(modele, e);
      try {
        const sortie = this.o.prompt.valider(JSON.parse(brut.texte));
        return { sortie, modele, tokensEntree: brut.entree, tokensSortie: brut.sortie };
      } catch (err) {
        derniereRaison = this.sanitizeErrorReason(err);
      }
    }
    throw new SortieNonConforme(`Sortie hors schéma sur ${this.o.modele} puis ${this.o.repli} : ${derniereRaison}`);
  }

  private sanitizeErrorReason(err: unknown): string {
    if (err instanceof z.ZodError) {
      // Extract issue paths and codes only, no values
      return err.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`).join('; ');
    }
    if (err instanceof Error) {
      return err.name;
    }
    return 'erreur inconnue';
  }

  async verifierPalierPaye(): Promise<void> {
    const r = await this.appeler(this.o.modele, CONTROLE);
    if (!r.tier || !this.o.tiersPayes.includes(r.tier)) {
      throw new PalierNonPaye(`Palier Gemini « ${r.tier ?? 'inconnu'} » : palier payé exigé`);
    }
  }

  /** Même requête que le contrôle du palier, sans jamais lever sur une erreur HTTP : pour la sonde. */
  async diagnostiquer(): Promise<Diagnostic> {
    const { statut, brut } = await this.requete(this.o.modele, CONTROLE);
    return {
      statut,
      tier: brut?.tier ?? null,
      paye: !!brut?.tier && this.o.tiersPayes.includes(brut.tier),
      niveauReflexion: this.o.niveauReflexion ?? null,
      jetons: brut ? { entree: brut.entree, sortie: brut.sortie, reflexion: brut.reflexion } : null,
    };
  }

  private async requete(modele: string, e: EntreeClassement): Promise<{ statut: number; brut: Brut | null }> {
    const parts: Part[] = [];
    if (e.audio) {
      parts.push({ inlineData: { mimeType: e.audio.mime, data: e.audio.donnees.toString('base64') } }, { text: 'Voici le vocal.' });
    }
    if (e.texte) parts.push({ text: `Message écrit, pas de vocal. Ce texte est la transcription :\n${e.texte}` });
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2, responseMimeType: 'application/json', responseSchema: this.o.prompt.responseSchema,
    };
    if (this.o.niveauReflexion) generationConfig.thinkingConfig = { thinkingLevel: this.o.niveauReflexion };

    const r = await (this.o.fetch ?? fetch)(`${URL_API}${modele}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.o.cle },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: e.systeme }] }, contents: [{ role: 'user', parts }], generationConfig }),
      signal: AbortSignal.timeout(this.o.delaiMs ?? 120_000),
    });
    if (!r.ok) {
      // Jamais le corps d'erreur : il peut citer la requête.
      await r.body?.cancel().catch(() => undefined);
      return { statut: r.status, brut: null };
    }
    const j = (await r.json().catch(() => ({}))) as ReponseGemini;
    return {
      statut: r.status,
      brut: {
        texte: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
        entree: j.usageMetadata?.promptTokenCount ?? 0,
        sortie: j.usageMetadata?.candidatesTokenCount ?? 0,
        reflexion: j.usageMetadata?.thoughtsTokenCount ?? 0,
        tier: j.usageMetadata?.serviceTier,
      },
    };
  }

  private async appeler(modele: string, e: EntreeClassement): Promise<Brut> {
    const { statut, brut } = await this.requete(modele, e);
    if (statut === 402) throw new CreditEpuise(`Gemini ${modele} : HTTP 402`);
    // 403 et 429 : clé, budget en pause ou quota. Le code exact d'une pause de budget n'est pas documenté.
    if (statut === 403 || statut === 429) throw new FournisseurIndisponible(statut, `Gemini ${modele} : HTTP ${statut}`);
    if (!brut) throw new ErreurFournisseur(statut, `Gemini ${modele} : HTTP ${statut}`);
    return brut;
  }
}
