"""Serves the editor + tree save/load API. Zero dependencies — stdlib only."""

import json
import time
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

OLLAMA_URL = "http://localhost:11434/api/generate"

BT_SYSTEM_PROMPT = """You are a behavior tree generator for game AI. Given a plain English description, return ONLY valid JSON — no markdown, no explanation, no extra text.

Node types and categories:
- sequence (composite): runs children left-to-right, fails on first failure
- selector (composite): runs children left-to-right, succeeds on first success
- parallel (composite): runs all children simultaneously
- action (leaf): performs a game action
- condition (leaf): checks a blackboard/world state
- invert (decorator): inverts child result
- repeat (decorator): repeats child. Parameters: {count: N}
- cooldown (decorator): delays re-execution. Parameters: {duration: seconds}
- timeout (decorator): fails after time. Parameters: {seconds: N}
- guard (decorator): only runs child if condition met

Return this exact JSON structure:
{"root":"<root_id>","nodes":{"<id>":{"id":"<id>","type":"<type>","category":"<category>","name":"<label>","children":["<child_ids>"],"parameters":{}}}}

Rules:
- IDs are unique 8-character hex strings like "a1b2c3d4"
- Composites: 2+ children. Decorators: exactly 1 child. Leaves: 0 children (empty array)
- children is always an array of ID strings
- parameters is always an object
- Use realistic game values (speed, damage, duration, radius, etc.)
- 5-20 nodes typical. Name nodes clearly for game designers.
- Return ONLY the JSON object. No text before or after it."""

