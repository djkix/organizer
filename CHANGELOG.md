# Journal des modifications

Toutes les modifications notables de ce projet sont consignées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

## [Non publié]

### Ajouté
- Le service `scheduler` rejoint la stack (image `organizer-scheduler`, non root, racine en lecture seule, 256 Mo, réseaux `core` et `sortie`) ; Squid ne lui ouvre que `www.googleapis.com` et `oauth2.googleapis.com` ; nouvelle variable obligatoire `GOOGLE_CLIENT_ID`, nouveaux secrets `google_client_secret` et `agenda_cle` ; cinq images en CI ; l'essai de fumée éprouve la sortie du scheduler ; l'exploitation documente Google Agenda et ses alertes (2026-10-05).
- La PWA porte l'interrupteur « Alarme 10 minutes avant » sur un rendez-vous daté, et une section Google Agenda dans Réglages : connecter (écran de Google), état après le retour, refus ou accès décoché dits calmement, déconnecter sans rien effacer dans Google ; e2e sur API simulée (2026-10-05).
- Après le classement, chaque rendez-vous daté part vers l'agenda ; sur une capture Telegram, le bot propose « Avec alarme » dans un message silencieux en réponse au vocal, une seule fois, seulement si l'agenda est connecté, la capture fraîche et le rendez-vous à venir ; l'appui réécrit le message (« Sans alarme » pour revenir) ; le webhook reçoit les `callback_query` (rejouer `telegram-webhook poser`) (2026-10-05).
- L'alarme item par item dans l'API (`PATCH /api/items/:id { alarme }`), refusée hors rendez-vous daté, historisée, retirée quand l'échéance perd son heure ou que l'item cesse d'être une action ; chaque cochage, décochage ou correction prévient le scheduler (15 s après un cochage), sans jamais faire échouer le geste (2026-10-05).
- Le parcours OAuth de Google Agenda dans l'API, sans jamais joindre Google : adresse de consentement (portée `calendar.app.created` seule, état et PKCE S256 dans Valkey, 10 minutes, usage unique), retour sur `/api/agenda/retour` lié à la session, code confié au scheduler, état et déconnexion pour Réglages ; la stack et la documentation d'exploitation exigent `GOOGLE_CLIENT_ID` pour l'API (2026-10-05).
- La file `agenda` du scheduler (une instance, concurrence 1) : synchronisation, échange, déconnexion et balayage toutes les 10 minutes (planificateur répétable idempotent), données de chaque job validées, clients Google passés par la sortie contrôlée ; un refus de débit de Google met la file en pause 15 minutes avec une seule alerte par épisode ; autorisation retirée, agenda supprimé, client refusé, révocation impossible et échecs répétés alertent l'administrateur seul, une fois par constat ; arrêt propre sur SIGTERM ; sonde `agenda` (2026-10-05).
- La connexion à Google Agenda côté scheduler : échange du code avec PKCE, données du job validées, portée vérifiée (refus calme si L décoche l'agenda), agenda « Organizer » créé ou repris, jeton chiffré ; une panne après l'échange du code révoque le jeton et note l'échec sans reprise ; la déconnexion révoque et efface le jeton, l'agenda reste ; un balayage par lots n'enfile que les actions divergentes et entretient le jeton chaque semaine (2026-10-05).
- La synchronisation d'une action avec son événement Google : création, remplacement, suppression au cochage dans l'agenda propre à l'événement, identifiant déterministe et génération suivante après une suppression, rien de recréé tant que l'action ne change pas, nouveau jeton sur un 401, autorisation retirée ou agenda supprimé notés en base ; le travail de file classe les échecs (réessayables ou définitifs) et prévoit l'alerte à l'administrateur (2026-10-05).
- Le contenu d'un événement (titre court, 30 minutes, fuseau de Paris, rappel de 10 minutes seulement avec l'alarme, jamais de description ni de pensée) et le plan de synchronisation sans appel à Google ; changements d'heure testés (2026-10-05).
- Les clients Google du scheduler, sans bibliothèque Google : OAuth (échange PKCE, rafraîchissement, révocation) et Calendar v3 (agenda dédié, événements), erreurs classées sans jeton ni texte de Google ; faux serveur Google pour les tests (2026-10-05).
- Le service `scheduler` (squelette) : configuration Google exigée en production, jeton de rafraîchissement chiffré en AES-256-GCM lié au compte, sonde de sortie, paquet esbuild vérifié ; l'image installe ses dépendances et `.env.example` reprend les noms lus (2026-10-05).
- Les contrats partagés de l'agenda : files `agenda` et `propositions`, jobs, délai de 15 s après un cochage, état de la connexion pour la PWA, alarme dans une correction, portée Google définie une fois, titre court et date en clair (2026-10-05).
- La connexion d'un compte à Google Agenda (état, jeton de rafraîchissement chiffré, agenda dédié) et l'événement de chaque action (identifiant, agenda, empreinte, génération), en migration additive (2026-10-05).
- Le plan du lot 2-A : Google Agenda par un service `scheduler` seul à joindre Google (OAuth porté par L, portée `calendar.app.created`, jeton chiffré), rendez-vous datés sans rappel par défaut, alarme item par item (voix, bouton du bot, interrupteur de la PWA), publication en 1.2.0 (2026-10-05).

