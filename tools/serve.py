"""Serve web/ on http://localhost:8765 with no-cache headers (so edits show up on reload).

Usage: python tools/serve.py [port]
"""
import functools
import http.server
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".bin": "application/octet-stream",
                      ".json": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    handler = functools.partial(Handler, directory=str(WEB))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as srv:
        print(f"Serving {WEB} at http://localhost:{port}/  (Ctrl+C to stop)")
        srv.serve_forever()


if __name__ == "__main__":
    main()
