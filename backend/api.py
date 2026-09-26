"""FastAPI app: the researcher-search API and the built React app.

Run it with `python server.py [port]` (or `uvicorn api:app` from this folder).
Interactive API docs are generated at /docs.

The query logic lives in author_index.py (stdlib only, unchanged); this module
only adds HTTP, validation and typed response models. Endpoints:

    GET /api/status
    GET /api/search?q=<name>
    GET /api/author?id=<author id>
    GET /api/papers?id=<author id>&offset=<n>&limit=<n>

Errors are JSON of the form {"error": "..."} (503 also carries "ready": false
when the index has not been built), which is what the front end expects.
Set AUTHOR_INDEX_PATH to point at a different index file.
"""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

import author_index as ai

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
INDEX_PATH = os.environ.get("AUTHOR_INDEX_PATH", ai.DB_PATH)
NOT_BUILT = "Author index not built yet. Run: python build_author_index.py"


# ------------------------------------------------------------------ models

class VenueCount(BaseModel):
    venue: str
    count: int


class SearchResult(BaseModel):
    id: int
    name: str
    n_papers: int
    first_year: int | None
    last_year: int | None
    venues: list[VenueCount]


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResult]
    corrected: str | None = None   # the spelling that was searched instead, if the typed one matched nothing
    hint: str | None = None


class Paper(BaseModel):
    key: str
    title: str | None
    year: int | None
    type: Literal["article", "inproceedings"]
    venue: str


class CoAuthor(BaseModel):
    id: int
    name: str
    shared: int


class Profile(BaseModel):
    id: int
    name: str
    n_papers: int
    first_year: int | None
    last_year: int | None
    n_articles: int
    n_inproceedings: int
    n_coauthors: int
    n_venues: int
    per_year: list[tuple[int, int]]   # (year, papers)
    venues: list[VenueCount]
    coauthors: list[CoAuthor]
    papers: list[Paper]               # newest first; page through the rest with /api/papers


class PapersPage(BaseModel):
    papers: list[Paper]


class Status(BaseModel):
    ready: bool
    authors: int
    papers: int


# --------------------------------------------------------------------- app

app = FastAPI(
    title="DBLP dashboard API",
    description="Search researchers in the DBLP dump and read their publication profiles. Read-only.",
    version="1.0.0",
)


class IndexMissing(Exception):
    pass


@contextmanager
def index():
    """A read-only connection to the author index, closed after the request.

    Opened inside each endpoint (not as a dependency) so the connection is used
    on the thread that created it: sqlite3 forbids sharing across threads.
    """
    conn = ai.connect(INDEX_PATH)
    if conn is None:
        raise IndexMissing()
    try:
        yield conn
    finally:
        conn.close()


@app.exception_handler(IndexMissing)
async def index_missing(request: Request, exc: IndexMissing):
    return JSONResponse({"ready": False, "error": NOT_BUILT}, status_code=503)


@app.exception_handler(sqlite3.Error)
async def index_unreadable(request: Request, exc: sqlite3.Error):
    print(f"index error: {exc}")
    return JSONResponse({"error": "the author index could not be read"}, status_code=500)


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    first = exc.errors()[0]
    field = ".".join(str(part) for part in first["loc"] if part != "query")
    return JSONResponse({"error": f"invalid '{field}': {first['msg']}"}, status_code=422)


@app.middleware("http")
async def no_store_for_api(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/status", response_model=Status)
def status():
    """Whether the index is built, and how big it is."""
    with index() as conn:
        return ai.status(conn)


@app.get("/api/search", response_model=SearchResponse)
def search(q: str = Query("", max_length=500, description="Any part of a name, in any word order")):
    """Find researchers by name: accent-insensitive substring match, then close spellings."""
    with index() as conn:
        return ai.search(conn, q)


@app.get("/api/author", response_model=Profile)
def author(author_id: int = Query(ge=1, alias="id")):
    """A researcher's profile: totals, papers per year, venues, co-authors and newest papers."""
    with index() as conn:
        result = ai.profile(conn, author_id)
    if result is None:
        raise HTTPException(404, "no such author")
    return result


@app.get("/api/papers", response_model=PapersPage)
def papers(author_id: int = Query(ge=1, alias="id"),
           offset: int = Query(0, ge=0),
           limit: int = Query(50, ge=1, le=100)):
    """A page of a researcher's papers, newest first."""
    with index() as conn:
        return {"papers": ai.papers_page(conn, author_id, offset, limit)}


# ------------------------------------------------- the React app (frontend/)
# `npm run build` in frontend/ writes frontend/dist, which is served from /. In
# development run `npm run dev` instead: Vite serves the app and proxies /api here.
# This catch-all is registered last, so /api/*, /docs and /openapi.json win.

FRONTEND_DIST = ROOT / "frontend" / "dist"
APP_MEDIA_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
}
NOT_BUILT_PAGE = """<!doctype html><meta charset="utf-8"><title>Frontend not built</title>
<body style="font-family:system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>The web app hasn&rsquo;t been built yet</h1>
<p>The API is running, but there is no <code>frontend/dist</code> to serve. In the <code>frontend</code> folder run:</p>
<pre>npm install
npm run build</pre>
<p>then reload this page. For development use <code>npm run dev</code> and open <code>http://localhost:5173/</code>.
The API docs are at <a href="/docs">/docs</a>.</p></body>"""


@app.get("/{path:path}", include_in_schema=False)
def react_app(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "unknown endpoint")  # a wrong API address is an error, not the app
    index = FRONTEND_DIST / "index.html"
    if path:
        target = (FRONTEND_DIST / path).resolve()
        if target.is_file() and FRONTEND_DIST.resolve() in target.parents:
            # built assets carry a content hash in their name, so they can be cached for good
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(target, media_type=APP_MEDIA_TYPES.get(target.suffix), headers={"Cache-Control": cache})
        if Path(path).suffix:  # a file that isn't there: don't answer with the app's HTML
            raise HTTPException(404, "not found")
    if not index.is_file():
        return HTMLResponse(NOT_BUILT_PAGE, status_code=503)
    # anything else is a client-side route (e.g. /author/123): the app handles it
    return FileResponse(index, media_type=APP_MEDIA_TYPES[".html"], headers={"Cache-Control": "no-cache"})
