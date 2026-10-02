"""Paper retrieval for the Ask feature: keyword, semantic and hybrid search over titles.

No HTTP here (api.py and rag_tools.py wrap it). DBLP has no abstracts, so a
paper's title plus its year, venue and authors is all there is to retrieve.

  bm25      FTS5 over titles (build_title_index.py adds `papers_fts`)
  semantic  sentence-transformer embeddings in a FAISS index
            (build_title_vectors.py writes data/processed/title_vectors/);
            optional: without it, search is keyword-only
  hybrid    both, merged with reciprocal rank fusion

Every function takes a connection to authors.sqlite (author_index.connect);
paper ids are papers.id, which the vector index uses as its ids too.
"""
import json
import os
import re
import threading
from collections import Counter

from author_index import HERE, venue_of

VECTORS_DIR = os.environ.get(
    "TITLE_VECTORS_PATH", os.path.join(HERE, "..", "data", "processed", "title_vectors"))

MAX_QUERY_CHARS = 300
FETCH = 200       # candidates taken from each method before filtering and fusion
RRF_K = 60        # the usual reciprocal-rank-fusion constant
NPROBE = 32       # IVF lists searched per query: recall vs speed

_STOPWORDS = frozenset("""a an and are as at be by for from has in into is it its of on or that the
    their this to with using via about what which who how why when where does do did papers paper
    publications research work works recent""".split())
_PHRASE = re.compile(r'"([^"]+)"')
_WORD = re.compile(r"\w+", re.UNICODE)


# ------------------------------------------------------------- keyword (BM25)

def has_bm25(conn):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'papers_fts'").fetchone() is not None


def match_expr(query, mode="any"):
    """An FTS5 query for free text, or None if it has no searchable words.

    "quoted phrases" stay phrases; other words are matched as stemmed terms
    (stop words dropped unless nothing else is left). mode="any" ORs them (for
    ranking: more matching words rank higher), mode="all" ANDs them (for
    counting: every word must be in the title). Every term is quoted, so user
    text can't inject FTS syntax.
    """
    query = query[:MAX_QUERY_CHARS]
    phrases = [_WORD.findall(p.lower()) for p in _PHRASE.findall(query)]
    words = _WORD.findall(_PHRASE.sub(" ", query).lower())
    kept = [w for w in words if w not in _STOPWORDS] or words
    terms = ['"%s"' % " ".join(p) for p in phrases if p] + ['"%s"' % w for w in dict.fromkeys(kept)]
    if not terms:
        return None
    return (" OR " if mode == "any" else " AND ").join(terms)


def _filters(year_from=None, year_to=None, venue=None, author_id=None, alias="p"):
    """SQL conditions (joined with AND, possibly empty) and their parameters.

    venue is a DBLP key prefix ("conf/nips", "journals/tpami") or just its
    short name ("nips"); author_id is an authors.id.
    """
    where, params = [], []
    if year_from is not None:
        where.append(f"{alias}.year >= ?")
        params.append(int(year_from))
    if year_to is not None:
        where.append(f"{alias}.year <= ?")
        params.append(int(year_to))
    if venue:
        venue = venue.strip().strip("/").lower()
        if "/" in venue:   # a DBLP prefix such as conf/nips or journals/tpami
            where.append(f"{alias}.key LIKE ?")
            params.append(venue + "/%")
        else:              # a bare short name such as nips or tpami
            where.append(f"{alias}.key LIKE ?")
            params.append("%/" + venue + "/%")
    if author_id is not None:
        where.append(f"{alias}.id IN (SELECT paper_id FROM authorship WHERE author_id = ?)")
        params.append(int(author_id))
    return where, params


def bm25(conn, query, k=FETCH, mode="any", **filters):
    """Paper ids, best keyword match first. mode: see match_expr; filters: see _filters."""
    expr = match_expr(query, mode)
    if expr is None:
        return []
    where, params = _filters(**filters)
    sql = ("SELECT papers_fts.rowid FROM papers_fts JOIN papers p ON p.id = papers_fts.rowid "
           "WHERE papers_fts MATCH ?" + "".join(" AND " + w for w in where) +
           " ORDER BY papers_fts.rank LIMIT ?")
    return [r[0] for r in conn.execute(sql, [expr, *params, k])]


# ---------------------------------------------------------- semantic (FAISS)

