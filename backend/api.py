"""FastAPI app: the researcher-search API and the built React app.

Run it with `python server.py [port]` (or `uvicorn api:app` from this folder).
Interactive API docs are generated at /docs.

The query logic lives in author_index.py (stdlib only, unchanged); this module
only adds HTTP, validation and typed response models. Endpoints:

    GET /api/status
    GET /api/search?q=<name>
    GET /api/author?id=<author id>
    GET /api/papers?id=<author id>&offset=<n>&limit=<n>
    GET /api/ask/status
    POST /api/ask           {"question", "provider"?, "model"?} -> server-sent events

Errors are JSON of the form {"error": "..."} (503 also carries "ready": false
when the index has not been built), which is what the front end expects.
Set AUTHOR_INDEX_PATH to point at a different index file.
"""
import json
import os
import queue
import sqlite3
import threading
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path
from typing import Annotated, Literal, Union

import anyio
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, RootModel
from starlette.exceptions import HTTPException as StarletteHTTPException

import author_index as ai
from rag import agent as rag_agent, llm, title_search as ts

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


# --- Ask (questions answered by a language model over the index; see rag/agent.py)

class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    provider: str | None = Field(None, max_length=40, description="a provider id from /api/ask/status")
    model: str | None = Field(None, max_length=120, description="any model name the provider accepts")


class LLMProvider(BaseModel):
    id: str
    label: str
    default_model: str
    models: list[str]


class AskStatus(BaseModel):
    keyword_search: bool            # papers_fts exists (rag/build_title_index.py)
    semantic_search: bool           # the title vectors are usable (rag/build_title_vectors.py)
    semantic_papers: int            # how many papers have a vector
    semantic_min_year: int | None   # the vectors cover papers from this year on (None: all years)
    semantic_error: str | None
    providers: list[LLMProvider]    # usable now; empty if no key is set and Ollama isn't running
    default_provider: str | None


class AuthorRef(BaseModel):
    id: int
    name: str


class SourcePaper(BaseModel):
    ref: str                        # "P3", as cited in the answer text
    id: int
    key: str
    title: str | None
    year: int | None
    venue: str
    type: Literal["article", "inproceedings"]
    authors: list[AuthorRef]        # at most 6, not in byline order
    n_authors: int


class AskStatusEvent(BaseModel):
    type: Literal["status"]
    text: str


class AskTokenEvent(BaseModel):
    type: Literal["token"]
    text: str


class AskRetractEvent(BaseModel):
    type: Literal["retract"]        # drop the answer text streamed so far (it was preamble to a tool call)


class AskSearchStats(BaseModel):
    methods: list[str]              # "keyword", "semantic" (or "filter" for a query-less listing)
    keyword_all: int                # candidates whose title has every query word (stops at `cap`)
    keyword_any: int | None         # candidates with some query words; None: not needed (list already full)
    semantic: int                   # nearest titles by meaning
    shown: int                      # papers returned to the model
    cap: int
    coverage: Literal["full", "partial", "none"] | None   # semantic coverage of the asked years


class AskStep(BaseModel):
    tool: str
    summary: str                    # e.g. 'Searching titles for "federated learning"'
    seconds: float
    results: int                    # papers / groups / candidates returned
    error: str | None
    search: AskSearchStats | None   # only for search_papers


class AskSearchSummary(BaseModel):
    searches: int
    methods: list[str]              # union over all searches of this answer
    coverage: Literal["full", "partial", "none"] | None   # the worst coverage of any search
    semantic_min_year: int | None   # the vectors cover papers from this year on (None: all years)


class AskTokens(BaseModel):
    prompt: int
    completion: int


class AskCitations(BaseModel):
    cited: int                      # distinct [P#] refs in the answer
    valid: int                      # refs a tool actually returned (listed as sources)
    dropped: int                    # refs the model made up


class AskTestedSearch(BaseModel):
    method: str
    precision: float                # precision@k on rag/eval.py's test queries
    queries: int | None
    min_year: int | None
    date: str | None


class AskTestedModel(BaseModel):
    correct: int                    # rag/eval.py answer checks passed
    total: int
    date: str | None


class AskTested(BaseModel):
    """Accuracy measured offline by rag/eval.py on test questions, not on this answer."""
    search: AskTestedSearch | None
    model: AskTestedModel | None