### Modifié
- Le cahier précise le pont Google Agenda (identifiant déterministe, durée, contenu, scheduler seul à joindre Google, proposition du bot) et découpe le lot 2 ; le lot 2-A livre l'agenda et l'alarme item par item (2026-10-05).

### Corrigé
- Les échecs de l'agenda se diagnostiquent : le journal du scheduler dit la classe, le statut et la raison de Google (jamais de corps, de jeton ni de texte d'action), et un échec définitif de connexion alerte l'administrateur une fois ; le bouton « Avec alarme » est toujours acquitté et une erreur n'est plus relancée (plus de relivraison qui bloquerait les vocaux), les anciens boutons sont acquittés sans rien faire (2026-10-05).
- La proposition d'alarme est marquée avant l'envoi (au plus une fois) et tient en moins de 12 mots ; l'alarme est refusée sur une capture privée ; une file muette après le retour de Google remet la connexion en échec, calmement ; la PWA ne suit que les adresses `accounts.google.com` et montre le refus court de l'API pour l'alarme (2026-10-05).
- La pause de 15 minutes de la file agenda dure vraiment 15 minutes (elle reprenait toutes les 30 secondes), un client Google refusé pendant une synchronisation alerte l'administrateur, et l'arrêt du scheduler ferme chaque ressource même si l'une échoue (2026-10-05).
- La connexion à l'agenda ne défait plus une déconnexion demandée pendant l'échange du code (jeton révoqué, agenda neuf retiré) ; un agenda créé puis non relié au compte est supprimé au lieu de laisser un doublon ; le balayage survit à une révocation dont le traitement échoue, et un jeton illisible laisse une trace sans détail (2026-10-05).
- Les tests du classement des échecs de synchronisation n'abîment plus le client de base partagé, et une action dont l'événement n'a pas de calendrier connu, une fois ses champs vidés, est signalée comme supprimée (2026-10-05).
- La synchronisation de l'agenda classe mieux ses échecs : autorisation retirée et agenda absent finissent sans erreur, seuls les refus définitifs de Google sont abandonnés, toute autre panne (base, réseau) est réessayée ; l'alerte à l'administrateur ne part qu'au changement d'état (2026-10-05).
- Les clients Google du scheduler distinguent les erreurs à réessayer (limite de débit, 5xx, réseau, délai) de celles qui ne le sont pas (403 de refus, 400 de requête invalide) ; les écritures d'agenda n'envoient aucune notification (2026-10-05).

## [1.1.0] - 2026-10-05

