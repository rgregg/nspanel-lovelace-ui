"""Localhost-only endpoint that lets the editor service render previews.

The editor (web.py) runs in a separate process from the card backend, and only
the backend holds the Home Assistant state cache. This server binds to
127.0.0.1 and requires a random token that only the add-on's own processes can
read from a private file.
"""
import hmac
import json
import logging
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time

MAX_BYTES = 1024 * 1024
DEFAULT_PORT = 8098
DEFAULT_TOKEN_PATH = "/tmp/nspanel-preview.token"
ENTITY_CACHE_SECONDS = 60


def write_token(path=DEFAULT_TOKEN_PATH):
    token = secrets.token_urlsafe(32)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        handle.write(token)
    os.chmod(path, 0o600)
    return token


def _default_render(draft_yaml, panel_name):
    import preview  # imported lazily: it pulls in the whole card backend
    return preview.render_preview(draft_yaml, panel_name)


def _default_entities():
    import libs.home_assistant
    return libs.home_assistant.list_entities()


def _default_thumbnails():
    import preview
    return preview.render_thumbnails()


def make_server(port, token, render=_default_render, entities=_default_entities, thumbnails=_default_thumbnails):
    entity_cache = {"at": 0.0, "value": []}
    entity_lock = threading.Lock()
    thumbnail_cache = {}

    def cached_entities(refresh):
        with entity_lock:
            fresh = time.monotonic() - entity_cache["at"] < ENTITY_CACHE_SECONDS
            if refresh or not fresh or not entity_cache["value"]:
                entity_cache["value"] = entities()
                entity_cache["at"] = time.monotonic()
            return entity_cache["value"]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            logging.debug("Preview: " + fmt, *args)

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            supplied = self.headers.get("X-Preview-Token", "")
            if not hmac.compare_digest(supplied.encode(), token.encode()):
                self.reply(403, {"error": "Forbidden"})
                return
            if self.path not in ("/render", "/entities", "/thumbnails"):
                self.reply(404, {"error": "Not found"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= MAX_BYTES:
                    raise ValueError("Request must be smaller than 1 MiB.")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise ValueError("Expected an object.")
                draft, panel = body.get("yaml"), body.get("panel")
                if self.path == "/render" and (not isinstance(draft, str) or not (panel is None or isinstance(panel, str))):
                    raise ValueError("Expected yaml text and an optional panel name.")
            except (ValueError, AttributeError, UnicodeError) as exc:
                self.reply(400, {"error": str(exc)})
                return
            if self.path == "/thumbnails":
                try:
                    with entity_lock:
                        if "value" not in thumbnail_cache:
                            thumbnail_cache["value"] = thumbnails()
                    self.reply(200, {"thumbnails": thumbnail_cache["value"]})
                except Exception:
                    logging.exception("Thumbnails failed")
                    self.reply(500, {"error": "Could not render card thumbnails."})
                return
            if self.path == "/entities":
                try:
                    self.reply(200, {"entities": cached_entities(bool(body.get("refresh")))})
                except Exception:
                    logging.exception("Entity list failed")
                    self.reply(500, {"error": "Could not list Home Assistant entities."})
                return
            try:
                self.reply(200, render(draft, panel))
            except Exception:
                logging.exception("Preview render failed")
                self.reply(500, {"error": "Preview failed. Check add-on logs."})

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def start_preview_server(port=DEFAULT_PORT, token_path=DEFAULT_TOKEN_PATH):
    """Start the endpoint in a daemon thread; failure must never stop the panels."""
    try:
        server = make_server(port, write_token(token_path))
    except OSError:
        logging.warning("Could not start the editor preview endpoint on 127.0.0.1:%s", port, exc_info=True)
        return None
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logging.info("Editor preview endpoint listening on 127.0.0.1:%s", port)
    return thread
