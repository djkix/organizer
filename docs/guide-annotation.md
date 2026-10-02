# Guide d'annotation — lot 0

Chaque vocal de la semaine de collecte devient une ou plusieurs lignes dans
`corpus/annotations.jsonl`. Ce fichier sert de jeu de référence pour valider le
prompt de tri. Il reste **hors du dépôt** : `corpus/` est ignoré par Git et
interdit en lecture à Claude.

Les valeurs suivent le schéma de sortie du cahier des charges (section
« Étape 2 — Schéma de sortie »). Une contradiction entre ce guide et le cahier
est un bug à corriger dans les deux.

## Mise en place

```bash
mkdir -p corpus/export
# Export Telegram Desktop (JSON + vocaux) dans corpus/export/
touch corpus/annotations.jsonl
```

Copier `corpus/` sur le NAS après chaque séance d'annotation.

## Une ligne par item

Un vocal qui parle de trois sujets donne trois lignes, avec le même `capture`
et une `position` différente. Dans le doute, ne pas découper : deux sujets
fusionnés à tort sont moins graves qu'une pensée coupée en deux moitiés
incompréhensibles.

## Champs

| Champ | Valeurs | Quand le remplir |
| --- | --- | --- |
| `capture` | identifiant du message dans l'export Telegram, ex. `msg_1042` | toujours |
| `position` | 1, 2, 3… dans le vocal | toujours |
| `emis_le` | date et heure du message, ISO 8601 | toujours |
| `duree_s` | durée du vocal en secondes | toujours |
| `texte` | transcription du morceau, mots d'origine conservés | toujours |
| `nature` | `action`, `pensee`, `information`, `ambigu` | toujours |
| `echeance_type` | `datee`, `jour`, `fenetre`, `relative`, `aucune` | actions |
| `echeance_expr` | l'expression telle que dite, ex. « avant Noël » | si une échéance est dite |
| `echeance_date` | date résolue, ISO 8601, ex. `2026-10-08T00:00:00+02:00` | `datee`, `jour`, `relative` |
| `fenetre_debut`, `fenetre_fin` | bornes résolues, ISO 8601 | `fenetre` |
| `importance` | `haute`, `normale`, `basse` | actions |
| `effort` | `moins_5min`, `moins_30min`, `plus_1h`, `multi_session` | actions, si évident |
| `contexte` | `appel`, `achat`, `maison`, `administratif`, `avec_quelquun`, `autre` | actions |
| `alarme` | `true` ou `false` | actions `datee` uniquement |
| `alarme_expr` | la formulation qui demande l'alarme, ex. « faut pas que je le rate » | si `alarme` vaut `true` |
| `personnes` | liste de prénoms cités | toujours, `[]` si aucun |
| `theme` | libellé court, réutilisé d'une ligne à l'autre | toujours |
| `tonalite` | `constat`, `question`, `inquietude`, `elan` | pensées |
| `remarque` | ce qui a fait hésiter | si besoin |

## Règles

1. **Aucune invention.** Un attribut absent de ce qui a été dit reste `null`.
   Une importance ou une échéance ne se devine pas.
2. **L'alarme ne se déduit jamais de l'importance.** Elle vaut `true` seulement
   si L la demande en parlant. Relever chaque formulation dans `alarme_expr` :
   c'est la liste attendue pour le lot 2.
3. **Thèmes stables.** Avant d'en créer un, relire la liste existante. Un même
   sujet ne doit pas avoir trois libellés.
4. **`ambigu` plutôt qu'un classement forcé.** C'est ce que le système fera :
   une question unique, ou `à revoir`.
5. **Transcription** à la main, avec whisper.cpp en local, ou par Gemini en
   palier payé : L a donné son accord le 2 octobre 2026.

## Exemple (énoncés fabriqués)

```jsonl
{"capture":"msg_0001","position":1,"emis_le":"2026-10-06T08:12:00+02:00","duree_s":9,"texte":"rappeler le plombier jeudi pour la fuite","nature":"action","echeance_type":"jour","echeance_expr":"jeudi","importance":"normale","effort":"moins_5min","contexte":"appel","alarme":null,"alarme_expr":null,"personnes":[],"theme":"maison","tonalite":null,"remarque":null}
{"capture":"msg_0002","position":1,"emis_le":"2026-10-06T21:40:00+02:00","duree_s":31,"texte":"dentiste lundi 13 à 9h, mets-moi une alarme","nature":"action","echeance_type":"datee","echeance_expr":"lundi 13 à 9h","importance":"haute","effort":"plus_1h","contexte":"autre","alarme":true,"alarme_expr":"mets-moi une alarme","personnes":[],"theme":"sante","tonalite":null,"remarque":null}
{"capture":"msg_0002","position":2,"emis_le":"2026-10-06T21:40:00+02:00","duree_s":31,"texte":"j'ai l'impression de toujours dire oui trop vite","nature":"pensee","echeance_type":null,"echeance_expr":null,"importance":null,"effort":null,"contexte":null,"alarme":null,"alarme_expr":null,"personnes":[],"theme":"moi","tonalite":"constat","remarque":null}
```

## Sortie du lot 0

- Au moins 60 items annotés.
- Liste de thèmes qui ne bouge plus d'une séance à l'autre.
- Des fixtures fabriquées dans `fixtures/` : même structure et même type
  d'échéance, mots et prénoms changés. Aucun énoncé réel n'en sort.
