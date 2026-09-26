"""Local dashboard server: the static dashboard plus the author-search API.

    python server.py [port]          (default port 8000)

Everything except author search is plain static files, so `python -m http.server`
still renders the charts; run this instead to get search. Stdlib only, and it
binds to 127.0.0.1 so the index is not reachable from other machines.

API (JSON, read-only; needs the index from build_author_index.py):
    /api/status
    /api/search?q=<name>
    /api/author?id=<author id>
    /api/papers?id=<author id>&offset=<n>&limit=<n>
"""
import json
import os
import sqlite3
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import author_index as ai

HERE = os.path.dirname(os.path.abspath(__file__))
NOT_BUILT = "Author index not built yet. Run: python build_author_index.py"


def int_param(params, name, default=None, low=0, high=None):
    raw = params.get(name, [None])[0]
    if raw is None:
        if default is None:
            raise ValueError(f"missing '{name}'")
        return default
    value = int(raw)  # ValueError on junk
    if value < low or (high is not None and value > high):
        raise ValueError(f"'{name}' out of range")
    return value


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self._is_api = False
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        if not self._is_api:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path.startswith("/api/"):
            self.handle_api(url)
        else:
            super().do_GET()

    def send_json(self, status, payload):
        self._is_api = True
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, url):
        params = parse_qs(url.query)
        conn = ai.connect()
        if conn is None:
            self.send_json(503, {"ready": False, "error": NOT_BUILT})
            return
        try:
            if url.path == "/api/status":
                self.send_json(200, ai.status(conn))
            elif url.path == "/api/search":
                self.send_json(200, ai.search(conn, params.get("q", [""])[0]))
            elif url.path == "/api/author":
                result = ai.profile(conn, int_param(params, "id"))
                if result is None:
                    self.send_json(404, {"error": "no such author"})
                else:
                    self.send_json(200, result)
            elif url.path == "/api/papers":
                self.send_json(200, {"papers": ai.papers_page(
                    conn, int_param(params, "id"),
                    int_param(params, "offset", default=0),
                    int_param(params, "limit", default=50, low=1, high=100))})
            else:
                self.send_json(404, {"error": "unknown endpoint"})
        except ValueError as err:
            self.send_json(400, {"error": str(err)})
        except sqlite3.Error as err:
            self.log_error("index error: %s", err)
            self.send_json(500, {"error": "the author index could not be read"})
        finally:
            conn.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as err:
        sys.exit(f"Could not listen on port {port}: {err}. Is another server already using it? "
                 f"Try: python server.py {port + 1}")
    conn = ai.connect()
    if conn is None:
        print(f"Note: {NOT_BUILT}\n      (charts work without it; author search will say it is unavailable)")
    else:
        info = ai.status(conn)
        conn.close()
        print(f"Author index ready: {info['authors']:,} authors, {info['papers']:,} papers")
    print(f"Dashboard: http://localhost:{port}/index.html   (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
