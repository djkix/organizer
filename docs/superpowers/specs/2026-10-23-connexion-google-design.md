# Connexion par compte Google — conception

23 octobre 2026 · djkix · décision 29 (nouvelle), version visée 1.13.0 (la 1.12.0 est prise par « Sauvegarder maintenant »)

## Intention

djkix et L veulent se connecter à la PWA avec leur compte Google, comme dans le projet Kitchen, au lieu de taper un nom et un mot de passe. Le besoin s'est vu sur ordinateur : l'écran de connexion n'offrait qu'un nom et un mot de passe, et rien ne rappelait le nom du compte. Google devient le geste principal ; le mot de passe et l'empreinte restent possibles.

## Décisions de djkix (23 octobre 2026)

- **Qui :** les deux comptes, djkix et L.
- **Comme Kitchen :** le bouton officiel de Google, vérifié côté serveur (voir « Ce qui vient de Kitchen »).
- **Le mot de passe et l'empreinte restent**, à côté de Google. Rien n'est retiré.
- **Écran retenu (maquette A) :** en bas de l'écran, comme aujourd'hui, dans cet ordre :
  1. le titre « Organizer » ;
  2. le bouton Google « Continuer avec Google » ;
  3. « Me connecter avec l'empreinte », seulement si ce téléphone a une empreinte mémorisée (comportement actuel) ;
  4. un lien « Me connecter avec un mot de passe », qui déplie le nom, le mot de passe et « Me connecter ».

  Le bouton cadenas de l'enregistreur privé reste en bas à droite, accessible sans connexion.

## Ce qui vient de Kitchen

Kitchen (`docs/specs/2026-10-18-connexion-google.md` de ce projet) fait ainsi, et Organizer reprend le même schéma :

- **Le bouton :** Google Identity Services, bouton rendu (`renderButton`), en français, texte « Continuer avec Google », largeur adaptée à l'écran. Pas de One Tap, pas de redirection OAuth, pas de secret client côté navigateur.
- **L'échange :** le navigateur reçoit un jeton d'identité (ID token) et l'envoie au serveur, qui le vérifie (signature par les certificats de Google, émetteur, expiration, audience = identifiant du client OAuth), puis exige `email_verified`.
- **L'identifiant au démarrage :** l'identifiant du client est servi par l'API, pas figé au build de la PWA.
- **La garde :** au premier passage, l'identifiant Google stable (`sub`) est mémorisé sur le compte ; ensuite, une adresse connue avec un autre `sub` est refusée.

## Ce qui diffère de Kitchen

