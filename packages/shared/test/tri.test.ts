import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chargerPrompt, ecarterPassees, normaliser, normaliserTheme, rendrePrompt, valeursAdmises } from '../src/tri.js';
import { sortieExemple } from './sortie-exemple.js';

const PROMPTS = join(import.meta.dirname, '../../../prompts');
const v1 = () => chargerPrompt(PROMPTS, 'tri/v1');

describe('chargerPrompt tri/v1', () => {
  it('valide une sortie conforme', () => {
    expect(v1().valider(sortieExemple()).items).toHaveLength(2);
  });

  it('expose la version et le schéma tel que transmis à Gemini', () => {
    const p = v1();
    expect(p.version).toBe('tri/v1');
    expect(p.systeme).toContain('{{emis_le}}');
    expect(p.responseSchema).toHaveProperty('type', 'OBJECT');
  });

  it('refuse une nature hors liste', () => {
    const s = sortieExemple();
    (s.items[0] as { nature: string }).nature = 'tache';
    expect(() => v1().valider(s)).toThrow();
  });

  it('refuse un type d\'échéance absent du schéma de la version', () => {
    const s = sortieExemple();
    s.items[0]!.echeance_type = 'bientot';
    expect(() => v1().valider(s)).toThrow();
  });

  it('accepte une date sans secondes ou en Z', () => {
    const s = sortieExemple();
    s.items[0]!.echeance_date = '2026-10-08T10:00+02:00';
    s.items[0]!.fenetre_fin = '2026-12-24T23:00:00Z';
    expect(() => v1().valider(s)).not.toThrow();
  });

  it('refuse une date sans fuseau', () => {
    const s = sortieExemple();
    s.items[0]!.echeance_date = '2026-10-08T10:00:00';
    expect(() => v1().valider(s)).toThrow();
  });

  it('refuse un attribut obligatoire absent', () => {
    const s = sortieExemple() as unknown as { items: Record<string, unknown>[] };
    delete s.items[0]!.theme;
    expect(() => v1().valider(s)).toThrow();
  });

  it('refuse une version dont les natures diffèrent de la règle produit', () => {
    const racine = mkdtempSync(join(tmpdir(), 'prompts-'));
    cpSync(join(PROMPTS, 'tri/v1'), join(racine, 'tri/v9'), { recursive: true });
    const f = join(racine, 'tri/v9/response-schema.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"ambigu"]', '"ambigu", "rappel"]'));
    expect(() => chargerPrompt(racine, 'tri/v9')).toThrow('natures');
  });
});

describe('chargerPrompt tri/v2', () => {
  it('valide une sortie conforme avec le même schéma', () => {
    const p = chargerPrompt(PROMPTS, 'tri/v2');
    expect(p.version).toBe('tri/v2');
    expect(p.valider(sortieExemple()).items).toHaveLength(2);
  });
});

describe('normaliser', () => {
  it('vide les attributs d\'action sur une pensée et la tonalité sur une action', () => {
    const s = sortieExemple();
    s.items[1]!.echeance_type = 'jour';
    s.items[0]!.tonalite = 'elan';
    const n = normaliser(s);
    expect(n.items[1]!.echeance_type).toBeNull();
    expect(n.items[0]!.tonalite).toBeNull();
  });

  it('retire l\'alarme d\'une action non datée', () => {
    const s = sortieExemple();
    s.items[0]!.alarme = true;
    s.items[0]!.alarme_expr = 'préviens-moi';
    const n = normaliser(s);
    expect(n.items[0]!.alarme).toBeNull();
    expect(n.items[0]!.alarme_expr).toBeNull();
  });

  it('range en ambigu un élément dont la nature est incertaine (sous 0,5)', () => {
    const s = sortieExemple();
    s.items[0]!.confiance.nature = 0.4;
    s.items[0]!.echeance_type = 'jour';
    s.items[1]!.confiance.nature = 0.5;
    const n = normaliser(s);
    expect(n.items[0]!.nature).toBe('ambigu');
    expect(n.items[0]!.echeance_type).toBeNull();
    expect(n.items[1]!.nature).not.toBe('ambigu');
  });

  it('range en ambigu une action datée de plus de 24 h avant l\'envoi, garde celle du jour', () => {
    const s = sortieExemple();
    s.items[0]!.echeance_type = 'datee';
    s.items[0]!.echeance_date = '2026-09-12T10:00:00+02:00';
    const emis = new Date('2026-10-02T17:33:00+02:00');
    expect(ecarterPassees(s, emis).items[0]!.nature).toBe('ambigu');
    expect(ecarterPassees(s, emis).items[0]!.echeance_date).toBeNull();
    s.items[0]!.echeance_type = 'jour';
    s.items[0]!.echeance_date = '2026-10-02T00:00:00+02:00';
    expect(ecarterPassees(s, emis).items[0]!.nature).toBe('action');
  });

  it('renumérote les positions de 1 à n', () => {
    const s = sortieExemple();
    s.items[0]!.position = 7;
    s.items[1]!.position = 7;
    expect(normaliser(s).items.map((i) => i.position)).toEqual([1, 2]);
  });

  it('normaliserTheme retire accents, majuscules et espaces superflus', () => {
    expect(normaliserTheme('  Santé   Été ')).toBe('sante ete');
  });
});

describe('rendrePrompt', () => {
  it('remplace les variables et signale l\'absence de thèmes', () => {
    const r = rendrePrompt('{{emis_le}} {{themes_connus}} | {{prenoms_connus}} | {{inconnue}}', {
      emis_le: '2026-10-06T08:12:00+02:00', jour_semaine: 'mardi', fuseau: 'Europe/Paris',
      themes_connus: [], prenoms_connus: ['A', 'B'], exemples: '',
    });
    expect(r).toBe("2026-10-06T08:12:00+02:00 aucun pour l'instant | A, B | {{inconnue}}");
  });

  it('n\'interprète pas les motifs spéciaux de replace dans les valeurs', () => {
    const r = rendrePrompt('{{themes_connus}}', {
      emis_le: '', jour_semaine: '', fuseau: '', themes_connus: ['$&'], prenoms_connus: [], exemples: '',
    });
    expect(r).toBe('$&');
  });
});

describe('valeursAdmises', () => {
  it('lit les valeurs d\'un champ dans le schéma de la version', () => {
    expect(valeursAdmises(v1(), 'echeance_type')).toEqual(['datee', 'jour', 'fenetre', 'relative', 'aucune']);
    expect(valeursAdmises(v1(), 'texte')).toEqual([]);
  });
});
