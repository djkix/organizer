# Organizer

Capture vocale qui trie automatiquement notes et choses à faire. Auto-hébergé, Android, français.

- `CLAUDE.md` — règles du projet, chargé automatiquement par Claude Code
- `docs/cahier-des-charges.md` — spécification complète
- `docs/decisions.md` — les 20 décisions fermées
- `design/tokens.css` et `design/tokens.json` — couleurs, formes, règles d'interface
- `design/maquettes.html` — prototype navigable (ouvrir dans un navigateur)
- `fixtures/` — énoncés fabriqués pour tester le tri. Jamais de captures réelles.

## Démarrage

```bash
cp .env.example .env    # puis renseigner les secrets, hors dépôt
pnpm install
docker compose -f infra/docker-compose.yml up -d
pnpm prisma migrate dev
pnpm dev
```

Le dépôt est public : voir la section « Dépôt public » de `CLAUDE.md` avant tout commit.
