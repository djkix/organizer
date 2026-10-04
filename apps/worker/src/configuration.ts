import { chargerPrompt, cheminConfigure, creerFetchSortant, exigerVar, lireVar, type Prompt } from '@organizer/shared';
import { GeminiProvider } from './classement/gemini.js';

/** Prompt et fournisseur, lus de l'environnement : communs au worker et à la sonde. */
export function lireConfigWorker(): { prompt: Prompt; provider: GeminiProvider } {
  const prompt = chargerPrompt(cheminConfigure('PROMPTS_DIR', lireVar('PROMPTS_DIR') ?? 'prompts'), lireVar('PROMPT_VERSION') ?? 'tri/v1');
  const provider = new GeminiProvider({
    cle: exigerVar('GEMINI_API_KEY'),
    modele: lireVar('GEMINI_MODEL') ?? 'gemini-3.1-flash-lite',
    repli: lireVar('GEMINI_MODEL_FALLBACK') ?? 'gemini-3.8-flash',
    prompt,
    tiersPayes: (lireVar('GEMINI_TIERS_PAYES') ?? 'standard').split(',').map((s) => s.trim()),
    niveauReflexion: lireVar('GEMINI_THINKING_LEVEL'),
    fetch: creerFetchSortant(),
  });
  return { prompt, provider };
}