def _call_ollama(description):
    """Call local Ollama and return parsed tree JSON, or None on failure."""
    payload = json.dumps({
        "model": "llama3",
        "prompt": description,
        "system": BT_SYSTEM_PROMPT,
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.3},
    }).encode()
    req = urllib.request.Request(
        OLLAMA_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
        text = result.get("response", "")
        tree = json.loads(text)
        if "root" not in tree or "nodes" not in tree:
            return None
        # Normalize nodes: accept both dict and list formats
        nodes = tree["nodes"]
        if isinstance(nodes, list):
            tree["nodes"] = {n["id"]: n for n in nodes}
        return tree
    except Exception:
        return None

PORT = 8090
ROOT = Path(__file__).parent.parent
EDITOR_DIR = ROOT / "editor"
EXAMPLES_DIR = ROOT / "examples"
TREES_DIR = ROOT / "trees"
TREES_DIR.mkdir(exist_ok=True)
VERSIONS_DIR = TREES_DIR / ".versions"
VERSIONS_DIR.mkdir(exist_ok=True)
MAX_VERSIONS = 20

MIME = {
    ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
    ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/ai-status":
            try:
                req = urllib.request.Request("http://localhost:11434/api/tags")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    data = json.loads(resp.read())
                models = [m["name"] for m in data.get("models", [])]
                self._json_response({"available": True, "models": models})
            except Exception:
                self._json_response({"available": False, "models": []})
            return

        if path == "/api/trees":
            files = []
            for d, name in [(EXAMPLES_DIR, "examples"), (TREES_DIR, "trees")]:
                for f in sorted(d.glob("*.bt.json")):
                    entry = {"name": f.stem.replace(".bt", ""), "dir": name}
                    try:
                        tree = json.loads(f.read_text())
                        nodes = tree.get("nodes", {})
                        entry["nodeCount"] = len(nodes)
                    except Exception:
                        pass
                    files.append(entry)
            self._json_response(files)
            return

        if path == "/api/replays":
            files = []
            for d, name in [(EXAMPLES_DIR, "examples"), (TREES_DIR, "trees")]:
                for f in sorted(d.glob("*.replay.json")):
                    files.append({"name": f.stem.replace(".replay", ""), "dir": name})
            self._json_response(files)
            return

        if path.startswith("/api/replay/"):
            parts = path.split("/")  # ['', 'api', 'replay', dir, name]
            if len(parts) == 5:
                directory, name = parts[3], parts[4]
                base = EXAMPLES_DIR if directory == "examples" else TREES_DIR
                replay_path = base / f"{name}.replay.json"
                if replay_path.exists():
                    self._json_response(json.loads(replay_path.read_text()))
                    return
            self._error(404, "Replay not found")
            return

        if path.startswith("/api/tree/"):
            parts = path.split("/")  # ['', 'api', 'tree', dir, name]
            if len(parts) == 5:
                directory, name = parts[3], parts[4]
                base = EXAMPLES_DIR if directory == "examples" else TREES_DIR
                tree_path = base / f"{name}.bt.json"
                layout_path = base / f"{name}.bt.layout.json"
                if tree_path.exists():
                    tree = json.loads(tree_path.read_text())
                    layout = json.loads(layout_path.read_text()) if layout_path.exists() else {"version": "1.0", "nodes": {}}
                    self._json_response({"tree": tree, "layout": layout})
                    return
            self._error(404, "Not found")
            return

        if path.startswith("/api/versions/"):
            name = path.split("/")[3] if len(path.split("/")) >= 4 else ""
            ver_dir = VERSIONS_DIR / name
            if ver_dir.is_dir():
                versions = []
                for f in sorted(ver_dir.glob("*.bt.json"), reverse=True):
                    ts = int(f.stem)
                    tree = json.loads(f.read_text())
                    versions.append({"timestamp": ts, "nodeCount": len(tree.get("nodes", {}))})
                self._json_response(versions)
            else:
                self._json_response([])
            return

        if path.startswith("/api/version/"):
            parts = path.split("/")  # ['', 'api', 'version', name, timestamp]
            if len(parts) == 5:
                name, ts = parts[3], parts[4]
                ver_dir = VERSIONS_DIR / name
                tree_path = ver_dir / f"{ts}.bt.json"
                layout_path = ver_dir / f"{ts}.bt.layout.json"
                if tree_path.exists():
                    tree = json.loads(tree_path.read_text())
                    layout = json.loads(layout_path.read_text()) if layout_path.exists() else {"version": "1.0", "nodes": {}}
                    self._json_response({"tree": tree, "layout": layout})
                    return
            self._error(404, "Version not found")
            return

        # Static files
        if path == "/":
            # Serve landing page if it exists, else editor
            landing = ROOT / "landing.html"
            if landing.exists():
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(landing.read_bytes())
                return
            path = "/index.html"
        if path in ("/editor", "/editor/"):
            path = "/index.html"
        if path.startswith("/editor/"):
            path = "/" + path[len("/editor/"):]
        file_path = EDITOR_DIR / path.lstrip("/")
        if file_path.exists() and file_path.is_file():
            ext = file_path.suffix
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
            self.send_header("Cache-Control", "no-cache" if ext in (".html", ".json") else "public, max-age=3600")
            self.end_headers()
            self.wfile.write(file_path.read_bytes())
        else:
            self._error(404, "Not found")

    def do_POST(self):
        if self.path == "/api/generate":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            description = body.get("description", "").strip()
            if not description:
                self._error(400, "Missing description")
                return
            tree = _call_ollama(description)
            if tree:
                self._json_response({"source": "ollama", "tree": tree})
            else:
                self._json_response({"source": "none", "tree": None})
            return

        if self.path == "/api/tree":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            filename = "".join(c for c in body.get("filename", "") if c.isalnum() or c in "-_")
            if not filename:
                self._error(400, "Invalid filename")
                return
            tree_path = TREES_DIR / f"{filename}.bt.json"
            layout_path = TREES_DIR / f"{filename}.bt.layout.json"
            # Version existing file before overwriting
            if tree_path.exists():
                ts = int(time.time())
                ver_dir = VERSIONS_DIR / filename
                ver_dir.mkdir(exist_ok=True)
                ver_dir.joinpath(f"{ts}.bt.json").write_text(tree_path.read_text())
                if layout_path.exists():
                    ver_dir.joinpath(f"{ts}.bt.layout.json").write_text(layout_path.read_text())
                # Prune old versions
                versions = sorted(ver_dir.glob("*.bt.json"), key=lambda p: p.stem)
                for old in versions[:-MAX_VERSIONS]:
                    old.unlink(missing_ok=True)
                    layout_ver = old.with_suffix("").with_suffix(".bt.layout.json")
                    layout_ver.unlink(missing_ok=True)
            tree_path.write_text(json.dumps(body["tree"], indent=2) + "\n")
            layout_path.write_text(json.dumps(body["layout"], indent=2) + "\n")
            self._json_response({"saved": filename})
            return
        self._error(404, "Not found")

    def do_DELETE(self):
        if self.path.startswith("/api/tree/"):
            parts = self.path.split("/")
            if len(parts) == 5:
                directory, name = parts[3], parts[4]
                if directory != "trees":
                    self._error(403, "Can only delete user trees")
                    return
                tree_path = TREES_DIR / f"{name}.bt.json"
                layout_path = TREES_DIR / f"{name}.bt.layout.json"
                if tree_path.exists():
                    tree_path.unlink()
                    if layout_path.exists():
                        layout_path.unlink()
                    self._json_response({"deleted": name})
                    return
                self._error(404, "Not found")
                return
        self._error(404, "Not found")

    def _json_response(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, msg):
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(msg.encode())

    def log_message(self, format, *args):
        pass  # quiet


if __name__ == "__main__":
    examples = len(list(EXAMPLES_DIR.glob("*.bt.json"))) if EXAMPLES_DIR.exists() else 0
    trees = len(list(TREES_DIR.glob("*.bt.json")))
    print(f"Behavior Tree Editor running at http://localhost:{PORT}")
    print(f"  Editor:   http://localhost:{PORT}/editor")
    print(f"  Landing:  http://localhost:{PORT}/")
    print(f"  Trees:    {trees} saved, {examples} examples")
    HTTPServer(("", PORT), Handler).serve_forever()
