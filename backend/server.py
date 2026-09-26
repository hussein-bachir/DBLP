"""Start the app: the built React front end plus the FastAPI backend.

    python server.py [port]          (default port 8000)

The app itself is in api.py (interactive API docs at /docs). This launcher just
runs it with uvicorn on 127.0.0.1, so the index is not reachable from other
machines. The front end is served from frontend/dist (run `npm run build` in
frontend/ first). The charts need no index; researcher search needs the one from
build_author_index.py.
"""
import sys

import uvicorn

import author_index as ai
from api import INDEX_PATH, NOT_BUILT, app


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    conn = ai.connect(INDEX_PATH)
    if conn is None:
        print(f"Note: {NOT_BUILT}\n      (charts work without it; author search will say it is unavailable)")
    else:
        info = ai.status(conn)
        conn.close()
        print(f"Author index ready: {info['authors']:,} authors, {info['papers']:,} papers")
    print(f"App: http://localhost:{port}/   API docs: http://localhost:{port}/docs   (Ctrl+C to stop)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