class _Vectors:
    """The embedding model and FAISS index, loaded once per process on first use."""

    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()
        self._loaded = False
        self.index = self.model = self.meta = None
        self.error = None

    def meta_on_disk(self):
        try:
            with open(os.path.join(self.path, "meta.json"), encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            return None
        return meta if meta.get("complete") and os.path.exists(os.path.join(self.path, "index.faiss")) else None

    def load(self, built_at):
        """True if usable. `built_at` is authors.sqlite's, which the vector ids must match."""
        with self._lock:
            if not self._loaded:
                self._loaded = True
                self._load(built_at)
            return self.index is not None

    def _load(self, built_at):
        meta = self.meta_on_disk()
        if meta is None:
            return
        if meta.get("index_built_at") != built_at:
            self.error = ("title vectors were built from a different authors.sqlite; "
                          "re-run build_title_vectors.py")
            print("title vectors:", self.error)
            return
        try:
            import faiss
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            self.error = f"semantic search needs {exc.name} (pip install -r requirements.txt)"
            print("title vectors:", self.error)
            return
        index = faiss.read_index(os.path.join(self.path, "index.faiss"))
        if hasattr(index, "nprobe"):
            index.nprobe = NPROBE
        self.model = SentenceTransformer(meta["model"], device=pick_device())
        self.index, self.meta = index, meta

    def search(self, query, k):
        vec = self.model.encode([query], normalize_embeddings=True, convert_to_numpy=True)
        with self._lock:  # FAISS search is thread-safe, but keep the model calls serialized
            _, ids = self.index.search(vec.astype("float32"), k)
        return [int(i) for i in ids[0] if i >= 0]


def pick_device():
    """cuda if a GPU is usable, then Apple's mps, else cpu."""
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


_vectors = _Vectors(VECTORS_DIR)


def _index_built_at(conn):
    row = conn.execute("SELECT v FROM meta WHERE k = 'built_at'").fetchone()
    return row[0] if row else None


def vectors_status(conn):
    """{"available": bool, "papers": n, "min_year": y | None, "error": str | None} without loading anything."""
    meta = _vectors.meta_on_disk()
    if meta is None:
        return {"available": False, "papers": 0, "min_year": None, "error": None}
    if meta.get("index_built_at") != _index_built_at(conn):
        return {"available": False, "papers": 0, "min_year": None,
                "error": "title vectors are out of date; re-run build_title_vectors.py"}
    return {"available": _vectors.error is None, "papers": meta["papers"],
            "min_year": meta.get("min_year"), "error": _vectors.error}


def semantic(conn, query, k=FETCH, **filters):
    """Paper ids, closest in meaning first; [] if there is no vector index.

    Filters are applied to the nearest k*5 neighbours, so a narrow filter can
    leave few results; keyword search covers the rest in hybrid().
    """
    query = query[:MAX_QUERY_CHARS].strip()
    if not query or not _vectors.load(_index_built_at(conn)):
        return []
    where, params = _filters(**filters)
    ids = _vectors.search(query, k * 5 if where else k)
    if not where or not ids:
        return ids[:k]
    keep = {r[0] for r in conn.execute(
        "SELECT p.id FROM papers p WHERE p.id IN (%s) AND %s" % (",".join("?" * len(ids)), " AND ".join(where)),
        [*ids, *params])}
    return [i for i in ids if i in keep][:k]


# ------------------------------------------------------------------- hybrid

def rrf(*rankings, k=RRF_K):
    """Reciprocal rank fusion: ids ordered by sum(1 / (k + rank)) over the rankings."""
    scores = Counter()
    for ranking in rankings:
        for rank, pid in enumerate(ranking, 1):
            scores[pid] += 1.0 / (k + rank)
    return [pid for pid, _ in sorted(scores.items(), key=lambda kv: -kv[1])]


def papers(conn, ids, max_authors=6):
    """Title, year, venue and authors for each id, in the given order.

    The index does not keep authors in byline order, so `authors` is the set of
    a paper's authors, not its author list.
    """
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    rows = {r[0]: r for r in conn.execute(
        f"SELECT id, key, title, year, type FROM papers WHERE id IN ({marks})", ids)}
    people = {}
    for pid, aid, name in conn.execute(
            f"SELECT s.paper_id, a.id, a.name FROM authorship s JOIN authors a ON a.id = s.author_id "
            f"WHERE s.paper_id IN ({marks})", ids):
        people.setdefault(pid, []).append({"id": aid, "name": name})
    out = []
    for pid in ids:
        if pid not in rows:
            continue
        _, key, title, year, kind = rows[pid]
        authors = people.get(pid, [])
        out.append({"id": pid, "key": key, "title": title, "year": year, "venue": venue_of(key),
                    "type": "inproceedings" if kind else "article",
                    "authors": authors[:max_authors], "n_authors": len(authors)})
    return out


def recent(conn, k=20, **filters):
    """Paper ids matching the filters, newest first (a search without a query)."""
    where, params = _filters(**filters)
    cond = (" WHERE " + " AND ".join(where)) if where else ""
    return [r[0] for r in conn.execute(
        f"SELECT p.id FROM papers p{cond} ORDER BY p.year IS NULL, p.year DESC, p.id DESC LIMIT ?",
        [*params, k])]


def hybrid(conn, query, k=20, **filters):
    """{"papers": [...], "methods": [...]}: the best k papers by keyword and meaning together.

    Keyword search votes in the fusion only with titles that contain EVERY
    query word: titles sharing one loose word ("model", "data") are noise for
    a question phrased in other words, and fusing them in pulled precision
    below semantic search alone (rag_eval.py: 0.62 vs 0.68; with this rule
    0.68). Titles matching only some words still fill the list after the fused
    ones, which is how papers without a vector (older than the vectors'
    --min-year) are found. Without vectors this is plain keyword ranking.
    An empty query lists the newest papers matching the filters instead.
    """
    if not (query or "").strip():
        return {"papers": papers(conn, recent(conn, k, **filters)), "methods": ["filter"]}
    methods, any_words, all_words = [], [], []
    if has_bm25(conn):
        all_words = bm25(conn, query, FETCH, mode="all", **filters)
        any_words = bm25(conn, query, FETCH, mode="any", **filters)
        methods.append("keyword")
    sem = semantic(conn, query, FETCH, **filters)
    if sem:
        methods.append("semantic")
        ranked = rrf(all_words, sem) if all_words else sem
    else:
        ranked = all_words
    ranked = list(dict.fromkeys([*ranked[:k], *any_words]))   # partial matches only fill up
    return {"papers": papers(conn, ranked[:k]), "methods": methods}


# ------------------------------------------------------------- aggregates

def topic_stats(conn, query="", group_by="year", limit=20, **filters):
    """Exact counts of papers whose title contains every word of `query` (all papers if empty).

    group_by: "year" (every year, in order), "venue", "author" or "type"
    (top `limit`, largest first). Returns {"total", "groups": [{"key", "count"}],
    "match"}; "match" is the FTS expression used, or None for all papers.
    """
    expr = match_expr(query, "all") if query and query.strip() else None
    if query and query.strip() and expr is None:
        return {"total": 0, "groups": [], "match": None}
    where, params = _filters(**filters)
    if expr is not None:
        source = "papers_fts JOIN papers p ON p.id = papers_fts.rowid"
        where = ["papers_fts MATCH ?", *where]
        params = [expr, *params]
    else:
        source = "papers p"
    cond = (" WHERE " + " AND ".join(where)) if where else ""

    total = conn.execute(f"SELECT COUNT(*) FROM {source}{cond}", params).fetchone()[0]
    if group_by == "year":
        groups = [{"key": y, "count": c} for y, c in conn.execute(
            f"SELECT p.year, COUNT(*) FROM {source}{cond} GROUP BY p.year ORDER BY p.year", params)
            if y is not None]
    elif group_by == "type":
        groups = [{"key": "inproceedings" if t else "article", "count": c} for t, c in conn.execute(
            f"SELECT p.type, COUNT(*) FROM {source}{cond} GROUP BY p.type ORDER BY 2 DESC", params)]
    elif group_by == "venue":
        counts = Counter(venue_of(k) for (k,) in conn.execute(f"SELECT p.key FROM {source}{cond}", params))
        groups = [{"key": v, "count": c} for v, c in counts.most_common(limit)]
    elif group_by == "author":
        if expr is None and not where:   # every paper: the per-author totals are precomputed
            rows = conn.execute("SELECT id, name, n_papers FROM authors ORDER BY n_papers DESC LIMIT ?", (limit,))
        else:
            rows = conn.execute(
                f"SELECT a.id, a.name, COUNT(*) AS n FROM {source} JOIN authorship s ON s.paper_id = p.id "
                f"JOIN authors a ON a.id = s.author_id{cond} GROUP BY s.author_id ORDER BY n DESC LIMIT ?",
                [*params, limit])
        groups = [{"key": name, "author_id": aid, "count": c} for aid, name, c in rows]
    else:
        raise ValueError(f"unknown group_by {group_by!r}")
    return {"total": total, "groups": groups, "match": expr}