### Corrigé
- Sans mémo local (PWA réinstallée, données effacées), « Activer » répondait « déjà active » sans rendre la connexion par empreinte : le bouton de connexion revient, le vrai identifiant remplace le mémo à la première connexion. Réglages dit calmement un échec de chargement, retire une clé sans double envoi, annonce ses messages par une zone permanente ; le plafond de clés vient du paquet partagé ; le compteur d'une clé n'est mis à jour que s'il avance ; le retrait et la mise à jour vers la 1.1.0 sont documentés (retour à la 1.0.1 sans restauration, `DOMAINE_APP` avant `pull`) (2026-10-05).
- L'activation de l'empreinte : plafond de dix clés recompté sous verrou à l'enregistrement, journal sans le message de la bibliothèque (défi et origine du client), algorithmes imposés à la vérification, retrait d'un identifiant mal formé sans erreur (2026-10-05).

### Ajouté
- L'essai de fumée vérifie l'identifiant de RP de l'empreinte ; l'exploitation documente l'empreinte : domaine, téléphone perdu, mise à jour vers la 1.1.0 (`DOMAINE_APP=organizer.djkix.ovh` à ajouter au `.env`) et dépannage (2026-10-05).
- L'empreinte dans la PWA : « Activer l'empreinte », liste et retrait dans Réglages ; « Me connecter avec l'empreinte » sur l'écran de connexion, seulement si ce téléphone a une clé ; mot de passe toujours là ; bibliothèque chargée au toucher du bouton ; messages selon le contexte (connexion ou activation), 503 dit calmement ; e2e par l'authentificateur virtuel de Chromium (2026-10-05).
- Le client et la logique d'empreinte de la PWA (`@simplewebauthn/browser` 14) : invites injectées, messages calmes, clé de ce téléphone retenue sans rien de personnel (2026-10-05).
- La commande `retirer-empreintes <nom>` : retire toutes les empreintes d'un compte et ferme ses sessions, pour un téléphone perdu (2026-10-05).
- Les routes de l'empreinte : options et reconnexion sous `/api/session/empreinte`, activation, liste et retrait sous `/api/empreintes`, 10 essais par minute et par IP, 503 court si Valkey ne répond pas (2026-10-05).
- La reconnexion par empreinte dans l'API : défi à usage unique, origine et RP exacts, empreinte exigée, compte de la clé vérifié, compteur qui recule refusé ; la même session que le mot de passe (2026-10-05).
- L'activation d'une empreinte par WebAuthn (`@simplewebauthn/server` 14) : clé découvrable, empreinte exigée, sans attestation, défi lié au compte, dix clés au plus ; liste et retrait de ses clés (2026-10-05).
- Les défis de l'empreinte dans Valkey : usage unique, deux minutes, échec en 3 s si Valkey ne répond pas (2026-10-05).
- La configuration de l'empreinte : identifiant de RP et origine exacte, obligatoires en production, vérifiés au démarrage ; la stack les tire de `DOMAINE_APP`, nouvelle variable obligatoire du `.env` (2026-10-05).
- La table des clés d'accès WebAuthn (identifiant, clé publique, compteur, transports), effacée avec le compte (2026-10-05).
- Le plan du lot 1-D : reconnexion par empreinte digitale (WebAuthn) dans la PWA, décision 23 à poser en première tâche, publication en 1.1.0 (2026-10-05).

### Modifié
- La Permissions-Policy autorise explicitement l'empreinte (WebAuthn) à la seule origine de la PWA ; la CSP est inchangée (2026-10-05).
- L'empreinte digitale (WebAuthn) est avancée du lot 3 à un lot 1-D, livré juste après la mise en service (décision 23, 2026-10-05) ; cahier, CLAUDE.md et README alignés.

## [1.0.1] - 2026-10-05

### Corrigé
- Une bulle vidéo Telegram n'envoie plus que son son à Gemini, jamais l'image, même quand l'index du MP4 est en fin de fichier (2026-10-05).

### Modifié
- La stack de dev vit dans `/opt/stacks/organizer-dev`, pilotable par Dockge comme la production (2026-10-04).

## [1.0.0] - 2026-10-04

