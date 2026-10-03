import type { Prompt } from '@organizer/shared';
import {
  CreditEpuise, PalierNonPaye, SortieNonConforme,
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
  fetch?: typeof fetch;
}

interface ReponseGemini {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; serviceTier?: string };
}

interface Brut { texte: string; entree: number; sortie: number; tier: string | undefined }

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export class GeminiProvider implements ClassificationProvider {
  constructor(private readonly o: OptionsGemini) {}

  async classer(e: EntreeClassement): Promise<ResultatClassement> {
    let derniere: unknown;
    for (const modele of [this.o.modele, this.o.repli]) {
      const brut = await this.appeler(modele, e);
      try {
        const sortie = this.o.prompt.valider(JSON.parse(brut.texte));
        return { sortie, modele, tokensEntree: brut.entree, tokensSortie: brut.sortie };
      } catch (err) {
        derniere = err;
      }
    }
    throw new SortieNonConforme(`Sortie hors schéma sur ${this.o.modele} puis ${this.o.repli}`, { cause: derniere });
  }

  async verifierPalierPaye(): Promise<void> {
    const r = await this.appeler(this.o.modele, { systeme: 'Contrôle de palier. Réponds le JSON minimal.', texte: 'ok' });
    if (!r.tier || !this.o.tiersPayes.includes(r.tier)) {
      throw new PalierNonPaye(`Palier Gemini « ${r.tier ?? 'inconnu'} » : palier payé exigé`);
    }
  }

  private async appeler(modele: string, e: EntreeClassement): Promise<Brut> {
    const parts: Part[] = [];
    if (e.audio) {
      parts.push({ inlineData: { mimeType: e.audio.mime, data: e.audio.donnees.toString('base64') } }, { text: 'Voici le vocal.' });
    }
    if (e.texte) parts.push({ text: `Message écrit, pas de vocal. Ce texte est la transcription :\n${e.texte}` });

    const r = await (this.o.fetch ?? fetch)(`${URL_API}${modele}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.o.cle },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: e.systeme }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: this.o.prompt.responseSchema },
      }),
    });
    // Jamais le corps d'erreur dans le message : il peut citer la requête.
    if (r.status === 402) throw new CreditEpuise(`Gemini ${modele} : HTTP 402`);
    if (!r.ok) throw new Error(`Gemini ${modele} : HTTP ${r.status}`);
    const j = (await r.json().catch(() => ({}))) as ReponseGemini;
    return {
      texte: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
      entree: j.usageMetadata?.promptTokenCount ?? 0,
      sortie: j.usageMetadata?.candidatesTokenCount ?? 0,
      tier: j.usageMetadata?.serviceTier,
    };
  }
}
