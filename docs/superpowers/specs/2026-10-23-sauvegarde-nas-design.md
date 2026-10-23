# Sauvegarde quotidienne vers le NAS — conception

23 octobre 2026 · djkix · lot 2 (décision 11), version visée 1.11.0

## Intention

Aujourd'hui, rien ne protège les données d'Organizer contre la perte du disque de la VM Docker, en dehors d'un éventuel instantané hyperviseur. Il faut une sauvegarde quotidienne automatique vers le NAS du homelab : tout ce qu'il faut pour retrouver toutes les captures, pensées, actions et enregistrements de L doit se trouver dans un dossier du NAS, lisible directement depuis File Station.

## Décisions de djkix (23 octobre 2026)

- **Cible** : NAS sous Xpenology (DSM), à l'adresse `<IP du NAS>`, dossier déjà créé `<dossier du NAS>` (chemin vu dans File Station). La sauvegarde va dans un sous-dossier `organizer/`.
- **Accès** : NFS, déjà activé sur le NAS. Règle existante du dossier partagé `<partage>` pour la VM Docker `<IP de la VM>` : lecture/écriture, « Mappage de tous les utilisateurs » (squash total), asynchrone, port non privilégié et montage croisé autorisés. Toutes les écritures arrivent donc sous un seul utilisateur du NAS, quel que soit l'uid du conteneur.
- **Fréquence** : tous les jours.
- **Rotation** : 7 jours ; au-delà, la plus ancienne sauvegarde est remplacée.
- **Incrémental** : souhaité, pour ne pas multiplier l'audio par sept.
- **Pas de chiffrement.** Les fichiers sont en clair sur le NAS.
- **Tout est sauvegardé, audio privé compris.** L a donné son accord pour que ses enregistrements privés soient copiés en clair sur le NAS. « Tout » comprend aussi le dossier `secrets/` de la stack : une sauvegarde suffit à tout remonter, même si le gestionnaire de mots de passe est incomplet (sans `agenda_cle`, le jeton Google en base serait illisible et L devrait reconnecter son agenda). Les secrets sont donc en clair sur le NAS.

Ces décisions remplacent, dans les documents de référence, le « chiffrement GPG avant dépôt sur le NAS, clé conservée hors du serveur » et la mention « NAS (VM N) ».

## Objectifs

1. Chaque nuit, une sauvegarde complète et cohérente : base, audio, configuration de la stack.
2. Sept sauvegardes quotidiennes au plus, chacune ouvrable seule, sans outil particulier.
3. Une restauration complète possible depuis n'importe laquelle des sept, documentée et essayée une fois en vrai.
4. djkix est alerté si une sauvegarde échoue ou si aucune n'a réussi depuis 36 h.

## Non-objectifs

- Chiffrement (décision de djkix).
- Sauvegarde de Valkey : la file se reconstruit (les captures en cours sont reprises par le worker).
- Copie hors site, rétention mensuelle ou annuelle.
- Restauration en un clic depuis l'interface.

## Anti-objectifs

- **Rien de visible pour L.** Aucun écran, aucun message, aucune notification de sauvegarde (règles 2 et 3). Seul l'admin voit les alertes, dans Réglages › Alertes techniques.
- **Une sauvegarde ratée ne détruit jamais une bonne.** La rotation ne supprime que si la nuit a réussi.
- **Aucune ouverture vers Internet.** Le conteneur de sauvegarde n'a pas de route vers Internet.
- **Aucune action manuelle en régime normal** (exploitation légère).
- **La sauvegarde ne gêne pas la capture** : elle ne verrouille ni la base ni le volume audio.

## Ce que contient une sauvegarde

```
<dossier du NAS>/
├── 2026-10-23/
│   ├── base/organizer.dump      pg_dump -Fc de la base complète
│   ├── audio/                   copie du volume audio (ordinaire et privé)
│   ├── config/compose.yaml      compose de la stack
│   ├── config/.env              réglages de la stack
│   ├── config/secrets/          les cinq secrets de la stack
│   └── sauvegarde.txt           version d'Organizer, heure de début et de fin, tailles
├── 2026-10-22/
├── …                            7 dossiers datés au plus
└── derniere -> 2026-10-23       lien vers la plus récente réussie
```

- **Base** : `pg_dump -Fc` complet chaque nuit. La base pèse moins de 5 Go à un an : pas d'incrémental.
- **Audio** : `rsync -rlt --link-dest=../derniere/audio` (sans propriétaire ni groupe : le squash les écrase de toute façon ; la restauration remet le propriétaire 1000). Un fichier inchangé depuis la veille devient un lien physique vers celui de la veille ; seuls les nouveaux fichiers sont copiés. Chaque dossier daté paraît complet, mais sept jours occupent environ la place d'un seul plus les nouveautés. Un fichier purgé par la rotation de l'audio disparaît de la sauvegarde du jour et reste dans les plus anciennes jusqu'à leur suppression.
- **Ordre** : la base d'abord, l'audio ensuite. Tout fichier référencé par la base copiée est donc présent dans l'audio copié.
- **Configuration** : `compose.yaml`, `.env` et `secrets/` de `/opt/stacks/organizer/`, montés en lecture seule.