### Ajouté
- Le dossier de revue du lot 1-C (déploiement), pour un relecteur externe, avec l'état final de la CI et les choix de mise en service de Franck (2026-10-04).
- La documentation d'exploitation : stack, commandes, Nginx Proxy Manager, mise à jour, retour arrière, changement des secrets, supervision et sauvegarde manuelle (2026-10-04).
- Les images api, worker, web (Caddy, coquille et CSP du build) et sortie (Squid, liste fermée de domaines), et la CI GitHub Actions : tests avec base et file, e2e, construction et analyse des images (2026-10-04).
- L'API et le worker s'empaquettent avec esbuild en `dist/*.mjs`, dépendances externes vérifiées par un test ; Prisma devient une dépendance de production pour les migrations (2026-10-04).
- La CLI importe les captures du banc d'essai, sans doublon avec celles que Telegram relivre après la bascule, et les fait reclasser par le prompt de l'application (2026-10-04).
- La veille de l'API mesure toutes les 15 minutes la file, les échecs, la taille de l'audio et de la base, la latence et le silence, et alerte l'administrateur une fois par constat ; la CLI affiche les mesures et envoie une alerte d'essai (2026-10-04).
- Le worker traite les refus de Gemini pour quota, budget ou clé (429, 403) comme le crédit épuisé, borne chaque appel à 120 s, demande le niveau de réflexion configuré, et la sonde `sonde palier` affiche statut, palier et jetons sans aucun contenu (2026-10-04).
- L'API et le worker sortent par le proxy déclaré dans HTTPS_PROXY (fetch d'undici, agent pour grammY), le téléchargement Telegram est borné à 60 s et 20 Mio, et un audio trop gros passe en À revoir au lieu d'être retenté sans fin (2026-10-04).
- L'API démarre et sert la PWA même si Telegram est injoignable ; la CLI pose, retire et décrit le webhook (une connexion, secret, messages en attente gardés) et lie un compte à un chat sans code (2026-10-04).

### Modifié
- La stack publie `web` sur le port 7070 de la VM au lieu de 8080 (8080 est probablement déjà pris sur l'hôte partagé) ; Caddy écoute toujours sur 8080 dans le conteneur (2026-10-04).
- La mise en service est directe, sans attendre la sortie du lot 0 (décision 22, 2026-10-04) : prompt `tri/v1` en service, affiné à l'usage ; le corpus du lot 0 reste le jeu de test. CLAUDE.md, cahier, exploitation, plan et dossier de revue alignés.
- La stack de production : proxy sortant à liste fermée, API et worker sans route vers Internet, seul le port de Caddy publié, proxy de confiance et migrations obligatoires ; essai de fumée sur la topologie réelle en CI, publication des images sur GHCR à chaque étiquette de version (2026-10-04).
- Les images Docker seront publiées sur GHCR en public, et non en privé (2026-10-04).

### Sécurité
- Le motif des adresses brutes de Squid devient un ensemble POSIX valide (`^[]0-9.:[]+$`), testé avec grep -E ; la publication sur GHCR passe dans un job à part, seul à écrire des paquets, sur étiquette v* (2026-10-04).
- Les images api et worker n'embarquent plus npm ni corepack (CVE critique de tar) ; le proxy de sortie refuse les adresses IP brutes, résout les noms sans reverse DNS et journalise sans chemin d'URL ; `NPM_IP` est obligatoire dans la stack ; les actions de la CI sont épinglées par empreinte, avec délais et annulation des exécutions périmées (2026-10-04).
- La PWA est servie et testée sous une CSP stricte calculée à chaque build (empreinte du script de la coquille, aucun style en ligne), avec micro limité à l'origine, sans référent ni devinette de type (2026-10-04).
- L'API vérifie la session (et non la seule présence d'un cookie) avant de lire un envoi privé de 30 Mio, un cookie forgé reçoit 401 sans que le corps soit lu (2026-10-04).
- L'API plafonne ffmpeg à deux réencodages simultanés et quatre en attente (503 au-delà, la PWA réessaie), refuse un envoi privé sans cookie avant d'en lire le corps, et purge les sessions et codes de liaison expirés (2026-10-04).
- Une erreur inattendue ou un corps illisible ne recopie plus rien dans la réponse ni dans le journal, aucune réponse de l'API n'est mise en cache, et `GET /api/sante` sert de sonde de supervision (2026-10-04).
- En production, l'API refuse de démarrer sans proxy de confiance ou avec un chemin relatif, et n'interrompt plus une capture d'une heure au bout de 5 minutes ; taille et délai d'envoi des captures privées sont un contrat partagé entre la PWA et l'API (2026-10-04).
- Le réencodage des captures privées restreint ffmpeg aux protocoles et conteneurs attendus, retire les métadonnées du téléphone et plafonne la durée (2026-10-03).
- La connexion n'accorde plus créance à X-Forwarded-For que du proxy de confiance, un changement de mot de passe révoque les sessions, et la saisie du mot de passe est masquée et confirmée (2026-10-03).

