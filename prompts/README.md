# Prompts

Un dossier par prompt, un sous-dossier par version. Une version publiée ne se
modifie plus : on en crée une nouvelle, et chaque item garde la version qui l'a
classé (`version_prompt`).

## `tri/` — transcription, découpage et classement (un seul appel Gemini)

- `system.md` : prompt système.
- `response-schema.json` : `responseSchema` passé à Gemini avec
  `responseMimeType: application/json`. Le worker revalide la sortie avec Zod.

Variables remplacées par le worker avant l'appel :

| Variable | Contenu |
| --- | --- |
| `{{emis_le}}` | date et heure d'émission du vocal, ISO 8601 |
| `{{jour_semaine}}` | jour de la semaine de l'émission, en toutes lettres |
| `{{fuseau}}` | fuseau de l'utilisatrice, `Europe/Paris` |
| `{{themes_connus}}` | thèmes existants, séparés par des virgules |
| `{{prenoms_connus}}` | prénoms et alias connus |
| `{{exemples}}` | jusqu'à dix corrections passées, les plus proches ; vide au départ |

Les prénoms réels n'entrent jamais dans ces fichiers : ils sont injectés à
l'exécution depuis la base.
