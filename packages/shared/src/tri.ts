import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Seule énumération figée dans le code : la règle produit n° 1 en dépend. */
export const NATURES = ['action', 'pensee', 'information', 'ambigu'] as const;
export type Nature = (typeof NATURES)[number];

export interface ConfianceTri { nature: number; echeance: number | null; theme: number }

/** Les valeurs des champs texte sont admises par le response-schema de la version, pas par le code. */
export interface ItemTri {
  position: number;
  texte: string;
  nature: Nature;
  echeance_type: string | null;
  echeance_expr: string | null;
  echeance_date: string | null;
  fenetre_debut: string | null;
  fenetre_fin: string | null;
  importance: string | null;
  effort: string | null;
  contexte: string | null;
  alarme: boolean | null;
  alarme_expr: string | null;
  tonalite: string | null;
  personnes: string[];
  theme: string;
  confiance: ConfianceTri;
}

export interface TriSortie { transcription: string; items: ItemTri[] }

interface Noeud {
  type: string;
  nullable?: boolean;
  enum?: string[];
  format?: string;
  properties?: Record<string, Noeud>;
  required?: string[];
  items?: Noeud;
}

const dateIso = z.string().refine(
  (s) => /(Z|[+-]\d{2}:\d{2})$/.test(s) && !Number.isNaN(Date.parse(s)),
  'date ISO 8601 avec fuseau attendue',
);

/** Traduit le sous-ensemble OpenAPI de responseSchema en schéma Zod. */
export function zodDepuisSchema(n: Noeud): z.ZodType {
  let s: z.ZodType;
  switch (n.type) {
    case 'OBJECT': {
      const requis = new Set(n.required ?? []);
      const forme: Record<string, z.ZodType> = {};
      for (const [cle, enfant] of Object.entries(n.properties ?? {})) {
        const zs = zodDepuisSchema(enfant);
        forme[cle] = requis.has(cle) ? zs : zs.optional();
      }
      s = z.object(forme);
      break;
    }
    case 'ARRAY':
      if (!n.items) throw new Error('ARRAY sans items dans le schéma');
      s = z.array(zodDepuisSchema(n.items));
      break;
    case 'STRING':
      s = n.enum ? z.enum(n.enum as [string, ...string[]]) : n.format === 'date-time' ? dateIso : z.string();
      break;
    case 'INTEGER':
      s = z.number().int();
      break;
    case 'NUMBER':
      s = z.number();
      break;
    case 'BOOLEAN':
      s = z.boolean();
      break;
    default:
      throw new Error(`Type de schéma non pris en charge : ${n.type}`);
  }
  return n.nullable ? s.nullable() : s;
}

export interface Prompt {
  version: string;
  systeme: string;
  responseSchema: unknown;
  valider(sortie: unknown): TriSortie;
}

export function chargerPrompt(racine: string, version: string): Prompt {
  const dossier = join(racine, version);
  const systeme = readFileSync(join(dossier, 'system.md'), 'utf8');
  const responseSchema = JSON.parse(readFileSync(join(dossier, 'response-schema.json'), 'utf8')) as Noeud;
  const natures = responseSchema.properties?.items?.items?.properties?.nature?.enum;
  if (JSON.stringify(natures) !== JSON.stringify(NATURES)) {
    throw new Error(`Prompt ${version} : natures attendues ${NATURES.join(', ')}`);
  }
  const schema = zodDepuisSchema(responseSchema);
  return { version, systeme, responseSchema, valider: (s) => normaliser(schema.parse(s) as TriSortie) };
}

export interface VariablesPrompt {
  emis_le: string;
  jour_semaine: string;
  fuseau: string;
  themes_connus: string[];
  prenoms_connus: string[];
  exemples: string;
}

export function rendrePrompt(systeme: string, v: VariablesPrompt): string {
  const aucun = "aucun pour l'instant";
  const valeurs: Record<string, string> = {
    emis_le: v.emis_le,
    jour_semaine: v.jour_semaine,
    fuseau: v.fuseau,
    themes_connus: v.themes_connus.join(', ') || aucun,
    prenoms_connus: v.prenoms_connus.join(', ') || aucun,
    exemples: v.exemples,
  };
  return systeme.replace(/\{\{(\w+)\}\}/g, (motif, cle: string) => valeurs[cle] ?? motif);
}

export function normaliserTheme(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const ATTRIBUTS_ACTION = [
  'echeance_type', 'echeance_expr', 'echeance_date', 'fenetre_debut', 'fenetre_fin',
  'importance', 'effort', 'contexte', 'alarme', 'alarme_expr',
] as const;

/** Applique les règles du prompt que le schéma ne peut pas exprimer. */
export function normaliser(s: TriSortie): TriSortie {
  return {
    transcription: s.transcription,
    items: s.items.map((it, i) => {
      const n: ItemTri = { ...it, position: i + 1, theme: normaliserTheme(it.theme) };
      if (n.nature !== 'action') {
        for (const k of ATTRIBUTS_ACTION) n[k] = null;
      } else if (n.echeance_type !== 'datee') {
        n.alarme = null;
        n.alarme_expr = null;
      }
      if (n.nature !== 'pensee') n.tonalite = null;
      return n;
    }),
  };
}

/** Valeurs admises d'un champ d'item, lues dans le schéma de la version (décision 21). */
export function valeursAdmises(prompt: Prompt, champ: keyof ItemTri): string[] {
  const schema = prompt.responseSchema as Noeud;
  return schema.properties?.items?.items?.properties?.[champ]?.enum ?? [];
}
