# Relecture des captures

Valide ou corrige, item par item, ce que Gemini a classé dans le banc d'essai
terrain. Le résultat, `corpus/annotations.jsonl`, est le corpus de référence du
lot 0 (format : `docs/guide-annotation.md`).

```bash
python3 tools/relecture/relecture.py              # récupère depuis le serveur, puis ouvre
python3 tools/relecture/relecture.py --sans-recup # rouvre sans récupérer
```

- Récupération : `captures.jsonl` et l'audio du volume `organizer-terrain_donnees`,
  copiés dans `corpus/terrain/`. Rien n'est modifié sur le serveur.
- Relecture : chaque champ modifié est surligné, avec la valeur proposée par Gemini.
  « Valider » enregistre la capture telle qu'elle est affichée.
- Les chiffres en haut mesurent l'accord avec Gemini, champ par champ, sur les
  captures relues. C'est l'indicateur pour décider si le prompt est prêt.

Tout reste dans `corpus/`, ignoré par Git. Le serveur n'écoute que sur 127.0.0.1.
Python 3 seul, aucune dépendance.

## Accès SSH

La récupération passe par `ssh kix@192.168.1.201` (autre hôte : variable
`ORGANIZER_SSH`). Une seule fois, autoriser la clé du Mac :

```bash
ssh-copy-id kix@192.168.1.201
```

L'utilisateur distant doit pouvoir lancer `docker` sans `sudo`.
