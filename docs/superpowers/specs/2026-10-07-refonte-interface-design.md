# Refonte de l'interface de la PWA — conception

Date : 2026-10-07. Version visée : 1.5.0. Statut : à relire par l'administrateur.

## Contexte et intention

L'administrateur n'est pas satisfait de l'apparence de la PWA. Il décide seul de la direction (l'utilisatrice principale
n'est pas consultée) et voulait choisir parmi plusieurs propositions. Exploration faite dans Stitch (direction
« Sérénité affinée », six écrans exportés), puis mise au propre dans une maquette Claude Design de sept écrans, validée
le 2026-10-07 : https://claude.ai/artifact/9CFZaw7oQPYcDq1GLChqK5 (privée ; la maquette fait foi pour l'apparence).

Le changement est d'abord un **habillage** : le fonctionnement, les routes et les données restent ceux de la 1.4.2, sauf
les trois écarts listés dans « Changements fonctionnels ».

## Critères de réussite

- Les écrans livrés ressemblent à la maquette (couleurs, typographie, formes, disposition), en clair et en sombre.
- Les exigences du cahier des charges tiennent toujours : contraste WCAG AA sur tous les textes, zones tactiles de
  44 px, actions principales dans le tiers bas, mode sombre suivant Android, texte de 16 px minimum, français seul.
- Les règles produit tiennent toujours : ni rouge ni orange, aucun compteur, aucune félicitation, aucune jauge, états vides
  neutres, repère Privé toujours visible.
- Aucune régression : tests unitaires, tests de contraste, règles produit et parcours Playwright passent.

## Périmètre

