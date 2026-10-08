# Alertes admin, vue Pensées, rotation de l'audio — conception

Date : 2026-10-08. Version visée : 1.7.0. Choix validés par l'administrateur le 2026-10-08 : alertes dans la partie admin
avec un point discret sur l'onglet Réglages ; onglet « Pensées » dans la barre du bas, l'Historique passe dans Réglages ;
rotation de l'audio ordinaire au-delà de 40 Go.

## 1. Alertes techniques dans la PWA (admin seulement)

Depuis la désactivation de Telegram (2026-10-07), les alertes de la file `alertes` n'atteignent plus personne.

- **Stockage.** Chaque alerte reçue par l'API (worker, scheduler, veille) est enregistrée dans une table `alerte`
  (`id`, `cle` unique = identifiant du job, `message`, `cree_le`, `vue_le`). Un job rejoué ne crée pas de doublon.
  L'envoi Telegram reste tenté pour un admin lié (aucun aujourd'hui). Le message est technique, jamais un contenu de
  capture (règle existante).
- **API** (admin seulement ; un compte non admin reçoit 404, la route « n'existe pas » pour lui) :
  `GET /api/alertes` → `{ alertes: [{ id, message, creeLe, vue }], nonVues: boolean }` (30 derniers jours, 50 au plus,
  plus récentes d'abord) ; `POST /api/alertes/vues` → 204, marque toutes les alertes comme vues.
- **PWA.** Réglages, pour l'admin seulement : section « Alertes techniques » (date et heure, message ; « Aucune alerte. »
  sinon) et bouton « Tout marquer comme vu ». Sur l'onglet Réglages de la barre du bas, un **point** discret (sans
  chiffre, couleur d'accent) tant qu'une alerte n'est pas vue ; vérifié au démarrage et au retour sur l'application.
  L ne voit jamais ni la section ni le point.

## 2. Vue Pensées

Les pensées sont classées depuis le lot 1 mais ne s'affichent nulle part (sauf dans l'Historique).

- **Barre du bas** : À faire, **Pensées**, Privé, Réglages. Réglages gagne l'entrée « Historique des envois » (à côté de
  « À revoir ») ; l'écran Historique ne change pas, son onglet actif devient Réglages.
- **Écran Pensées** : titre « Pensées », sous-titre « Ce que tu as pensé à voix haute ». Navigation par mois, groupes par
  jour, du plus récent au plus ancien. Filtres en puces au-dessus de la liste : « Toutes », puis chaque thème, puis
  chaque personne présents dans les pensées du compte ; un seul filtre actif. Chaque pensée est une carte : texte entier
  (replié au-delà de 4 lignes), heure, pastilles de thème et de personnes. **Jamais de case à cocher** (règle n° 1).
  État vide : « Rien ce mois-ci. ».
- **Détail** (toucher une carte) : texte, date et heure, thème, personnes, « Ce que tu as dit » (transcription et
  lecteur), et deux gestes : « C'est une chose à faire » (correction de nature, comme le détail d'une action) et
  « Effacer » (confirmation puis 5 s pour annuler, comme partout).
- **API** : `GET /api/pensees?mois=AAAA-MM[&theme=…|&personne=…]` →
  `{ jours: [{ jour, pensees: [{ itemId, captureId, texte, heure, theme, personnes, aAudio }] }], themes: string[], personnes: string[] }`.
  Pensées non archivées du compte (nature `pensee`), captures non privées ; `themes` et `personnes` : valeurs distinctes
  sur toutes les pensées du compte, triées. Mois invalide → 400. Fuseau du compte.

## 3. Rotation de l'audio ordinaire

Cahier des charges, « Rotation de l'audio » : au-delà de **40 Go**, purger jusqu'à repasser sous **35 Go**, du plus ancien
au plus récent (`emis_le`), seulement des captures **ordinaires**, **transcrites** (texte stocké) et émises il y a **plus de
30 jours**. Jamais une capture privée, jamais une capture en file, à transcrire ou sans texte. Effet : fichier supprimé,
`audio_path` à `null`, `audio_purge_le` renseigné ; transcription et éléments intacts ; rien n'est dit à L (le lecteur
disparaît simplement).

- **Où.** Dans l'API, qui monte déjà le volume audio en écriture et mesure sa taille pour la veille (le scheduler ne le
  monte pas). Passage chaque heure, idempotent : rien ne se passe sous 40 Go.
- **Alerte admin** si, après un passage, l'audio reste au-dessus de 40 Go faute de capture éligible (une fois par épisode).
- **Veille** : le seuil d'alerte audio passe de 30 Go à 40 Go ; le message ne parle plus d'une rotation « à venir ».
- **Journaux** : nombre de fichiers purgés et octets libérés, jamais un identifiant de contenu ni un texte.

## Contraintes

Règles du projet inchangées (aucun rouge ni orange, aucun compteur ni nombre visible par L, 16 px, cibles de 44 px,
français et tutoiement, décision 25, rien de privé). Une migration Prisma (table `alerte`), additive.

## Tests attendus

API : alertes (enregistrement idempotent, liste et « vues », 404 pour un non-admin) ; pensées (mois, filtres, archivées
et actions exclues, autre compte, privé) ; rotation (seuils, ordre, éligibilité, privée jamais, fichiers et champs mis à
jour, alerte quand rien n'est éligible). PWA : point sur Réglages pour l'admin seulement ; section Alertes ; onglet et
écran Pensées, filtres, détail, correction et effacement ; Historique depuis Réglages ; apparence à 360 px.
