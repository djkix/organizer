"""Relecture des captures du banc d'essai terrain.

Récupère captures.jsonl et l'audio depuis le volume Docker, puis ouvre une page
locale où chaque item classé par Gemini se valide ou se corrige. Les corrections
sont écrites dans corpus/annotations.jsonl, au format de docs/guide-annotation.md.

    python3 tools/relecture/relecture.py              # récupère puis ouvre
    python3 tools/relecture/relecture.py --sans-recup # ouvre sans récupérer

Tout reste dans corpus/, ignoré par Git : ce sont les données réelles de L.
Le serveur n'écoute que sur 127.0.0.1.
"""
import argparse
import json
import mimetypes
import os
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
CORPUS = Path(os.environ.get("ORGANIZER_CORPUS", RACINE / "corpus"))
TERRAIN = CORPUS / "terrain"
CAPTURES = TERRAIN / "captures.jsonl"
ANNOTATIONS = CORPUS / "annotations.jsonl"
PAGE = Path(__file__).with_name("relecture.html")
TOKENS = RACINE / "design" / "tokens.css"

HOTE = os.environ.get("ORGANIZER_SSH", "kix@192.168.1.201")
VOLUME = "organizer-terrain_donnees"

# Champs d'une ligne d'annotation, dans l'ordre du guide.
CHAMPS_ITEM = [
    "texte", "nature", "echeance_type", "echeance_expr", "echeance_date", "fenetre_debut",
    "fenetre_fin", "importance", "effort", "contexte", "alarme", "alarme_expr",
    "personnes", "theme", "tonalite", "remarque",
]


def recuperer():
    TERRAIN.mkdir(parents=True, exist_ok=True)
    print(f"Récupération depuis {HOTE}, volume {VOLUME}…")
    distant = f"docker run --rm -v {VOLUME}:/d:ro alpine tar -C /d/data -cf - ."
    ssh = subprocess.Popen(["ssh", HOTE, distant], stdout=subprocess.PIPE)
    subprocess.run(["tar", "-xf", "-", "-C", str(TERRAIN)], stdin=ssh.stdout, check=True)
    if ssh.wait() != 0:
        sys.exit("Échec de la récupération. Voir tools/relecture/README.md, section Accès SSH.")


def lire_jsonl(chemin):
    if not chemin.exists():
        return []
    return [json.loads(l) for l in chemin.read_text().splitlines() if l.strip()]


def donnees():
    annot = {}
    for a in lire_jsonl(ANNOTATIONS):
        annot.setdefault(a["capture"], []).append(a)
    captures = []
    for c in lire_jsonl(CAPTURES):
        captures.append({
            "id": c["id"],
            "emis_le": c["emis_le"],
            "duree_s": c.get("duree_s"),
            "audio": c.get("audio"),
            "texte_ecrit": c.get("texte_ecrit"),
            "etat": c.get("etat"),
            "erreur": c.get("erreur"),
            "modele": c.get("modele"),
            "version_prompt": c.get("version_prompt"),
            "transcription": (c.get("resultat") or {}).get("transcription") or c.get("texte_ecrit") or "",
            "gemini": (c.get("resultat") or {}).get("items", []),
            "annotations": sorted(annot.get(c["id"], []), key=lambda a: a["position"]),
        })
    captures.sort(key=lambda c: c["emis_le"])
    return captures


def enregistrer(capture_id, items):
    """Remplace toutes les lignes de cette capture dans annotations.jsonl."""
    capture = next((c for c in lire_jsonl(CAPTURES) if c["id"] == capture_id), None)
    if capture is None:
        raise ValueError("capture inconnue")
    gardees = [a for a in lire_jsonl(ANNOTATIONS) if a["capture"] != capture_id]
    for i, it in enumerate(items, start=1):
        ligne = {"capture": capture_id, "position": i, "emis_le": capture["emis_le"], "duree_s": capture.get("duree_s")}
        ligne.update({k: it.get(k) for k in CHAMPS_ITEM})
        ligne["personnes"] = ligne["personnes"] or []
        ligne["modele"] = capture.get("modele")
        ligne["version_prompt"] = capture.get("version_prompt")
        gardees.append(ligne)
    CORPUS.mkdir(exist_ok=True)
    tmp = ANNOTATIONS.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(a, ensure_ascii=False) + "\n" for a in gardees))
    tmp.replace(ANNOTATIONS)


class Gestionnaire(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def envoyer(self, code, corps, type_="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        if self.path == "/":
            html = PAGE.read_text().replace("/*TOKENS*/", TOKENS.read_text())
            return self.envoyer(200, html.encode(), "text/html; charset=utf-8")
        if self.path == "/api/captures":
            return self.envoyer(200, json.dumps(donnees(), ensure_ascii=False).encode())
        if self.path.startswith("/audio/"):
            fichier = (TERRAIN / "audio" / Path(self.path).name).resolve()
            if fichier.parent == (TERRAIN / "audio").resolve() and fichier.exists():
                type_ = "audio/ogg" if fichier.suffix in (".oga", ".ogg") else (mimetypes.guess_type(fichier)[0] or "application/octet-stream")
                return self.envoyer(200, fichier.read_bytes(), type_)
        self.envoyer(404, b"{}")

    def do_POST(self):
        if self.path != "/api/annotation":
            return self.envoyer(404, b"{}")
        corps = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        try:
            enregistrer(corps["capture"], corps["items"])
        except (KeyError, ValueError) as e:
            return self.envoyer(400, json.dumps({"erreur": str(e)}).encode())
        self.envoyer(200, b"{}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sans-recup", action="store_true", help="ne pas récupérer depuis le serveur")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    if not args.sans_recup:
        recuperer()
    if not CAPTURES.exists():
        sys.exit(f"Aucune capture dans {CAPTURES}.")
    url = f"http://127.0.0.1:{args.port}/"
    print(f"{len(lire_jsonl(CAPTURES))} captures. Relecture sur {url} — Ctrl+C pour arrêter.")
    webbrowser.open(url)
    ThreadingHTTPServer(("127.0.0.1", args.port), Gestionnaire).serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
