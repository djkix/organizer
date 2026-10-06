# Sauvegarde vers le NAS — spécification

Date : 6 octobre 2026. Base : version 1.3.0. État : **proposition, à valider par Franck** avant le plan d'implémentation.

Sous-lot du lot 2 qui met en œuvre la décision 11 : « Aucune au démarrage. Sauvegarde vers le NAS Synology au lot 2 »
(rangé dans le lot 2-C par le plan du lot 2-A). Rédigée sans accès au homelab : tout ce qui touche au NAS, à DSM ou au
réseau local et n'a pas pu être constaté est marqué **à vérifier**, et repris dans « Points à vérifier » en fin de document.

Sources : `docs/decisions.md` (11, 12, 13), `docs/cahier-des-charges.md` (Sauvegarde, Chiffrement, Volumes persistants,
Réseaux, Supervision, Rotation de l'audio, Règles de conservation, Risques), `infra/docker-compose.yml`,
`infra/sortie/squid.conf`, `docs/exploitation.md` (Sauvegarde et restauration, Revenir à la version précédente, Supervision),
`apps/api/src/ingestion/stockage.ts`, `apps/api/src/veille/`, `apps/worker/src/worker.ts` (`reprendre`).

## 1. Objectif et garanties

Protéger la base et l'audio d'Organizer contre la perte de la VM Docker (VM 105), de son disque ou de la stack, sans
rien demander à personne en régime normal.

| Garantie | Valeur | Ce qu'elle veut dire ici |
| --- | --- | --- |
| RPO | 24 heures | Au pire, on perd ce qui a été capté depuis la dernière sauvegarde réussie de la nuit |
| RTO | 4 heures | De la décision de restaurer à « L capte de nouveau et retrouve ses données » (détail en section 9.3) |
| Test de restauration | À la livraison, puis une fois par an | Restauration complète réelle, chronométrée, invisible pour L |
| Exploitation | Rien de manuel chaque mois | Ni vérification, ni rotation, ni élagage à la main |
| Alertes | Administrateur seul, par Telegram | Échec d'une sauvegarde, ou dernière réussite plus vieille que 26 heures |
| Côté L | Rien | Aucun message, aucun écran, aucun indicateur ; la sauvegarde tourne la nuit |
| Audio privé | Toujours dans la sauvegarde | Seule trace d'une capture privée, jamais purgé : un audio privé absent de la sauvegarde est une alerte |
| Confidentialité | Rien de lisible hors de la VM | Chiffré sur la VM avant d'en sortir ; la clé qui déchiffre n'est jamais sur le serveur |

## 2. Ce qui est sauvegardé

| Élément | Sauvegardé | Comment | Pourquoi |
| --- | --- | --- | --- |
| Base PostgreSQL (`organizer_pgdata`) | Oui, chaque nuit | `pg_dump -Fc` complet, chiffré | Tout le texte, les items, les corrections, les sessions, l'état de l'agenda |
| Audio (`organizer_audio`) | Oui, chaque nuit, incrémental | Seuls les fichiers nouveaux, chiffrés un par un | Jusqu'à 40 Go ; un fichier audio n'est jamais modifié après écriture |
| File Valkey (`organizer_valkeydata`) | Non | — | Reconstructible : le worker ré-enfile seul les captures `a_transcrire` ou orphelines `en_file` au démarrage puis chaque heure (`reprendre`), le scheduler rattrape l'agenda toutes les 10 minutes. Les défis d'empreinte et les états OAuth (quelques minutes) sont perdus sans conséquence |
| `compose.yaml` | Non | — | C'est `infra/docker-compose.yml` à l'étiquette `v<ORGANIZER_VERSION>` ; la version est notée dans chaque manifeste de sauvegarde |
| `.env` et `secrets/` | Non | Gestionnaire de mots de passe (cahier, Sauvegarde) | Voir 2.2 |
| Images | Non | — | Publiques sur GHCR, reconstruisibles depuis l'étiquette |

### 2.1 Disposition de l'audio, et ce qu'elle permet

`StockageAudio` range chaque fichier sous `<type>/<année>/<mois>/<id>.<ext>`, avec `type` égal à `ordinaire` ou `prive`,
et ne le réécrit jamais (réécrire le même identifiant est sans effet). La seule suppression est la rotation de l'audio
ordinaire (scheduler, 4 h, au-delà de 40 Go, jamais un fichier `prive/`). Conséquences :

- l'incrémental est simple : un fichier déjà envoyé ne change plus, il suffit de tenir la liste de ce qui est parti ;
- l'arborescence `prive/` peut être comptée à chaque passage : tout fichier présent sur le volume doit figurer dans
  l'index des fichiers envoyés, sinon alerte ;
- la sauvegarde ne propage **aucune suppression** : un audio ordinaire purgé par la rotation reste sur le NAS (voir 6.3).

### 2.2 Pourquoi ni le `.env` ni les secrets

Le cahier les place dans le gestionnaire de mots de passe « dès maintenant », et `docs/exploitation.md` le rappelle à
chaque changement de secret. Les sauvegarder aussi aurait un coût réel : le conteneur de sauvegarde devrait monter
`secrets/`, donc détenir le jeton du bot, la clé Gemini et le secret OAuth, ce qui élargit ce qu'une faille de ce
conteneur expose. Le bénéfice est faible, car **aucun secret ne conditionne la récupération des données** :

| Secret perdu | Effet à la restauration |
| --- | --- |
| `POSTGRES_PASSWORD` | Aucun : on en génère un neuf, le dump ne le contient pas |
| Jeton du bot, secret du webhook | `/revoke` chez BotFather, nouveau jeton, `telegram-webhook poser` |
| Clé Gemini, secret OAuth | Nouvelle clé, nouveau secret dans la console Google |
| `agenda_cle` | Les jetons Google en base deviennent illisibles : chaque compte reconnecte Google Agenda depuis Réglages |

Le `.env` ne contient que des réglages documentés (`infra/.env.example`, `docs/exploitation.md`). Décision proposée :
**ni `.env` ni `secrets/` dans la sauvegarde** ; le gestionnaire de mots de passe reste leur seule copie, et la
procédure de restauration (section 9) part de lui.

## 3. Chiffrement

### 3.1 Exigence

Cahier, Chiffrement : « chiffrement avant dépôt sur le NAS, clé conservée hors du serveur ». Il faut donc un chiffrement
**asymétrique** : la VM ne détient que la clé publique, qui chiffre sans pouvoir déchiffrer. Ni le NAS, ni une copie du
NAS, ni un attaquant qui prendrait la VM ne lisent les sauvegardes passées. C'est ce qui écarte restic et borg comme
outil de chiffrement (section 4) : leur clé de dépôt est symétrique et doit être sur la machine qui écrit.

### 3.2 GPG ou age

| Critère | GPG | age |
| --- | --- | --- |
| Clé publique seule sur la VM | Oui (trousseau importé) | Oui (une ligne `age1…` dans la configuration) |
| Mise en œuvre sur la VM | Trousseau, `trustdb`, agent, options pour éviter les invites (`--batch --trust-model always`) | Un binaire, aucun état : `age -r <clé publique>` |
| Clé privée à conserver | Bloc armuré de plusieurs Ko, souvent avec sous-clés et date d'expiration | Une ligne `AGE-SECRET-KEY-1…` (74 caractères), facile à mettre au gestionnaire et à imprimer |
| Pièges connus | Expiration de clé qui casse la sauvegarde un matin, algorithmes hérités, défauts trompeurs | Peu de réglages, donc peu d'erreurs possibles |
| Chiffrement authentifié | Oui (MDC, AEAD selon versions) | Oui (ChaCha20-Poly1305 par blocs de 64 Kio, en-tête authentifié) : un fichier altéré refuse de se déchiffrer |
| Plusieurs destinataires | Oui | Oui (`-r` répété) |
| Signature | Oui | Non (age ne fait que chiffrer) |
| Disponibilité à la restauration | Partout | Paquet Alpine, Debian, Homebrew ; format stable et spécifié ; implémentation alternative `rage` |
| Coût | Négligeable | Négligeable (plusieurs centaines de Mo/s) |

**Choix : age.** Pour un administrateur seul, la sobriété prime : rien à expirer, rien à faire confiance, une clé qui
tient sur une ligne. La signature, seul avantage fonctionnel de GPG, est couverte par OpenSSH, déjà présent (3.4).
Le mot « GPG » du cahier est à remplacer par « age » à l'adoption de cette spécification (section 12).

### 3.3 Les clés

| Clé | Où | Rôle |
| --- | --- | --- |
| Clé privée age (identité) | **Hors du serveur** : gestionnaire de mots de passe de Franck, plus une copie papier hors ligne (emplacement **à décider par Franck**) | Seule capable de déchiffrer ; servira à chaque restauration et au test annuel |
| Clé publique age | `.env` de la stack (`SAUVEGARDE_DESTINATAIRE`), pas un secret | Chiffre chaque fichier sur la VM |
| Second destinataire (option) | Une seconde clé age gardée ailleurs (coffre, autre personne de confiance) | Si la première est perdue ; age chiffre pour les deux à la fois |

La clé privée est générée une fois, **hors de la VM** (sur le Mac de Franck : `age-keygen`), et n'y est jamais copiée.
Perdre la clé privée rend toutes les sauvegardes illisibles : c'est le risque principal de ce choix (section 10).

### 3.4 Intégrité

- **Pendant le transfert** : rsync vérifie chaque fichier par somme de contrôle.
- **À la lecture** : age est authentifié, un octet altéré fait échouer le déchiffrement.
- **Contre une substitution sur le NAS** : age ne dit pas *qui* a chiffré (la clé publique suffit). Chaque passage écrit
  donc un **manifeste** en clair (`manifeste.json` : date, version d'Organizer, dernière migration Prisma, empreinte
  SHA-256 et taille de chaque fichier chiffré déposé ce jour-là), signé par une clé ed25519 propre à la sauvegarde
  (`ssh-keygen -Y sign -n organizer-sauvegarde`, secret Docker `sauvegarde_signature`). La clé publique de signature
  est dans le gestionnaire de mots de passe ; la restauration vérifie la signature puis chaque empreinte avant de
  déchiffrer.
- **Inventaire** : un fichier chiffré `inventaire.json.age` donne le nombre de lignes par table et le nombre de fichiers
  audio par type au moment du dump. La restauration compare ses propres comptes à cet inventaire. Il est chiffré
  parce qu'un compte de captures privées par jour est déjà une information sur L.
- **Sur le NAS** : sommes de contrôle Btrfs et nettoyage des données (« data scrubbing ») planifié par DSM (**à vérifier** :
  type de volume et réglage).

## 4. Transport et cible

### 4.1 La cible

Le NAS Synology du homelab (VM 103, DSM sous Xpenology, **modèle émulé et version de DSM à vérifier**). Un dossier
partagé dédié, par exemple `organizer-sauvegarde`, sur un volume Btrfs (**à vérifier**), visible seulement par un
utilisateur DSM dédié à la sauvegarde et par l'administrateur.

### 4.2 Les options

Critère qui domine : **la VM ne doit pas pouvoir effacer les sauvegardes passées**. Une VM compromise (ou un rançongiciel
sur elle) ne doit atteindre que la copie du jour, jamais l'historique.

| Option | Sécurité (effacement depuis la VM) | Simplicité pour Franck | Audio incrémental | Restauration | Clé hors serveur |
| --- | --- | --- | --- | --- | --- |
| A. rsync par SSH vers un utilisateur NAS dédié, historique par instantanés Btrfs du NAS | Bonne : l'utilisateur peut écrire dans le dossier, mais les instantanés ne lui sont pas accessibles ; immuables si DSM le permet | Bonne : outils standard, un utilisateur et une tâche d'instantanés dans DSM | Oui, par fichier | Simple : `rsync` puis `age -d`, ou un instantané monté en lecture | Oui (age) |
| B. Montage SMB ou NFS sur la VM | Mauvaise : le montage donne effacement et écrasement ; identifiants SMB sur la VM ; montage noyau dans un conteneur impose des privilèges | Moyenne | Oui | Simple | Oui (age) |
| C. Le NAS vient chercher (Hyper Backup, Active Backup for Business) | Excellente : la VM ne détient aucun accès au NAS | Moyenne : Hyper Backup sauvegarde les données du NAS, il ne tire pas depuis un Linux ; Active Backup for Business le peut (par rsync) mais sa disponibilité sous Xpenology est **à vérifier** | Oui | Moyenne | Oui, mais il faut des fichiers chiffrés **déjà posés sur la VM** : 40 Go d'audio en double, hors du plafond de 50 Go de la décision 12 |
| D. Dépôt restic ou borg sur le NAS, en ajout seul (`rest-server --append-only`, ou `borg serve --append-only`) | Bonne en ajout seul, mais l'élagage (`forget`/`prune`) demande un accès complet depuis une autre machine | Moyenne : un service de plus sur le NAS (conteneur ou binaire), à maintenir | Excellent (déduplication) | Bonne | **Non** : clé de dépôt symétrique, présente sur la VM |

**Choix : A.** C'est la seule option qui coche à la fois la clé hors serveur, l'incrémental sans copie locale de l'audio
et un historique que la VM ne peut pas toucher, avec des outils que Franck connaît déjà. C est plus sûre sur le papier,
mais coûte 40 Go sur la VM ou une machinerie de « dépôt tampon » fragile, et déplace la supervision côté NAS. D serait le
meilleur outil si la clé pouvait vivre sur la VM, ce que le cahier refuse.

### 4.3 Comment A tient la garantie « la VM n'efface pas l'historique »

1. **Utilisateur DSM dédié** (par exemple `organizer-sauvegarde`), non administrateur, droit de lecture et écriture sur
   le seul dossier `organizer-sauvegarde`, droit d'usage de rsync, aucun autre service (ni SMB, ni File Station, ni
   DSM). Authentification par clé SSH, sans mot de passe utilisable.
   *À vérifier* : sous DSM 7, la connexion SSH d'un utilisateur non administrateur n'est en principe permise que pour
   rsync (service rsync activé, application « rsync » autorisée à l'utilisateur) ; le dépôt de sa clé publique dans son
   dossier personnel et le respect d'une restriction `command=`/`restrict` dans `authorized_keys` sont à constater.
2. **Instantanés Btrfs** du dossier partagé par « Snapshot Replication », une fois par nuit **après** la fenêtre de
   sauvegarde, avec la politique de conservation de la section 6. L'utilisateur de sauvegarde ne voit pas les
   instantanés (`#snapshot` masqué, **à vérifier**) et ne peut pas les supprimer.
3. **Instantanés immuables** si la version de DSM les propose (DSM 7.2 et volume Btrfs, **à vérifier** sous Xpenology) :
   même un administrateur DSM ne peut pas les effacer avant leur échéance. Durée proposée : 14 jours. Sans cette
   fonction, la garantie repose sur le fait que la VM ne détient aucun identifiant d'administrateur du NAS.
4. **Côté VM** : rsync sans aucune option de suppression ; l'audio est envoyé en `--ignore-existing` (un fichier déjà
   sur le NAS n'est jamais réécrit). Ce n'est qu'une politesse : la vraie garantie est le point 2.
5. **Durcissement optionnel** : une ACL DSM qui accorde « créer des fichiers » et « écrire des données » mais refuse
   « supprimer » sur `audio/` (**à vérifier** : compatibilité avec le renommage final de rsync, sinon `--inplace`).

Risque résiduel : une VM compromise peut écraser le dump courant ou déposer des fichiers parasites. L'historique reste
dans les instantanés ; un écrasement est détecté au passage suivant (empreintes du manifeste) ou au test annuel.

### 4.4 Organisation du dossier sur le NAS

```
organizer-sauvegarde/
  base/organizer.dump.age          dump du jour (remplacé chaque nuit ; l'historique est dans les instantanés)
  base/inventaire.json.age         comptes par table et par type d'audio
  audio/ordinaire/AAAA/MM/<id>.<ext>.age
  audio/prive/AAAA/MM/<id>.<ext>.age
  index/AAAA-MM-JJ.tsv             fichiers déposés ce jour-là : chemin, taille, SHA-256 du chiffré
  manifeste.json, manifeste.json.sig
```

Les noms de fichiers restent en clair : ils révèlent l'identifiant d'une capture, son mois et le fait qu'elle est privée,
pas son contenu. Acceptable sur un NAS que seul Franck administre ; les remplacer par un condensat compliquerait la
restauration d'une capture précise (section 9.2).

## 5. Où ça tourne

| Critère | Conteneur `sauvegarde` dans la stack | Tâche cron sur l'hôte (VM 105) |
| --- | --- | --- |
| Visible et piloté dans Dockge | Oui, comme les autres services | Non : un élément hors stack, à se rappeler |
| Versionné, testé par la CI, publié avec la stack | Oui (image, essai de fumée) | Non : scripts copiés à la main |
| Accès réseau | Contrôlé par le modèle existant (section 5.2) | Tout le réseau local et Internet, comme l'hôte |
| Accès aux données | Base en lecture seule par un rôle dédié, audio monté en lecture seule | `docker exec` : l'utilisateur `kix` est de fait administrateur de tout l'hôte |
| Simplicité de mise en place | Une image de plus | Quelques paquets et une ligne de crontab |
| Remontée vers la veille | Volume partagé avec l'API (section 7) | Fichier sur l'hôte, à monter dans l'API |

**Choix : un conteneur `sauvegarde` dans la stack.** La simplicité de la tâche cron est réelle, mais elle sort la
sauvegarde du modèle d'isolation, de la CI et de Dockge, et ses scripts dériveraient de la version de la stack.

### 5.1 Le conteneur

- Image `ghcr.io/djkix/organizer-sauvegarde`, construite et analysée par la CI comme les cinq autres, à l'étiquette
  `ORGANIZER_VERSION`. Base Alpine : client PostgreSQL 17 (**même version majeure que le serveur ou plus récente**),
  `age`, `rsync`, `openssh-client`, `netcat-openbsd`, un script shell. Pas de Node.
- Utilisateur 1000, racine en lecture seule, `/tmp` en tmpfs, mémoire limitée (128 Mo proposés), journalisation comme
  les autres services. Une planification interne (boucle qui attend l'heure, ou `supercronic`, à trancher dans le plan),
  pas de démon cron root.
- Volumes : `audio` en **lecture seule** ; `sauvegarde_etat` (index local des fichiers envoyés, état du dernier passage,
  quelques Mo) ; `sauvegarde_travail` (zone de transit chiffrée, vidée après chaque passage, voir 5.3).
- Base : un rôle PostgreSQL `sauvegarde` en lecture seule (`pg_read_all_data`), mot de passe en secret Docker
  `sauvegarde_pg`, créé une fois à l'installation. Le conteneur ne reçoit pas `POSTGRES_PASSWORD`.
  *À vérifier dans le plan* : `pg_dump` complet (extension `vector`, séquences, table `_prisma_migrations`) avec ce rôle.
- Secrets : `sauvegarde_pg`, `sauvegarde_ssh` (clé privée SSH vers le NAS), `sauvegarde_signature` (clé de signature).
  Réglages non secrets dans `.env` : `SAUVEGARDE_DESTINATAIRE` (clé publique age), `NAS_ADRESSE`, `NAS_UTILISATEUR`,
  `NAS_CLE_HOTE` (clé d'hôte SSH du NAS, épinglée : aucune connexion à un hôte inconnu), `SAUVEGARDE_HEURE`.
  Aucune de ces valeurs n'entre dans le dépôt.

### 5.2 Réseau : comment il rejoint le NAS sans route vers Internet

Le modèle actuel : `core` et `sortie` sont internes, seul `sortie` (Squid) atteint l'extérieur, chaque conteneur
n'obtient que sa liste fermée. Le conteneur `sauvegarde` s'y range ainsi :

- réseaux `core` (pour joindre `db`) et `sortie`, adresse fixe `10.201.2.13` ; **aucun** réseau non interne ;
- SSH vers le NAS passe par Squid en `CONNECT` (`ProxyCommand nc -X connect -x sortie:3128 %h %p`) ;
- `squid.conf` gagne une seule règle, placée avant les refus généraux : depuis `10.201.2.13`, `CONNECT` vers
  l'adresse du NAS, port 22 (ou le port SSH réel du NAS, **à vérifier**), rien d'autre. Les autres conteneurs restent
  limités au port 443 et à leurs domaines ; `sauvegarde` n'obtient aucun domaine Internet ;
- l'adresse du NAS vient de `NAS_ADRESSE` dans le `.env` (pas de l'image publique) : le point d'entrée de `sortie`
  génère la règle dans `/tmp` au démarrage (mécanisme exact à trancher dans le plan).

Ce que cela garantit : une faille du conteneur de sauvegarde ne peut joindre que le port SSH du NAS, et ne peut s'y
authentifier que comme l'utilisateur limité. Le journal de Squid trace chaque connexion (date, client, destination,
statut), sans contenu.

Option écartée : un réseau Docker non interne dédié, filtré par une règle `DOCKER-USER` sur l'hôte. Plus direct, mais
la règle vivrait hors de la stack et hors de Dockge, et une erreur de règle ouvrirait Internet au conteneur.

### 5.3 Déroulé d'un passage

Chaque nuit à `SAUVEGARDE_HEURE` (3 h proposé : avant la rotation de l'audio à 4 h, dans la fenêtre à confirmer) :

1. **Base** : `pg_dump -Fc` par le rôle `sauvegarde`, chiffré à la volée par age vers `sauvegarde_travail`
   (jamais en clair sur disque), avec l'inventaire chiffré.
2. **Audio** : liste des fichiers du volume absents de l'index local ; chiffrement par lots de 1 Go au plus dans
   `sauvegarde_travail`, envoi de chaque lot (`rsync --ignore-existing`), puis ajout à l'index local, puis vidage.
3. **Manifeste et index du jour**, signés, envoyés en dernier : un manifeste présent atteste un passage complet.
4. **Contrôles** : l'index local couvre **tous** les fichiers `prive/` du volume ; la liste distante (`rsync --list-only`)
   contient tous les fichiers de l'index (noms et tailles) ; sinon le passage est en échec.
5. **État** : `sauvegarde_etat/etat.json` reçoit la date de fin, le résultat, l'étape fautive et une raison technique
   (jamais de contenu, jamais de nom de fichier audio).

Le dump précède l'audio : chaque fichier référencé par le dump existe déjà sur le volume au moment de l'envoi (l'audio
est écrit avant la ligne qui le référence). Un passage interrompu se reprend au passage suivant sans doublon : l'index
local n'est complété qu'après un envoi réussi, et `--ignore-existing` absorbe un renvoi. Si l'index local est perdu,
le passage suivant rechiffre tout, et le NAS ignore ce qu'il a déjà.

Premier passage : jusqu'à 40 Go d'audio. Entre deux VM du même hôte Proxmox, quelques dizaines de minutes ; sur un lien
plus lent, plusieurs heures (**débit à vérifier**). Un plafond `--bwlimit` est prévu si la fenêtre de nuit l'exige.

Budget disque (décision 12, 50 Go) : la zone de transit monte la nuit jusqu'à la taille du dump chiffré plus un lot
d'audio (environ 2 Go à un an), puis revient à zéro. Avec un audio à 40 Go et une base sous 5 Go, la marge reste
d'environ 3 Go ; c'est serré, et la veille surveille déjà ces deux tailles.

## 6. Conservation

### 6.1 Politique

Portée par les instantanés du NAS, pas par la VM (qui n'efface rien) :

| Niveau | Conservation | Ce qu'il contient |
| --- | --- | --- |
| Quotidien | 7 derniers jours | Dump de chaque nuit, état de l'audio |
| Hebdomadaire | 4 dernières semaines | idem |
| Mensuel | 12 derniers mois | idem |
| Immuable (si disponible) | 14 jours | Les instantanés quotidiens récents, ineffaçables |

Option à trancher : un instantané annuel conservé quelques années (protège un audio privé écrasé sans qu'on le voie
pendant plus d'un an, section 10).

### 6.2 Estimation de l'espace

| Élément | Hypothèse | Année 1 | Année 3 |
| --- | --- | --- | --- |
| Dumps | Base de 2 à 5 Go à un an (cahier) ; un dump `-Fc` compressé est nettement plus petit, de l'ordre de 0,3 à 1 Go (**à mesurer**). Chaque instantané garde un dump distinct : 23 au plus | 7 à 23 Go | 10 à 35 Go |
| Audio | Courant (40 Go au plus) plus l'audio ordinaire purgé par la rotation, conservé (6.3) : 20 à 45 Go par an | 20 à 45 Go | 60 à 135 Go |
| Surcoût du chiffrement | 16 octets par bloc de 64 Kio, plus un en-tête | négligeable | négligeable |
| **Total** | | **environ 30 à 70 Go** | **environ 70 à 170 Go** |

Espace libre du NAS : **à vérifier**. La veille ne voit pas le NAS : si l'espace manque, `rsync` échoue et la sauvegarde
alerte (section 7).

### 6.3 Audio purgé par la rotation

La VM ne supprime rien sur le NAS : un audio ordinaire purgé par la rotation (transcription conservée) reste dans la
sauvegarde. Deux choix possibles, **à trancher par Franck** :

- **Par défaut proposé : le garder.** Rien à construire ; le NAS grossit de 20 à 45 Go par an. Une restauration ne
  remet sur le volume que les fichiers encore référencés par la base (`audio_path` non nul), pour tenir les 50 Go.
- **Élaguer côté NAS** : la VM dépose la liste des chemins `ordinaire/` purgés ; une tâche planifiée du NAS les retire
  du dossier courant (jamais un chemin `prive/`, refusé par le script). Ils restent dans les instantanés jusqu'à leur
  échéance. Un script de plus à installer dans DSM.

## 7. Supervision

Principe du cahier : le système alerte l'administrateur, jamais l'utilisatrice. L'API reste le **seul** émetteur de
messages Telegram : le conteneur de sauvegarde ne parle à personne, il écrit son état.

- **État partagé** : le volume `sauvegarde_etat` est monté en écriture dans `sauvegarde`, en **lecture seule** dans
  `api`. Le fichier `etat.json` porte la date de la dernière réussite et celle du dernier échec, avec l'étape et une
  raison technique.
- **Veille de l'API** (toutes les 15 minutes, une alerte par constat, `apps/api/src/veille/`) : deux constats nouveaux.

| Message (administrateur seul) | Seuil | Que faire |
| --- | --- | --- |
| « Sauvegarde en échec à l'étape <étape> : <raison>. » | Dernier passage en échec | Journal du conteneur `sauvegarde` ; NAS joignable, espace libre, clé SSH |
| « Aucune sauvegarde réussie depuis N h. » | Plus de 26 h depuis la dernière réussite, ou aucune réussite connue 26 h après le démarrage | Conteneur arrêté, planification, ou échecs répétés |

  Le seuil de 26 h laisse deux heures de marge à un passage quotidien lent. Le second constat couvre le cas où le
  conteneur ne tourne plus du tout et ne peut donc rien écrire.
- **Commande `veille`** : affiche aussi la date de la dernière réussite et la taille envoyée.
- **Ce qui n'est pas couvert** : si l'API elle-même est arrêtée, aucune alerte ne part (limite déjà vraie pour toute la
  veille). Option ultérieure : un moniteur « push » d'Uptime Kuma (le conteneur 106 du homelab), que le conteneur de
  sauvegarde appelle après chaque réussite ; Kuma alerte seul s'il n'a rien reçu depuis 26 h. Il faudrait ouvrir dans
  Squid l'adresse de Kuma, en HTTPS ou HTTP local selon sa publication (**à vérifier**). Le dossier de revue du lot 1-C
  note qu'Uptime Kuma n'était pas encore branché sur Organizer au 4 octobre.
- **Rappel du test annuel** : la clé privée n'étant jamais sur le serveur, aucun test de déchiffrement automatique n'est
  possible. Le rappel annuel est un événement dans l'agenda personnel de Franck, hors de l'application (rien côté L).

## 8. Installation, une fois

Pour mémoire ; le détail ira dans le plan et dans `docs/exploitation.md` :

1. Sur le Mac : `age-keygen`, clé privée au gestionnaire de mots de passe et sur papier, clé publique vers le `.env`.
2. Sur le NAS : dossier partagé, utilisateur dédié, service rsync, clé SSH publique de la VM, Snapshot Replication avec
   la politique de la section 6, immuabilité si disponible, nettoyage des données planifié.
3. Sur la VM : secrets `sauvegarde_ssh`, `sauvegarde_signature`, `sauvegarde_pg` ; rôle PostgreSQL `sauvegarde` ;
   variables `.env` ; nouveau `compose.yaml`.
4. Premier passage déclenché à la main (commande du conteneur), puis contrôle de l'état et de la veille.
5. Test de restauration complète (section 9.1), chronométré : c'est le critère de livraison du sous-lot.

## 9. Restauration

Toutes les commandes exactes iront dans `docs/exploitation.md` et dans deux scripts du dépôt (`restaurer-base`,
`restaurer-audio`), exercés par le test de livraison. Règle commune : le clair n'existe que le temps de la restauration,
dans un dossier `700`, et il est effacé ensuite.

### 9.1 Restauration complète sur une stack neuve

Cas : VM 105 perdue, disque mort, volumes détruits. Prérequis : la clé privée age et la clé publique de signature
(gestionnaire de mots de passe), un compte d'administration du NAS, les secrets et le `.env` (gestionnaire), une VM
Docker (neuve ou restaurée par Proxmox).

1. **Choisir le point de restauration** : le dossier courant du NAS, ou un instantané si le courant est suspect.
   Lire `manifeste.json`, vérifier sa signature, noter `ORGANIZER_VERSION`.
2. **Préparer la stack** à cette version exacte : `compose.yaml` depuis l'étiquette, `.env` et `secrets/` depuis le
   gestionnaire (régénérer ce qui manque, section 2.2). **Ne pas poser le webhook Telegram.**
3. **Récupérer** le dossier du NAS sur la VM (`rsync` depuis le compte d'administration, ou montage de l'instantané en
   lecture seule). Vérifier chaque empreinte contre les index signés.
4. **Base** : démarrer `db` seul ; `age -d` du dump vers `pg_restore --no-owner -d organizer` (en flux, sans clair sur
   disque) ; comparer les comptes à `inventaire.json.age`.
5. **Audio** : déchiffrer dans `organizer_audio` (propriétaire 1000), uniquement les fichiers que la base référence
   encore ; vérifier que **chaque** capture privée de la base a son fichier.
6. **Démarrer** toute la stack (`up -d --wait`) ; `migrate` ne fait rien si la version est la même.
7. **Rouvrir** : `telegram-webhook poser`. Telegram livre alors les vocaux reçus pendant la panne (il les garde
   24 heures) ; la file hors ligne de la PWA renvoie les captures privées restées sur le téléphone. Le worker ré-enfile
   seul ce qui n'était pas classé, le scheduler resynchronise l'agenda (identifiants d'événements déterministes, pas de
   doublon).
8. **Contrôler** : `/api/sante`, `veille`, une capture de test, la réécoute d'un audio de Franck.
9. **Reprendre la sauvegarde** : si la VM d'origine a pu être compromise, remplacer la clé SSH de la VM chez le NAS et la
   clé de signature avant le premier passage.

Ce qui est perdu, au pire : les captures reçues après le dernier passage réussi et que ni Telegram (plus de 24 heures),
ni le téléphone (file hors ligne) n'ont gardées. C'est le RPO de 24 heures.

### 9.2 Restaurer l'audio d'une seule capture

Cas : un fichier audio manquant ou illisible, la base est saine.

1. Trouver le chemin : `audio_path` de la capture (identifiant connu, ou date et heure pour une capture privée).
   Si `audio_path` est nul, l'audio a été purgé volontairement par la rotation : on ne le remet pas, sauf demande.
2. Récupérer `audio/<chemin>.age` du dossier courant du NAS, ou d'un instantané s'il a été altéré depuis.
3. Vérifier son empreinte contre l'index du jour où il a été déposé.
4. `age -d` vers le volume, au même chemin, propriétaire 1000. Rien à redémarrer.

### 9.3 Ce que « RTO 4 heures » veut dire

Le chronomètre part de la décision de restaurer et s'arrête quand L peut capter par Telegram et par la PWA et retrouve
ses listes. Budget indicatif, à remplacer par les durées mesurées au test de livraison :

| Étape | Durée |
| --- | --- |
| VM Docker prête (neuve ou restaurée) | 60 min (**à vérifier** : modèle de VM ou sauvegarde Proxmox disponible) |
| Stack, `.env`, secrets, régénération éventuelle | 30 min |
| Rapatriement depuis le NAS (40 Go) | 15 à 60 min selon le débit (**à vérifier**) |
| Base : déchiffrement et `pg_restore` | 15 min |
| Audio : déchiffrement | 15 à 30 min |
| Démarrage, webhook, contrôles | 20 min |
| **Total** | **environ 2 h 30 à 3 h 30** |

Si le rapatriement de l'audio menace le délai, la base passe d'abord : L retrouve tout son texte et peut capter ; seule
la réécoute attend la fin de l'audio. L'audio privé, seule trace de ses captures privées, est restauré **en premier**
parmi l'audio.

### 9.4 Le test, à la livraison puis chaque année

- Sur une machine **séparée** de la production (VM temporaire du homelab de préférence, **à décider par Franck**) :
  restaurer 40 Go d'audio à côté de la production sur la VM 105 dépasserait le plafond de 50 Go.
- Stack de test isolée comme l'essai de fumée (`infra/image/essai.sh`) : autre nom de projet, adresses `10.211.x`,
  **secrets factices**. Ainsi l'API ne peut pas écrire à L par Telegram, le scheduler ne peut pas toucher son Google
  Agenda, rien ne part vers Gemini : le test est invisible pour L.
- Déroulé complet de 9.1 (sauf l'étape 7), chronométré ; plus 9.2 sur un fichier privé tiré au hasard.
- Critères : signature et empreintes valides ; comptes égaux à l'inventaire ; chaque capture privée a son audio, et
  un échantillon se lit ; durée totale sous 4 heures. Compte rendu daté (sans contenu) dans `docs/exploitation.md`.
- Destruction de la stack de test, de ses volumes et du clair à la fin.

## 10. Risques

| Risque | Impact | Parade |
| --- | --- | --- |
| Perte de la clé privée age | Toutes les sauvegardes illisibles | Gestionnaire de mots de passe **et** copie papier hors ligne ; second destinataire optionnel ; le test annuel prouve que la clé est retrouvable |
| VM compromise | Écrasement du dump courant, fichiers parasites | Instantanés hors de portée de l'utilisateur de sauvegarde, immuables si possible ; manifeste signé ; la VM n'a aucun identifiant d'administrateur du NAS |
| Audio privé écrasé sans que personne le voie, au-delà de la conservation | Seule trace perdue | Empreintes vérifiées à chaque passage sur la liste distante (noms et tailles) ; instantané annuel en option ; test annuel |
| NAS indisponible ou plein | Pas de sauvegarde | Alerte d'échec, puis alerte à 26 h ; reprise automatique au passage suivant |
| API arrêtée | Pas d'alerte de sauvegarde | Uptime Kuma sur `/api/sante` ; moniteur push en option |
| NAS non sauvegardé ailleurs (incendie, vol, panne de l'hôte Proxmox qui porte aussi la VM 103) | Perte de la production et de la sauvegarde en même temps | Hors périmètre ; question posée à Franck (copie hors site par Hyper Backup des fichiers déjà chiffrés) |
| Le NAS est une VM du même hôte Proxmox que la VM 105 | Une panne de l'hôte emporte les deux | Même parade ; à garder en tête pour le RTO (**à vérifier** : hôte des VM 103 et 105) |
| Zone de transit qui fait dépasser 50 Go | Disque de la stack saturé la nuit | Lots de 1 Go ; dump chiffré en flux ; veille sur l'audio et la base |
| Version de `pg_dump` plus ancienne que le serveur | Dump refusé ou incomplet | Client 17 épinglé dans l'image, essai de fumée qui fait un vrai dump |
| Restauration vers une autre version d'Organizer | Migrations incohérentes | Version notée au manifeste ; restauration à la version exacte, puis mise à jour ordinaire |
| Squid ouvert au port SSH | Surface élargie | Une seule source (`10.201.2.13`), une seule destination, un seul port ; les autres règles inchangées |

## 11. Hors périmètre

- Sauvegarde du NAS lui-même, hors site ou dans le nuage (question pour Franck).
- Restauration en libre-service, écran d'administration, notification à L : jamais.
- Point de reprise plus fin que la nuit (archivage continu des journaux PostgreSQL, audio horaire) : le RPO de 24 heures
  suffit ; un envoi horaire de l'audio privé seul reste possible plus tard, mais créerait des fichiers sans ligne en
  base à la restauration.
- Sauvegarde de Valkey, des images, des journaux techniques.
- Test de restauration automatique : impossible sans la clé privée sur le serveur, et c'est voulu.
- Chiffrement des noms de fichiers sur le NAS.
- Rotation de l'audio : sous-lot distinct ; cette spécification suppose seulement qu'elle ne touche jamais `prive/`.

## 12. Répercussions documentaires à l'adoption

À faire dans le même commit que l'adoption (plan ou implémentation), pour garder `docs/decisions.md`, le cahier et
`CLAUDE.md` cohérents :

- Cahier, Chiffrement et Sauvegarde : « GPG » devient « age », clé publique seule sur la VM.
- Cahier, Services, Réseaux, Volumes persistants : service `sauvegarde`, sa règle Squid (NAS, port SSH), volumes
  `sauvegarde_etat` et `sauvegarde_travail`, colonne « Sauvegarde » des volumes renseignée.
- Cahier, Supervision : les deux constats de la section 7.
- `docs/exploitation.md` : « Sauvegarde et restauration » réécrit (installation, procédures 9.1 et 9.2, test annuel),
  nouvelles alertes, nouveaux secrets.
- Décision 11 : inchangée dans son principe ; sa colonne peut préciser « age, rsync vers le NAS, instantanés côté NAS ».

## 13. Points à vérifier (sans accès au homelab)

- Modèle émulé et version de DSM de la VM 103 ; volume en Btrfs ; Snapshot Replication installable ; instantanés
  immuables disponibles sous Xpenology.
- Connexion SSH et rsync d'un utilisateur DSM non administrateur ; prise en compte de `authorized_keys` et de ses
  restrictions ; port SSH réel du NAS.
- Masquage de `#snapshot` pour cet utilisateur.
- ACL DSM « créer sans supprimer » compatible avec rsync.
- Espace libre du NAS ; nettoyage des données planifié.
- Débit entre la VM 105 et la VM 103 ; même hôte Proxmox ou non.
- Taille réelle d'un dump `-Fc` de la base actuelle.
- Délai de mise à disposition d'une VM Docker neuve (modèle Proxmox, sauvegarde de la VM).
- Publication d'Uptime Kuma (conteneur 106) et faisabilité d'un moniteur push depuis la stack.

## 14. Questions pour Franck

1. **NAS** : quel modèle Synology émulé et quelle version de DSM sur la VM 103 ? Le volume est-il en Btrfs ?
2. **Espace** : combien d'espace libre sur le NAS, et combien es-tu prêt à donner à Organizer (estimation : 30 à 70 Go
   la première année, jusqu'à 170 Go à trois ans) ?
3. **Existant** : as-tu déjà un utilisateur ou un dossier partagé dédié aux sauvegardes, le service rsync, Snapshot
   Replication ? Préfères-tu en créer de nouveaux pour Organizer (proposé) ?
4. **Clé** : où gardes-tu la clé privée age : gestionnaire de mots de passe seul, ou aussi une copie papier (où) ?
   Veux-tu un second destinataire (seconde clé gardée ailleurs) ?
5. **Fenêtre** : 3 h du matin te convient-il ? Un plafond de débit est-il nécessaire (autres sauvegardes la nuit sur
   le NAS, lien partagé) ?
6. **Hors site** : le NAS est-il lui-même copié ailleurs (Hyper Backup vers un disque externe ou un nuage) ? Les VM 103
   et 105 sont-elles sur le même hôte Proxmox ?
7. **Uptime Kuma** : veux-tu le moniteur push en plus de la veille de l'API, dès ce sous-lot ou plus tard ?
8. **Audio purgé par la rotation** : le garder indéfiniment sur le NAS (proposé), ou l'élaguer côté NAS après 12 mois ?
9. **Conservation** : 7 quotidiens, 4 hebdomadaires, 12 mensuels te conviennent-ils ? Ajoute-t-on un annuel ?
10. **Test de restauration** : sur quelle machine (VM temporaire du homelab proposée) ?
11. **Secrets** : confirmes-tu qu'ils restent uniquement dans le gestionnaire de mots de passe, sans copie dans la
    sauvegarde ?
