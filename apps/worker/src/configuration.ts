import { chargerPrompt, cheminConfigure, creerFetchSortant, exigerVar, lireVar, type Prompt } from '@organizer/shared';
import { GeminiProvider } from './classement/gemini.js';

export const STATUTS_INDISPONIBLES_DEFAUT = [402, 403, 429];

/** Lit GEMINI_STATUTS_INDISPONIBLES. Une valeur invalide donne le défaut, avec une erreur claire. */
export function analyserStatutsIndisponibles(brut: string | undefined, erreur: (message: string) => void): number[] {
  if (brut === undefined) return STATUTS_INDISPONIBLES_DEFAUT;
  const parts = brut.split(',').map((x) => x.trim());
  const nombres = parts.map((x) => (/^\d{3}$/.test(x) ? Number(x) : NaN));
  if (nombres.some((n) => !(n >= 100 && n <= 599))) {
    erreur('GEMINI_STATUTS_INDISPONIBLES invalide (attendu : statuts HTTP séparés par des virgules) : défaut 402,403,429 utilisé.');
    return STATUTS_INDISPONIBLES_DEFAUT;
  }
  return nombres;
}

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
    statutsIndisponibles: analyserStatutsIndisponibles(lireVar('GEMINI_STATUTS_INDISPONIBLES'), console.error),
    fetch: creerFetchSortant(),
  });
  return { prompt, provider };
}