### Corrigé
- Le webhook Telegram refuse (401) un secret absent ou faux avant d'initialiser le bot : plus d'appel à Telegram ni de 500 sur une requête forgée (2026-10-04).
- Les images web, sortie et base Node appliquent les correctifs Alpine et web passe à Caddy 2.11 (l'analyse Trivy bloquait), la CI analyse les quatre images avant d'échouer, le compose transmet `GEMINI_STATUTS_INDISPONIBLES`, la réflexion Gemini est vide par défaut, Squid plafonne ses descripteurs, `.superpowers` reste hors du contexte de build, et la documentation d'exploitation décrit le premier déploiement, l'import sans conflit d'adresse et des sauvegardes privées (2026-10-04).
- Le volume audio est inscriptible par l'API (dossier /data/audio créé pour l'utilisateur 1000 dans l'image) ; l'essai de fumée le vérifie, utilise une autre plage d'adresses que la production, affiche ses diagnostics si le démarrage échoue et nettoie sur Ctrl-C ; web range son état dans /tmp (2026-10-04).
- L'import des captures du banc d'essai liste les lignes écartées (numéro et identifiant, jamais le contenu) et les audios orphelins, sort en erreur s'il en reste, retire l'audio copié si la création échoue, et `--essai` calcule le bilan sans rien écrire ni enfiler (2026-10-04).
- Le worker signale par une ligne distincte et une alerte administrateur unique un refus 4xx de la configuration Gemini au démarrage (il réessaie sans planter), et les statuts d'indisponibilité de Gemini se règlent par `GEMINI_STATUTS_INDISPONIBLES` ; le niveau de réflexion est vide par défaut (2026-10-04).
- Le bouton « Prochaine capture privée » prévient quand il n'a pas pu s'activer et Telegram rejoue le message ; le démarrage de Telegram ne laisse plus d'écouteurs s'accumuler pendant une longue panne et ne lance pas le polling après l'arrêt ; `lier-chat` refuse les identifiants de groupe ; le commentaire du webhook ne promet plus l'ordre absolu (2026-10-04).
- La PWA ne marque plus l'audio indisponible après un play/pause rapide et nomme chaque lecteur par son heure, annonce « C'est noté. » après une date corrigée et ne lève plus sur une date illisible, rend le focus à la ligne suivante quand une ligne cochée quitte la liste, trie « En attente d'envoi » du plus récent au plus ancien, et le README dit quand une mise à jour s'applique (2026-10-04).
- La file privée garde le même identifiant entre l'envoi direct et « Réessayer », demande un nouvel essai au navigateur tant qu'il reste des captures (429 et 5xx compris), ne recharge jamais la page à une mise à jour, borne l'écriture locale à 10 s et ferme sa connexion pour une nouvelle version de la base ; l'enregistreur n'écoute pas si l'écran se verrouille pendant l'ouverture du micro (2026-10-04).
- Sur un réseau faible, la PWA affiche l'écran après 2,5 s au lieu de 15 s, retient l'état « hors ligne » le temps de la page et renvoie à la connexion si la session est partie ; l'écran de connexion garde le bouton violet vers l'enregistreur privé (2026-10-04).
- L'enregistreur privé s'arrête et garde à une heure, n'ouvre qu'un micro malgré un double appui, ne quitte pas l'écran tant que l'audio n'est gardé qu'en mémoire, nomme la panne du micro et garde ce qui est reçu si le navigateur ne dit pas « stop » (2026-10-04).
- Après une correction, le focus de la PWA revient à la ligne ou, si elle a quitté la liste, au titre de la page (2026-10-04).
- La file hors ligne des captures privées borne chaque envoi, relance un passage pour une capture arrivée pendant un vidage, s'arrête sur 429 et 5xx, met de côté sans jamais la supprimer une capture refusée définitivement, et ne double pas l'envoi entre page et service worker (2026-10-04).
- Le détail d'un item de la PWA gère le focus (entrée, retour, Échap, geste retour d'Android), rend le fond inerte et laisse « Annuler » visible au-dessus (2026-10-04).
- Les cochages et décochages de la PWA partent dans l'ordre des gestes, le bandeau « Fait. » est annoncé par TalkBack et l'écran À faire change de jour au retour de l'application (2026-10-04).
- La PWA n'affiche plus jamais un message brut du serveur, et chaque appel est borné à 15 secondes : un réseau muet donne « hors ligne », jamais « déconnecté » (2026-10-04).
- Le README demande ffmpeg avec libopus et précise que l'API lit `prompts/` au démarrage (2026-10-03).
- Le bouton « Prochaine capture privée » revient avec chaque accusé et avec /start pour un chat déjà lié (2026-10-03).
- L'historique d'une correction d'échéance garde l'expression d'origine du modèle (2026-10-03).
- À revoir ne dépasse plus vingt lignes en tout, les plus récentes d'abord (2026-10-03).
- Les erreurs des captures privées sont typées : une panne de base n'est plus prise pour un 404 ou un 400, la durée déclarée est strictement numérique et le mois par défaut suit le fuseau (2026-10-03).
- L'audio se sert depuis sa racine, même sous un dossier caché, et une correction d'échéance efface l'expression d'origine (2026-10-03).
- L'ordre des vues est stable à égalité, le libellé d'un horizon vient de la première expression connue, et À revoir exclut les items privés (2026-10-03).