## Comment ça tourne

- Un nouveau service `sauvegarde` dans `infra/docker-compose.yml`, image `ghcr.io/djkix/organizer-sauvegarde`, construite par la CI comme les autres (nouvelle étape dans `infra/image/Dockerfile`) : client PostgreSQL 17 et rsync.
- Planification par le conteneur lui-même, à **3 h, heure de Paris**, chaque jour. Il redémarre avec la stack (`restart: unless-stopped`). Une nuit manquée parce que la VM était éteinte est rattrapée au démarrage si la dernière réussite date de plus de 24 h.
- Réseau `core` seulement (accès à `db`), aucune sortie.
- Le NAS est monté par Docker comme un volume NFS déclaré dans le compose (`driver_opts: type=nfs`, adresse `<IP du NAS>`). Le chemin d'export exact (`/volumeN/<partage>`) est à relever depuis la VM (`showmount -e <IP du NAS>`), avec un essai d'écriture, de lien physique et de suppression dans `<dossier>/` avant toute autre tâche.
- Volumes : `audio` en lecture seule, la configuration de la stack en lecture seule, le NAS en écriture.
- Utilisateur non root, racine en lecture seule, limite mémoire basse, comme les autres services.
- **Panne du NAS** (*appel de Claude*) : aucun service ne dépend de `sauvegarde`. Si le NAS est éteint, Docker ne peut pas monter le volume et seul ce conteneur ne démarre pas ; `up -d --wait` le signale, mais la capture et le reste de la stack tournent. L'alerte « aucune réussite depuis 36 h » vient de la veille de l'API : elle part même si le conteneur de sauvegarde est absent. `docs/exploitation.md` le dit dans « Mettre à jour » et « Dépannage rapide ».
- Lancement à la main possible, pour l'essai et avant une mise à jour risquée : une commande documentée dans `docs/exploitation.md`.

### Déroulé d'une nuit

1. Créer `organizer/.en-cours/`.
2. `pg_dump` vers `base/`, puis rsync de l'audio, puis copie de la configuration, puis `sauvegarde.txt`.
3. Si tout a réussi : renommer `.en-cours` en `AAAA-MM-JJ` (une deuxième sauvegarde le même jour remplace celle du jour), pointer `derniere` dessus, puis supprimer les dossiers datés au-delà des sept plus récents.
4. Si une étape échoue : laisser les dossiers datés intacts, supprimer `.en-cours` à la tentative suivante, et signaler l'échec.

## Alertes

Le conteneur enregistre chaque tentative en base : une nouvelle table `sauvegarde` (début, fin, réussite, message court sans contenu de L), par migration additive. La veille horaire de l'API, qui produit déjà les alertes techniques, lit cette table :

- **dernière tentative en échec** → alerte admin, avec le message ;
- **aucune réussite depuis 36 h** (NAS éteint, montage NFS perdu, conteneur arrêté) → alerte admin.

Les alertes passent par le chemin existant (table `alerte`, Réglages › Alertes techniques, point discret sur l'onglet pour l'admin seul). Aucun texte de capture dans les messages ni dans les journaux.

## Restauration

Documentée dans `docs/exploitation.md`, section « Sauvegarde et restauration », qui remplace la procédure manuelle actuelle :

1. Arrêter `api`, `worker` et `scheduler`.
2. `pg_restore --clean --if-exists` depuis `base/organizer.dump`.
3. rsync de `audio/` vers le volume `audio`, propriétaire 1000.
4. Remettre `compose.yaml`, `.env` et `secrets/` (droits 600, propriétaire 1000) si la VM est reconstruite.
5. Relancer la stack et vérifier `/api/sante`.

Critère de sortie : une restauration réellement jouée une fois à partir d'une sauvegarde du NAS, sans toucher à la production. *Appel de Claude* : pas de seconde stack complète. Sur la VM Docker, un PostgreSQL 17 jetable reçoit le `pg_restore`, puis on compare le nombre de captures et d'items avec la production ; l'audio est copié dans un volume jetable et on compare le nombre et la taille des fichiers. Tout est supprimé ensuite.

## Documents à mettre à jour, dans le même commit

- `docs/decisions.md` : nouvelle décision 28 (sauvegarde quotidienne vers le NAS `<IP du NAS>` en NFS, sept jours, sans chiffrement, audio privé compris avec l'accord de L, décidée par djkix le 23 octobre 2026).
- `docs/cahier-des-charges.md` : sections Sauvegarde, Chiffrement (plus de GPG pour les sauvegardes), critère « Confidentialité » (une capture privée ne quitte pas le réseau local et ne part jamais vers Gemini), volumes persistants, services, supervision.
- `CLAUDE.md` : règle 5 et état du projet.
- `docs/exploitation.md`, `README.md`, `CHANGELOG.md`.

## Laissé au constructeur

- Le moyen de planifier dans le conteneur (boucle shell, supercronic ou autre).
- Le schéma exact de la table `sauvegarde` et le nom de ses champs.
- Les options exactes de montage NFS (version, `nolock`, etc.).
- Le format de `sauvegarde.txt`.
- La limite mémoire du service.