Dans le lot : tous les écrans de `apps/web` (Aujourd'hui, Semaine, Horizons, À revoir, détail d'une action, confirmation
d'effacement, enregistrement ordinaire et privé, Privé, Réglages, Connexion), les tokens de `design/`, la police, les
icônes de la navigation, et les trois changements fonctionnels ci-dessous.

Hors du lot (refusés ou reportés pendant l'exploration) :

- Écran de revue avant rangement (« Tout est en ordre », valider les actions proposées) : fonction nouvelle, à étudier à
  part si elle est voulue.
- Transcription en direct pendant l'enregistrement : impossible sans changer d'architecture (Gemini transcrit après envoi).
- Compteurs, bandeaux de résumé, jauges (« 78 % de respiration »), sous-titres inventés, images d'illustration.
- Toute mention fausse sur la confidentialité (« traitement local », « chiffré de bout en bout », « AES-256 ») : les
  captures ordinaires partent chez Gemini ; seules les captures privées restent sur le serveur.

## Direction visuelle

Une seule police : **Plus Jakarta Sans** (400, 500, 600, 700), **auto-hébergée** (paquet `@fontsource-variable/plus-jakarta-sans`, woff2 servis par la PWA ; la
CSP de Caddy ne doit pas s'ouvrir à Google Fonts), repli `system-ui, sans-serif`.

Formes : cartes à 14–16 px d'arrondi, filet de 1 px, pas d'ombre portée hors la très légère ombre de l'onglet actif ;
boutons d'action principaux de 64 px de haut, arrondi 18 px, liseré bas plus foncé (repris de la 1.4.0) ; pastilles à
8 px d'arrondi ; navigation basse avec pastille d'état actif autour de l'icône.

Tokens (remplacent ceux de `design/tokens.json` et `design/tokens.css` ; noms de variables CSS conservés quand le rôle est
le même, pour limiter les retouches) :

| Rôle | Clair | Sombre |
| --- | --- | --- |
| Fond | `#F6F8F9` | `#0F1416` |
| Surface (cartes, navigation) | `#FFFFFF` | `#182024` |
| Filet | `#DCE3E6` | `#2A3539` |
| Texte | `#172024` | `#E7EDEF` |
| Texte secondaire | `#4B575D` | `#A7B3B8` |
| Accent (boutons, case cochée, onglet actif) | `#00677D`, texte blanc | `#5FC3DD`, texte `#04262E` |
| Accent doux / encre | `#DDEFF4` / `#00515F` | `#12333B` / `#9ADDEE` |
| Piste des onglets | `#E8EDEF` | `#1D272B` |
| Bord de case à cocher | `#8C989E` | `#6F7D83` |
| Privé (bouton, repères) | `#5B4B8A`, texte blanc | `#A797D9`, texte `#1C1535` |
| Privé doux / encre | `#EEEAF6` / `#463874` | `#2A2440` / `#C9BDF0` |
| Fond de l'écran Privé | `#F7F6FA` | `#13111B` |

Pastilles d'échéance : heure (« 15:00 ») en accent doux avec encre ; « Dans la journée » en `#E8EDEF` / `#2E3A40`
(sombre `#232D31` / `#C9D3D7`) ; « Fenêtre » en vert de sauge `#E2EFEA` / `#1E5548` (sombre `#173229` / `#9FD8C4`) ;
« Alarme » : pastille au contour accent avec la cloche ; « Privé » et « À revoir » gardent leur rôle avec les couleurs
Privé et neutres. Le token `--alarm` ocre (`#B7791F`) disparaît : l'alarme se signale par la cloche, plus par une couleur
chaude.

Chaque paire texte/fond ci-dessus est vérifiée par `apps/web/test/contrastes.test.ts` (4,5 minimum pour le texte courant,
dans les deux thèmes) ; les valeurs exactes peuvent bouger d'un cran si un calcul échoue, jamais l'intention.

## Écrans

- **Aujourd'hui** (accueil) : titre et date ; trois onglets en piste segmentée (Aujourd'hui, Semaine, Horizons) ;
  actions en cartes (case à cocher de 44 px, texte, pastilles en dessous) ; boutons Enregistrer (2/3) et Privé (1/3) au-dessus de
  la navigation basse (À faire, Privé, Réglages). Glisser pour effacer, cochage, bandeau d'annulation : inchangés, restylés.
- **Semaine** : sous les onglets, une bande des sept jours (jour abrégé et numéro) ; le jour courant en accent plein, les
  jours qui ont des actions en carte, les autres en texte secondaire. Toucher un jour fait défiler jusqu'à son groupe
  (ancre). La liste est groupée par jour, ce que `VueSemaine` fournit déjà ; seuls les jours non vides ont un groupe.
- **Horizons** et **À revoir** : même traitement de cartes et de pastilles ; structure inchangée.
- **Détail d'une action** : retour ; titre ; carte « Quand » (échéance en clair, choix Sans date / Un jour / Jour et heure /
  Avant le) ; carte alarme (interrupteur « Alarme 10 minutes avant » et son aide) pour une action datée ; carte « Ce que tu as
  dit » avec la **transcription** entre guillemets et le lecteur audio ; « Rangé dans » si un thème existe ; en bas « Effacer » et
  « Ce n'est pas une chose à faire ».
- **Confirmation d'effacement** : même texte calme, restylée en feuille basse.
- **Enregistrement** (ordinaire) : fermer ; pastille micro ; « J'écoute », « Envoyé au tri. », consigne ; onde décorative
  animée tant que le micro capte ; minuteur ; bouton rond de 96 px avec carré blanc ; « Ce sera rangé tout seul. ».
- **Enregistrement privé** : même composition en violet, cadenas, « Ça reste à la maison. », « Rien n'est envoyé, rien n'est
  lu, rien n'est trié. ». Le repère privé reste visible dès la première image (exigence de la 1.4.0).
- **Privé** : titre « Privé », bandeau « Ces enregistrements ne sortent jamais de la maison. », navigation par mois, groupes
  par jour ; chaque ligne : bouton lecture violet, **le mot en titre** s'il existe, l'heure et la durée dessous, crayon pour le
  changer ; sans mot, lien « Ajouter un mot » ; en édition, champ de 80 caractères et bouton « Garder » ; captures en attente et
  notes écrites comme aujourd'hui ; bouton « Enregistrer en privé » en bas.
- **Réglages** et **Connexion** : restylés avec les mêmes composants (cartes, boutons, champs), contenu inchangé.

## Changements fonctionnels

1. **Transcription dans le détail.** Nouvelle route `GET /api/captures/:id/transcription` → `{ "texte": string | null }`,
   réservée au propriétaire (404 sinon, comme la décision 25), **404 pour une capture privée** (jamais transcrite), `texte`
   = `texte_brut`, sinon `texte_ecrit`, sinon `null`. La PWA l'appelle à l'ouverture du détail ; sans texte ou en cas
   d'échec, la carte n'affiche que le lecteur (comme en 1.4.2). Rien n'est ajouté aux listes (`LigneAction` inchangé) pour
   ne pas alourdir les vues. Les journaux ne contiennent jamais ce texte.
2. **Crayon sur le mot d'un enregistrement privé.** Même composant `Etiquette` et même route qu'aujourd'hui ; seul l'affichage
   change (mot en titre, crayon de 44 px pour l'éditer).
3. **Libellé « Jour » → « Dans la journée »** dans `apps/web/src/lib/pastilles.ts`.

## Accessibilité et règles

- Contrastes testés dans les deux thèmes, y compris boutons, pastilles, onglet actif, case cochée et lien « Ajouter un mot ».
- Zones tactiles de 44 px minimum (cases, crayon, lien « Ajouter un mot », jours de la bande de 64 px).
- `prefers-reduced-motion` : l'onde reste immobile.
- Navigation au clavier et focus visible conservés ; la bande de jours est une `nav` de liens ; `aria-current` sur l'onglet,
  le jour courant et l'entrée de navigation active.
- `regles-produit.test.ts` reste vert ; ajouter si besoin une règle « aucune couleur chaude (teinte 0–45°) dans les tokens ».

## Tests

- Unitaires : contrastes (nouveaux tokens, deux thèmes), pastilles (« Dans la journée »), bande de jours (dérivée de
  `VueSemaine`, jour courant, jours non vides).
- API : route de transcription (propriétaire, autre compte → 404, capture privée → 404, repli `texte_ecrit`, absence de
  contenu dans les journaux).
- Playwright : parcours existants mis à jour (sélecteurs), plus un contrôle visuel de l'accueil, de la semaine, du détail et du
  Privé en clair et en sombre.

## Livraison

Un lot `lot-interface`, publié en **1.5.0** (CHANGELOG « Modifié » pour l'habillage, « Ajouté » pour la transcription et le
crayon). `design/maquettes.html` est remplacé par un renvoi à la maquette et la palette documentée. Déploiement habituel
(`docs/exploitation.md`), sans changement de compose ni de variable.

## Risques

- Écart entre maquette et rendu réel sur petits écrans (360 px) : textes longs dans les cartes et la bande de jours, à
  vérifier à 360 px dans Playwright.
- Police : poids du woff2 (environ 4 fichiers) dans le cache du service worker ; sous-ensemble latin seulement.
- Transcriptions longues : la carte « Ce que tu as dit » se replie au-delà de six lignes avec « Lire tout ».