- **Aucune inscription.** Kitchen crée un compte en attente pour toute adresse inconnue. Organizer n'a que deux comptes, créés en ligne de commande (« Aucune inscription libre »). Une adresse Gmail est reliée à un compte existant par une commande d'administration ; toute autre adresse est refusée. *Appel de Claude, présenté à djkix sans objection.*
- **Le mot de passe reste** (décision ci-dessus), et l'empreinte aussi.
- **Sécurité des pages :** Organizer envoie une CSP stricte (Caddy, `apps/web/scripts/entetes.mjs`) ; il faut y autoriser Google Identity Services. Kitchen n'en avait pas.
- **Politique de référent (décidé par djkix le 23 octobre 2026) :** `Referrer-Policy` passe de `no-referrer` à `strict-origin-when-cross-origin`, **pour toute l'application** : Google Identity Services refuse de fonctionner sans connaître l'origine. Vers un autre site, seule l'origine part, jamais le chemin. La coquille étant une SPA servie par un seul `index.html` et gardée par le service worker, ni cette politique ni la CSP élargie ne peuvent être réservées à `/connexion`. Les deux endroits qui posent l'en-tête (bloc `header` du Caddyfile et `entetesCoquille` de `entetes.mjs`) et la table « Exposition et surface d'attaque » du cahier sont mis à jour.
- **Sorties de l'API :** l'API ne joint aujourd'hui que Telegram et FCM, par le proxy `sortie`. La vérification du jeton télécharge les certificats publics de Google : `www.googleapis.com` est ajouté à la liste fermée de l'`api` (le `scheduler` y a déjà accès).
- **Le client OAuth :** Organizer en a déjà un, de type « Application Web », pour Google Agenda (`GOOGLE_CLIENT_ID`, déjà fourni à l'API). Il est réutilisé : on y déclare l'origine JavaScript de la PWA (`https://<DOMAINE_APP>`). Aucune nouvelle variable obligatoire. *Appel de Claude.*

## Objectifs

1. Un bouton « Continuer avec Google » sur l'écran de connexion, qui ouvre la même session que le mot de passe (cookie de 90 jours).
2. Une commande d'administration pour relier une adresse Gmail à un compte, et une pour la délier.
3. Toute adresse non reliée, non vérifiée par Google, ou dont le `sub` ne correspond plus, est refusée sans dire pourquoi.
4. Le mot de passe et l'empreinte marchent exactement comme avant.

## Non-objectifs

- Inscription par Google, compte en attente, validation par l'admin.
- One Tap et connexion automatique. FedCM n'est pas exclu en tant que mécanisme : si Google Identity Services fait passer le bouton par FedCM dans Chrome, on l'accepte et on ajoute ce qu'il demande (`Permissions-Policy`, CSP). *Appel de Claude.*
- Retrait du mot de passe ou de l'empreinte.
- Connexion Google pour Telegram ou pour l'enregistreur privé.
- Écran d'administration des liaisons dans Réglages (la ligne de commande suffit pour deux comptes).

## Anti-objectifs

- **Aucune étape avant un enregistrement.** L'enregistreur privé et sa file ne demandent ni Google ni connexion ; le cadenas reste sur l'écran de connexion.
- **Rien ne fuit dans le dépôt public :** ni adresse Gmail, ni identifiant client, ni `sub`. Les adresses vivent seulement en base.
- **Rien ne fuit dans les journaux :** ni jeton, ni adresse, ni `sub`.
- **L'écran ne révèle pas les comptes :** même message pour une adresse inconnue, non vérifiée ou au `sub` changé.
- **Pas de rouge**, messages en français, tutoiement, moins de 12 mots.

## Comportement

### Écran de connexion

- Le script Google est chargé à l'ouverture de l'écran de connexion seulement.
- Si le script ne se charge pas (hors ligne, Google injoignable) ou si l'API n'annonce aucun identifiant client, le bouton Google ne s'affiche pas et le lien du mot de passe est déplié d'office. Un message court le dit. *Appel de Claude.*
- Le message « Il partira après ta connexion. » (capture privée en attente) reste affiché comme aujourd'hui.
- Après une connexion par Google réussie, la PWA se comporte comme après un mot de passe : retour à la page demandée, envoi des captures en attente.

### Côté serveur

- Nouvelle route publique de connexion par Google, sous `/api/session` comme les autres connexions, plafonnée par le limiteur d'authentification existant (10 par minute).
- Vérification du jeton : signature, émetteur Google, expiration, audience = `GOOGLE_CLIENT_ID`, `email_verified` vrai. Adresse comparée en minuscules.
- Compte trouvé par l'adresse reliée. Premier passage : le `sub` est mémorisé. Passages suivants : `sub` identique exigé.
- Refus : 401 avec un message unique, par exemple « Ce compte Google n'est pas reconnu. » (moins de 12 mots).
- Succès : même session et même cookie que la connexion par mot de passe.

### Administration

- `cli lier-google <nom> <adresse>` : relie l'adresse (minuscules) au compte ; remet le `sub` à vide. Refuse une adresse déjà reliée à un autre compte.
- `cli delier-google <nom>` : retire l'adresse et le `sub` ; révoque les sessions ouvertes par Google n'est pas exigé (les sessions sont communes).
- `cli veille` ou une autre commande existante n'affiche jamais les adresses.

### Données

- Le compte (`utilisateur`) gagne une adresse Google (unique, facultative) et un `sub` Google (unique, facultatif). Migration additive.

## Documents à mettre à jour, dans le même commit

- `docs/decisions.md` : décision 29, « Connexion par Google » (les deux comptes, bouton Google en tête, mot de passe et empreinte conservés, adresse reliée par commande, aucune inscription, `Referrer-Policy: strict-origin-when-cross-origin` pour toute l'application ; décidé par djkix le 23 octobre 2026).
- `docs/cahier-des-charges.md` : table Authentification, table des domaines de sortie (`api` : `www.googleapis.com`), dépendances externes, écran de connexion, table « Exposition et surface d'attaque » (en-têtes).
- `CLAUDE.md` : état du projet.
- `docs/exploitation.md` : déclarer l'origine JavaScript dans la console Google Cloud (client OAuth existant), relier les deux adresses, dépannage (`origin_mismatch`, bouton absent).
- `README.md`, `CHANGELOG.md`.

## Mise en service

1. Dans la console Google Cloud, sur le client OAuth existant : ajouter l'origine JavaScript autorisée `https://<DOMAINE_APP>` (exacte, sans chemin ni barre finale).
2. Publier la 1.13.0, mettre à jour la stack (remplacer le compose si la liste de sortie de `squid.conf` change dans l'image `sortie`).
3. `cli lier-google` pour djkix et pour L, avec leurs adresses.
4. Essai sur ordinateur et sur le téléphone de L, PWA installée.

## Laissé au constructeur

- La bibliothèque de vérification (`google-auth-library` comme Kitchen, ou `jose` avec les certificats publics de Google), en gardant une interface substituable par un faux dans les tests.
- Le nom exact de la route et de la route qui sert l'identifiant client.
- Les directives CSP exactes demandées par Google Identity Services (elles valent pour toute l'application, voir « Politique de référent »).
- Le libellé exact des messages, dans les règles de ton du projet.
- Le dépliage du formulaire de mot de passe (lien, animation ou non).
