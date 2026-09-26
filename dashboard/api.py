"""FastAPI app: the author-search API plus the dashboard's static files.

Run it with `python server.py [port]` (or `uvicorn api:app` from this folder).
Interactive API docs are generated at /docs.

The query logic lives in author_index.py (stdlib only, unchanged); this module
only adds HTTP, validation and typed response models. Endpoints:

    GET /api/status
    GET /api/search?q=<name>
    GET /api/author?id=<author id>
    GET /api/papers?id=<author id>&offset=<n>&limit=<n>

Errors are JSON of the form {"error": "..."} (503 also carries "ready": false
when the index has not been built), which is what author-search.js expects.
Set AUTHOR_INDEX_PATH to point at a different index file.
"""
import os
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

import author_index as ai

HERE = Path(__file__).resolve().parent
INDEX_PATH = os.environ.get("AUTHOR_INDEX_PATH", ai.DB_PATH)
NOT_BUILT = "Author index not built yet. Run: python build_author_index.py"

# only these are served as static files (not the .py sources next to them)
WEB_FILES = {
    "index.html": "text/html; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "author-search.js": "text/javascript; charset=utf-8",
}
DATA_FILE = re.compile(r"[A-Za-z0-9_\-]+\.json")


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


# ------------------------------------------------------------ static files

def _static(path: Path, media_type: str) -> FileResponse:
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": "no-cache"})


@app.get("/", include_in_schema=False)
def home():
    return _static(HERE / "index.html", WEB_FILES["index.html"])


@app.get("/data/{name}", include_in_schema=False)
def data_file(name: str):
    path = HERE / "data" / name
    if not DATA_FILE.fullmatch(name) or not path.is_file():
        raise HTTPException(404, "not found")
    return _static(path, "application/json")


@app.get("/{name}", include_in_schema=False)
def web_file(name: str):
    if name not in WEB_FILES:
        raise HTTPException(404, "not found")
    return _static(HERE / name, WEB_FILES[name])
