"""Génère compose.yaml : le bot, le prompt et le schéma embarqués dans un seul fichier.

Relancer après toute modification de bot.mjs ou de prompts/tri/ :
    python3 infra/terrain/genere.py
"""
from pathlib import Path

ICI = Path(__file__).parent
RACINE = ICI.parent.parent

SOURCES = {
    "bot": ICI / "bot.mjs",
    "prompt": RACINE / "prompts/tri/v1/system.md",
    "schema": RACINE / "prompts/tri/v1/response-schema.json",
}

TETE = """\
# Organizer — banc d'essai terrain. FICHIER GÉNÉRÉ par genere.py, ne pas éditer à la main.
#
# Dans Dockge : nouvelle stack « organizer-terrain », coller ce fichier, puis dans
# l'onglet .env :
#   TELEGRAM_BOT_TOKEN=...
#   GEMINI_API_KEY=...          (projet Google Cloud AVEC facturation)
#   ALLOWED_CHAT_IDS=           (vide au premier lancement : le bot donne l'identifiant)
#
# Un seul conteneur, aucun port exposé, aucune préparation sur l'hôte.
# Données (audio + captures.jsonl) dans le volume organizer-terrain_data.

name: organizer-terrain

services:
  bot:
    image: node:22-alpine
    restart: unless-stopped
    user: "1000:1000"
    # Pas de read_only : Compose copie les configs « content » dans le conteneur.
    command: ["node", "/app/bot.mjs"]
    environment:
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:?}
      GEMINI_API_KEY: ${GEMINI_API_KEY:?}
      ALLOWED_CHAT_IDS: ${ALLOWED_CHAT_IDS:-}
      GEMINI_MODEL: ${GEMINI_MODEL:-gemini-3.1-flash-lite}
      GEMINI_MODEL_FALLBACK: ${GEMINI_MODEL_FALLBACK:-gemini-3.8-flash}
      SHOW_RESULT: ${SHOW_RESULT:-true}
      TZ: Europe/Paris
    configs:
      - { source: bot, target: /app/bot.mjs }
      - { source: prompt, target: /app/system.md }
      - { source: schema, target: /app/response-schema.json }
    volumes:
      # Monté sur /home/node, qui existe dans l'image et appartient à node :
      # Docker reprend ce propriétaire. Un dossier absent de l'image serait à root.
      - data:/home/node
    logging:
      driver: json-file
      options: { max-size: 10m, max-file: "3" }
    deploy:
      resources:
        limits:
          memory: 256m

volumes:
  data:

configs:
"""


def bloc(nom: str, texte: str) -> str:
    if "$" in texte:
        raise SystemExit(f"{nom} contient un signe dollar : Compose l'interpréterait.")
    corps = "".join(f"      {ligne}\n" if ligne else "\n" for ligne in texte.splitlines())
    return f"  {nom}:\n    content: |\n{corps}"


sortie = TETE + "".join(bloc(nom, chemin.read_text()) for nom, chemin in SOURCES.items())
(ICI / "compose.yaml").write_text(sortie)
print(f"compose.yaml écrit ({len(sortie.splitlines())} lignes)")
