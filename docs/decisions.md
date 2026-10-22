# Décisions arrêtées

| # | Sujet | Décision |
| --- | --- | --- |
| 1 | Pensées via Gemini | Oui, en palier payé dès le premier appel |
| 2 | Mode privé | Bouton d'enregistrement dédié, pas de mot-clé |
| 3 | Retrouver une pensée privée | Par date et heure. Pas de transcription, pas de recherche texte |
| 4 | Garde-fou de longueur | 30 s confort, 60 s avertissement, 180 s découpage |
| 5 | Sollicitations | Aucune par défaut, alarme comprise |
| 6 | Activation d'une alarme | Item par item, à la voix ou par bouton |
| 7 | Ressortir une pensée | Dans l'application seulement, jamais en notification |
| 8 | Visibilité des pensées | ~~Visibles aussi par l'administrateur~~ Remplacée par la décision 25 |
| 9 | Compte de l'API Gemini | Compte Google personnel de l'administrateur, facturation activée |
| 10 | Agenda | Compte Google de l'utilisatrice, OAuth porté par elle |
| 11 | Sauvegarde | Sauvegarde dédiée (dump chiffré hors de l'hôte) au lot 2 |
| 12 | Disque et audio | 50 Go maximum pour la stack, en volumes Docker simples. Rotation de l'audio ordinaire déjà transcrit au-delà de 40 Go |
| 13 | Hébergement | Un hôte Docker existant, derrière un reverse proxy, stack pilotée par Dockge |
| 14 | Publication | organizer.example.org |
| 15 | Dépôt | GitHub personnel djkix, public |
| 16 | Comptes | Deux : l'utilisatrice principale et l'administrateur |
| 17 | Widget d'accueil | Home Assistant, silencieux, livré au lot 2 |
| 18 | Modèle | gemini-3.1-flash-lite par défaut |
| 19 | Nom | Organizer |
| 20 | Bot Telegram | @mon_organizer_bot |
| 21 | Lots 0 et 1 | Menés en parallèle. Thèmes, types d'échéance et prompt sont des données, branchées en fin de lot 1 |
| 22 | Mise en service | Directe, sans attendre la sortie du lot 0. L'application démarre en production avec le prompt actuel (`tri/v1`) ; le classement est affiné à l'usage, sur les captures réelles et les corrections. Le corpus du lot 0 continue de servir de jeu de test, sans bloquer la mise en service |
| 23 | Empreinte digitale | Avancée du lot 3 à un lot 1-D, livré juste après la mise en service. WebAuthn (clé d'accès Android) pour la reconnexion seulement ; le mot de passe reste toujours possible. Pas de mot de passe redemandé avant « Activer l'empreinte » (la session suffit) ; la synchronisation des clés d'accès Google sur les autres Android de l'utilisatrice est acceptée (5 octobre 2026) |
| 24 | Capture ordinaire dans la PWA | Bouton d'enregistrement ordinaire dans la PWA, à côté du bouton privé, avancé du lot 3 au lot 2-B le 5 octobre 2026. Telegram reste un point d'entrée. |

## Points encore ouverts

- Formulations exactes qui déclenchent l'alarme à la voix — à tirer du corpus du lot 0.
- Le widget suffit-il à rappeler les choses sans alarme ni relance ? Test central du lot 2.
- Basculer sur un compte Google dédié si les factures ou quotas deviennent gênants.
| 25 | Données propres à chaque compte | Chaque compte ne voit et ne modifie que ses propres captures, items, actions, pensées, captures privées et éléments à revoir. Décidé par l'administrateur le 6 octobre 2026 ; remplace la décision 8. |
| 26 | Durée d'un enregistrement dans la PWA | 1 min 30 au plus, en ordinaire comme en privé : un minuteur affiche le temps écoulé sur 1:30, l'enregistrement s'arrête seul et garde ce qui a été dit. Telegram n'est pas limité. Décidé par l'administrateur le 15 octobre 2026 |
| 27 | Mise à jour de la PWA | Proposée, jamais imposée : un bandeau discret « Nouvelle version disponible », avec « Recharger », quand une nouvelle coquille attend ou que le serveur annonce un autre numéro publié. Jamais pendant un enregistrement ni sur l'écran de connexion. Ce n'est pas une sollicitation au sens de la décision 5 : rien ne sort de l'application, aucune notification, et le contenu de l'utilisatrice n'est pas en cause. Décidé par l'administrateur le 21 octobre 2026 |