### Ajouté
- Le plan du lot 1-C : déploiement sur le homelab et mise en service (2026-10-05).
- Le dossier de revue du lot 1-B2, à transmettre à un relecteur externe (2026-10-04).
- L'installation de la PWA sur Android : manifeste aux couleurs des tokens, icônes, raccourcis « Enregistrement privé » et « Aujourd'hui », service worker hors ligne avec synchronisation en arrière-plan, budget du bundle vérifié (2026-10-04).
- L'enregistreur privé de la PWA, utilisable hors ligne et sans session, et la vue Privé : par mois et par jour, lecteur audio, étiquette facultative (2026-10-04).
- La file hors ligne des captures privées de la PWA : copie locale d'abord, envoi idempotent par X-Capture-Id, relance au retour du réseau (2026-10-04).
- Le détail d'un item dans la PWA : réécoute, correction de la nature ou de l'échéance en deux gestes, et l'écran À revoir (2026-10-04).
- L'écran À faire de la PWA : Aujourd'hui, Semaine et Horizons, cochage d'un geste avec annulation pendant 10 s, sans compteur ni mention de retard (2026-10-04).
- La connexion à la PWA, la garde de session qui ne bloque jamais l'enregistreur privé, la navigation et la déconnexion dans Réglages (2026-10-04).
- La conversion d'une heure murale en instant, sûre aux changements d'heure, et les libellés de dates de la PWA (2026-10-04).
- Le socle de la PWA : SvelteKit 2 en mode statique, tokens de design, règles produit et contrastes vérifiés par des tests (2026-10-04).
- Le plan du lot 1-B2 : la PWA, ses écrans, l'enregistreur privé et la file hors ligne (2026-10-04).
- Le dossier de revue du lot 1-B1, à transmettre à un relecteur externe (2026-10-03).
- Le contrat des requêtes de la PWA dans le package partagé, l'indicateur d'audio des captures privées et le refus d'un `X-Capture-Id` invalide (2026-10-03).
- Le bouton « Prochaine capture privée » du bot : la capture suivante reste sur le serveur, sans transcription ni classement (2026-10-03).
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
