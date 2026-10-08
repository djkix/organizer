# Effacement en deux temps et historique des envois — conception

Date : 2026-10-08. Version visée : 1.6.0. Conception validée par l'administrateur le 2026-10-08 (dans la conversation).

## 1. Effacement : confirmation immédiate, puis cinq secondes pour revenir

**Besoin.** Glisser une action doit proposer tout de suite la confirmation en bas, sans passer par un bouton « Effacer »
découvert derrière la ligne ; et une erreur doit pouvoir se rattraper pendant cinq secondes.

**Comportement.**

- Glisser une ligne vers la gauche, franchement (au moins 96 px, geste horizontal) : la ligne revient en place et la feuille
  basse « Effacer cette note ? » monte aussitôt (texte de l'action, « Annuler » et « Effacer »). Un geste plus court, vertical
  ou vers la droite ne fait rien. Le bouton « Effacer » découvert derrière la ligne disparaît, avec la logique « une seule
  ligne ouverte » qui l'accompagnait.
- « Annuler » (ou Échap) : rien ne change.
- « Effacer » : la ligne quitte la liste à l'instant ; le bandeau du bas dit « Effacé. » avec « Annuler » pendant **5 s**.
  Aucune requête ne part pendant ce délai. « Annuler » rend la ligne, sans requête. À l'échéance, `DELETE /api/items/:id`
  part une fois (même file d'écriture que les cochages). En cas d'échec, la ligne revient et le bandeau dit
  « Pas effacé. Réessaie dans un moment. ».
- Un deuxième effacement pendant le délai du premier : le premier part tout de suite, le bandeau suit le second.
- Fermer l'application pendant le délai : rien n'est effacé (« rien ne se perd »). Quitter l'écran par la navigation de
  l'application : l'effacement en attente part aussitôt (l'intention était claire).
- Même règle dans le détail d'une action (bouton « Effacer ») et dans la vue À revoir.
- Le bandeau de cochage (« Fait. Annuler », 10 s) est inchangé ; un seul bandeau est visible : le geste le plus récent.

## 2. Historique des envois

**Besoin.** Retrouver ce qui a été envoyé (hors Privé) : quand, par où, le début du contenu et ce qu'il est devenu.

**Écran.** Quatrième onglet de la barre du bas, « Historique » (icône horloge), entre « À faire » et « Privé ».
Titre « Historique », sous-titre « Ce que tu as envoyé ». Navigation par mois (‹ Octobre 2026 ›, mois suivant désactivé
au mois courant), groupes par jour (« Aujourd'hui », « Hier », puis le jour), du plus récent au plus ancien.

Une ligne (bouton qui ouvre le détail) :

- heure et source : « Vocal » (PWA), « Vocal, Telegram », « Écrit » (texte seul) ; durée pour un vocal (« 0:42 ») ;
- début du contenu : transcription (ou texte écrit), deux lignes au plus, coupée proprement ; « Pas encore transcrit. »
  s'il n'y a rien ;
- pastilles de ce que c'est devenu, **sans nombre** : « Action », « Pensée », « Info », « À revoir » (une par nature
  présente), ou « En cours de tri » tant que le classement n'est pas fini.

État vide : « Rien ce mois-ci. ». Les captures privées n'apparaissent jamais, sous aucune forme.

**Détail** (panneau plein écran, lecture seule, « Retour ») : date et heure complètes (« Mercredi 7 octobre, 12:05 »),
source et durée ; carte « Ce que tu as dit » (texte entier, lecteur audio si l'audio existe encore) ; carte « Ce qui en est
sorti » : chaque élément avec sa pastille de nature et son état en mots — « À faire », « Fait », « Effacé », ou rien pour
une pensée ou une information. Aucune action depuis cet écran.

**API** (session obligatoire, compte de la session seulement, décision 25) :

- `GET /api/historique?mois=AAAA-MM` → `JourHistorique[]` :
  `{ jour, envois: [{ id, heure, source: 'pwa' | 'telegram', vocal, dureeS, debut, etat: 'en_cours' | 'classee' | 'a_revoir', natures }] }`.
  `debut` : 140 caractères au plus (coupé au dernier espace, suivi de « … »), `null` sans texte. `natures` : natures
  distinctes des éléments, dans l'ordre action, pensée, information, ambigu. `etat` : `recue`, `en_file`, `a_transcrire`
  → `en_cours`. Mois invalide → 400. Jours et heures dans le fuseau du compte.
- `GET /api/historique/:id` → `{ id, emisLe, source, vocal, dureeS, etat, texte, aAudio, elements: [{ itemId, texte, nature, statut }] }`,
  `statut` : `efface` (archivé), `fait`, `a_faire` (action non faite), `note` (pensée, information, ambigu). 404 pour une
  capture privée, inconnue ou d'un autre compte.
- Aucun texte de capture dans les journaux.

## Contraintes

Règles du projet inchangées : ni rouge ni orange, aucun compteur ni nombre d'éléments, 16 px minimum, cibles de 44 px,
français et tutoiement, CSP stricte, palette « Sérénité affinée ». La barre du bas passe à quatre entrées et doit tenir à
360 px sans débordement.

## Tests attendus

Unitaires : l'effaceur (délai, annulation sans requête, envoi unique à l'échéance, second effacement qui fait partir le
premier, échec qui rend la ligne) ; le glissement (seuil, geste vertical) ; la mise en forme de l'historique (source,
début coupé, pastilles). API : liste par mois et détail (privé exclu, autre compte en 404, mois invalide, statuts, fuseau).
E2E : glisser ouvre la feuille ; annuler pendant 5 s ; une seule requête après 5 s ; même chose depuis le détail et À revoir ;
onglet Historique, détail, mois précédent ; apparence à 360 px en clair et en sombre.
