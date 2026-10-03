# Journal des modifications

Toutes les modifications notables de ce projet sont consignées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).
Le projet n'a pas encore de version publiée.

## [Non publié]

### Sécurité
- La connexion n'accorde plus créance à X-Forwarded-For que du proxy de confiance, un changement de mot de passe révoque les sessions, et la saisie du mot de passe est masquée et confirmée (2026-10-03).

### Corrigé
- L'audio se sert depuis sa racine, même sous un dossier caché, et une correction d'échéance efface l'expression d'origine (2026-10-03).
- L'ordre des vues est stable à égalité, le libellé d'un horizon vient de la première expression connue, et À revoir exclut les items privés (2026-10-03).

### Ajouté
- Les captures privées par la PWA : audio réencodé en Opus et gardé sur le serveur, jamais transcrit ni classé, étiquette facultative, liste par jour (2026-10-03).
- Cocher et décocher une action, corriger la nature ou l'échéance d'un item avec historique, réécouter l'audio d'origine (2026-10-03).
- Les vues Aujourd'hui, Cette semaine, Horizons et À revoir de l'API, communes aux deux comptes (2026-10-03).
- La connexion à la PWA : mot de passe Argon2id posé en ligne de commande, session de 90 jours en cookie sécurisé, limitation de débit (2026-10-03).
- Les jours civils dans le fuseau de l'utilisatrice, et le schéma des sessions, des mots de passe et des étiquettes privées (2026-10-03).
- Le plan du lot 1-B1 : API de la PWA et mode privé côté serveur (2026-10-03).
- Le dossier de revue du lot 1-A, à transmettre à un relecteur externe pour challenger l'approche (2026-10-03).
- Le bot Telegram, la liaison des comptes par code, les alertes à l'administrateur et l'API NestJS avec sa commande de création de comptes (2026-10-03).
- L'ingestion d'une capture Telegram : enregistrée avant l'accusé, audio rangé, job de classement enfilé, reprise des captures restées en attente (2026-10-03).
- Le worker BullMQ : crédit épuisé mis en pause avec une seule alerte, reprise des captures à transcrire, refus de démarrer hors palier payé (2026-10-03).
- Le classement d'une capture en items, rejouable sans doublon, qui refuse toute capture privée (2026-10-03).
- Le README décrit le projet, son état et le démarrage en développement, et ce journal est tenu à jour à chaque commit (2026-10-03).
- Le monorepo pnpm et la base de dev (Postgres et Valkey) sur la VM Docker, jointe par un tunnel SSH (2026-10-03).
- Le chargement des prompts versionnés et la validation de la sortie de tri par son schéma (2026-10-03).
- Le schéma de base de données, avec le mode privé verrouillé en SQL (2026-10-03).
- L'interface `ClassificationProvider` et le fournisseur Gemini, avec repli sur un second modèle (2026-10-03).
- Le plan du lot 1-A : socle et pipeline de capture (2026-10-03).
- L'outil de relecture des captures du banc d'essai (2026-10-02).
- Le banc d'essai terrain : un bot Telegram qui envoie chaque vocal à Gemini avec le prompt de tri (2026-10-02).
- Le prompt de tri v1 et son schéma de sortie (2026-10-02).
- La stack Docker Compose de production, plafonnée à 50 Go avec rotation de l'audio (2026-10-02).
- Le guide d'annotation du lot 0 (2026-10-02).
- Les maquettes, avec des prénoms fictifs (2026-10-01).
- Le cadrage initial : décisions, cahier des charges et règles du projet (2026-10-01).

### Sécurité
- Une erreur du webhook Telegram ou une erreur de validation de la base ne recopie plus le contenu d'une capture dans les journaux (2026-10-03).
- La liaison d'un compte Telegram est limitée à dix échecs par dix minutes, ne remplace jamais un lien existant (commande « délier » pour l'admin) (2026-10-03).

### Modifié
- Le README et `.env.example` décrivent l'état réel du lot 1-A, le bot unique @organizer_lud_bot, la configuration, l'administration, et `pnpm db` charge le `.env` pour Prisma (2026-10-03).
- Une légende de message est gardée comme texte, et le bot répond aux formats qu'il ne prend pas en charge (2026-10-03).
- Les lots 0 et 1 sont menés en parallèle (décision 21) (2026-10-03).
- Les tests appliquent les migrations sans réinitialiser la base (2026-10-03).
- La stack est hébergée sur l'hôte Docker existant (décision 13) et son empreinte mémoire est réduite à environ 2,7 Go (2026-10-02).
- Le bot Telegram est renommé @organizer_lud_bot (décision 20) (2026-10-02).
- Le banc d'essai traite une vidéo ronde comme un vocal (2026-10-02).
- Le jalon du lot 0 est noté : besoin confirmé et accord de L pour Gemini en palier payé (2026-10-02).
- Les plafonds Gemini et le traitement du crédit épuisé sont décrits (2026-10-01).

### Corrigé
- Un chemin relatif d'audio ou de prompts se lit depuis la racine du dépôt : l'API et le worker partagent le même dossier (2026-10-03).
- L'alerte de crédit épuisé est réessayée jusqu'à sa remise, et un admin injoignable ne prive plus les autres (2026-10-03).
- Le worker remet en file, au démarrage puis chaque heure, les captures restées en file plus d'une heure sans traitement en cours (2026-10-03).
- Une capture dont le classement ne produit aucun item passe en « à revoir » au lieu de disparaître (2026-10-03).
- L'API démarre en mode polling : la route du webhook n'existe qu'en mode webhook, et un polling arrêté termine l'API (2026-10-03).
- Le worker attend au démarrage si le contrôle du palier échoue, survit à une alerte en panne et ne perd plus de capture à la reprise (2026-10-03).
- Les erreurs de schéma ne contiennent plus le contenu du modèle (2026-10-03).
- Les fichiers embarqués du banc d'essai sont lisibles par l'utilisateur du bot (2026-10-02).
- Les fixtures et le schéma de sortie sont alignés sur l'alarme et le contexte (2026-10-01).
- Les identifiants Proxmox du cahier des charges sont corrigés (2026-10-02).