class AskDiagnostics(BaseModel):
    """How this answer was produced: timings, search use, checks, and the measured test accuracy."""
    total_seconds: float
    first_token_seconds: float | None
    model_seconds: float            # time spent waiting for the language model
    tool_seconds: float             # time spent in the database / search tools
    rounds: int                     # model calls
    tokens: AskTokens | None        # None: the provider doesn't report usage
    steps: list[AskStep]
    search: AskSearchSummary
    citations: AskCitations
    guard_nudged: bool              # the model first answered without tools and was told to retry
    retracted: int                  # streamed drafts withdrawn (preambles, answers from memory)
    declined: bool                  # the question was out of scope
    tested: AskTested | None        # None: rag/eval.py has not been run yet


class AskDoneEvent(BaseModel):
    type: Literal["done"]
    sources: list[SourcePaper]      # the papers the answer cites, in order of first citation
    authors: list[AuthorRef]        # researchers the answer names that the tools looked up
    provider: str | None
    model: str
    tool_calls: int
    diagnostics: AskDiagnostics


class AskErrorEvent(BaseModel):
    type: Literal["error"]
    message: str


class AskEvent(RootModel):
    """One server-sent event of POST /api/ask (each `data:` line is one of these, as JSON)."""
    root: Annotated[Union[AskStatusEvent, AskTokenEvent, AskRetractEvent, AskDoneEvent, AskErrorEvent],
                    Field(discriminator="type")]


# --------------------------------------------------------------------- app

@asynccontextmanager
async def lifespan(_app):
    # load the semantic-search model in the background: the server answers at once,
    # and the model is usually ready before the first question arrives
    threading.Thread(target=ts.warm_up, args=(INDEX_PATH,), daemon=True, name="search-warm-up").start()
    yield


app = FastAPI(
    lifespan=lifespan,
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


NO_TITLE_INDEX = "Title index not built yet. Run: python rag/build_title_index.py"
KEEPALIVE_SECONDS = 15


class EventStream(StreamingResponse):
    media_type = "text/event-stream"   # also what OpenAPI documents for the endpoint


@app.get("/api/ask/status", response_model=AskStatus)
def ask_status():
    """Which retrieval indexes exist and which language-model providers are usable now."""
    with index() as conn:
        vec = ts.vectors_status(conn)
        bm25 = ts.has_bm25(conn)
    providers = llm.available()
    return {"keyword_search": bm25, "semantic_search": vec["available"], "semantic_papers": vec["papers"],
            "semantic_min_year": vec["min_year"], "semantic_error": vec["error"],
            "providers": providers, "default_provider": llm.default_provider(providers)}


def _run_agent(question, provider, model, events, cancelled):
    """Worker thread: owns its own connection (sqlite3 objects can't cross threads)."""
    conn = ai.connect(INDEX_PATH)
    try:
        for event in rag_agent.answer(conn, question, provider, model, cancelled.is_set):
            events.put(event)
    except Exception as exc:  # a bug, or an unreadable index: report it in the stream
        print(f"ask error: {exc!r}")
        events.put({"type": "error", "message": "Something went wrong while answering. See the server log."})
    finally:
        conn.close()
        events.put(None)


@app.post("/api/ask", response_class=EventStream, responses={200: {
    "model": AskEvent,
    "description": "A text/event-stream: each `data:` line is one AskEvent as JSON, ending with a done or error event.",
}})
async def ask(body: AskRequest):
    """Answer a question about the dataset, streamed as server-sent events.

    A language model calls fixed search/count tools over the index (it never writes SQL) and
    cites the papers it used as [P1], [P2], ...
    """
    with index() as conn:
        if not ts.has_bm25(conn):
            return JSONResponse({"ready": False, "error": NO_TITLE_INDEX}, status_code=503)
    try:
        llm.resolve(body.provider, body.model)
    except llm.LLMUnavailable as exc:
        raise HTTPException(503 if not body.provider else 422, str(exc))

    events, cancelled = queue.Queue(), threading.Event()
    threading.Thread(target=_run_agent, daemon=True, name="ask",
                     args=(body.question, body.provider, body.model, events, cancelled)).start()

    def next_event():
        try:
            return events.get(timeout=KEEPALIVE_SECONDS)
        except queue.Empty:
            return "keepalive"

    async def stream():
        try:
            while True:
                event = await anyio.to_thread.run_sync(next_event)
                if event is None:
                    return
                if event == "keepalive":   # a comment line keeps proxies from closing a quiet stream
                    yield ": keep-alive\n\n"
                    continue
                yield "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"
        finally:   # also runs when the client disconnects: stop the worker
            cancelled.set()

    return EventStream(stream(), headers={"X-Accel-Buffering": "no"})


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
