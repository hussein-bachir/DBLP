"""Query layer for the author search index that build_author_index.py creates.

Stdlib only. Used by server.py (and by build_author_index.py for fold()).

Searching works on a "folded" name: lower-case, accents stripped, punctuation
turned into spaces, and DBLP's trailing disambiguation number ("Hussein Hazimeh
0001") removed. A trigram full-text index makes any typed fragment match
anywhere in a name, in any word order; if nothing matches, close spellings of
each word are tried so a slip like "Kenaan" still finds "Kanaan".
"""
import difflib
import os
import re
import sqlite3
import unicodedata
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "..", "data", "processed", "authors.sqlite")

_EXTRA_LETTERS = str.maketrans({
    "ł": "l", "Ł": "l", "ø": "o", "Ø": "o", "đ": "d", "Đ": "d", "ð": "d",
    "ß": "ss", "æ": "ae", "Æ": "ae", "œ": "oe", "Œ": "oe", "ı": "i", "þ": "th",
})
_SUFFIX = re.compile(r"\s+\d{4}$")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")

MAX_QUERY_CHARS = 100
MMAP_BYTES = 4 * 1024**3   # asks for the whole file (~2.8 GB); SQLite caps it at its build's maximum (~2 GB here)
MAX_QUERY_TOKENS = 5


def fold(name):
    name = _SUFFIX.sub("", name)
    decomposed = unicodedata.normalize("NFKD", name.translate(_EXTRA_LETTERS))
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c)).lower()
    return _NON_ALNUM.sub(" ", stripped).strip()


def venue_of(key):
    parts = key.split("/")
    return parts[0] + "/" + parts[1] if len(parts) >= 2 else key


def connect(path=DB_PATH):
    if not os.path.exists(path):
        return None
    conn = sqlite3.connect("file:" + os.path.abspath(path).replace("\\", "/") + "?mode=ro", uri=True, timeout=10)
    conn.execute("PRAGMA query_only = ON")
    # Read the file through the OS page cache instead of copying pages into each
    # connection's own small cache: every request opens a new connection, so that
    # cache always started empty. The mapping only reserves address space.
    conn.execute(f"PRAGMA mmap_size = {MMAP_BYTES}")
    return conn


def status(conn):
    meta = dict(conn.execute("SELECT k, v FROM meta"))
    return {"ready": True, "authors": int(meta["authors"]), "papers": int(meta["papers"])}


# ---------------------------------------------------------------- search

def _candidates(conn, tokens, cap):
    """Authors whose folded name contains every token (substring, any order)."""
    long_tokens = [t for t in tokens if len(t) >= 3]
    if not long_tokens:
        return []
    # tokens are [a-z0-9] only (see fold), so quoting them is enough to keep
    # the FTS query well-formed
    expr = " AND ".join('"%s"' % t for t in long_tokens)
    rows = conn.execute(
        "SELECT id, name, fold, n_papers, first_year, last_year FROM authors "
        "WHERE id IN (SELECT rowid FROM authors_fts WHERE authors_fts MATCH ?) "
        "ORDER BY n_papers DESC LIMIT ?", (expr, cap)).fetchall()
    short = [t for t in tokens if len(t) < 3]
    if short:  # e.g. an initial: it can't use the trigram index, so filter here
        rows = [r for r in rows
                if all(any(w.startswith(s) for w in r[2].split()) for s in short)]
    return rows


def _tier(row, tokens, full):
    folded = row[2]
    words = folded.split()
    if folded == full:
        return 0
    if all(t in words for t in tokens):
        return 1
    if all(any(w.startswith(t) for w in words) for t in tokens):
        return 2
    return 3


def _token_variants(conn, token, keep=60, cutoff=0.72):
    """{spelling: similarity} for words in the index that look like `token`.

    Many look-alike words tie on similarity, so keep plenty of them rather than
    an arbitrary handful: the other typed words narrow the candidates anyway.
    """
    variants = {}
    if conn.execute("SELECT 1 FROM tokens WHERE tok = ?", (token,)).fetchone():
        variants[token] = 1.0
    if len(token) >= 4:
        pool = dict(conn.execute(
            "SELECT tok, n FROM tokens WHERE c1 = ? AND len BETWEEN ? AND ?",
            (token[0], len(token) - 1, len(token) + 1)))
        close = {}
        for cand in difflib.get_close_matches(token, list(pool), n=500, cutoff=cutoff):
            if cand != token:
                close[cand] = difflib.SequenceMatcher(None, token, cand).ratio()
        best = sorted(close.items(), key=lambda kv: (-kv[1], -pool[kv[0]]))
        variants.update(best[:keep])
    return variants or {token: 1.0}


def _word_similarity(word, variants):
    if word in variants:
        return variants[word]
    # the trigram index matches substrings, so credit a word that contains a variant
    return max((r for v, r in variants.items() if v in word), default=0.0) * 0.95


def _fuzzy(conn, tokens, cap=2000):
    """Authors whose names resemble the typed words, best resemblance first.

    Every spelling of every word goes into ONE full-text query (OR inside AND);
    candidates are then scored here, so a capped result set can't push the
    intended (often rare) name out.
    """
    variants = [_token_variants(conn, t) for t in tokens]
    groups = ["(" + " OR ".join('"%s"' % v for v in vs) + ")"
              for t, vs in zip(tokens, variants) if len(t) >= 3]
    if not groups:
        return []
    rows = conn.execute(
        "SELECT id, name, fold, n_papers, first_year, last_year FROM authors "
        "WHERE id IN (SELECT rowid FROM authors_fts WHERE authors_fts MATCH ?) "
        "ORDER BY n_papers DESC LIMIT ?", (" AND ".join(groups), cap)).fetchall()
    scored = []
    for row in rows:
        words = row[2].split()
        best_words, score = [], 1.0
        for t, vs in zip(tokens, variants):
            if len(t) < 3:
                if not any(w.startswith(t) for w in words):
                    score = 0.0
                    break
                best_words.append(t)
                continue
            sim, word = max(((_word_similarity(w, vs), w) for w in words), default=(0.0, t))
            score *= sim
            best_words.append(word)
        if score > 0:
            scored.append((score, row, " ".join(best_words)))
    scored.sort(key=lambda s: (-s[0], -s[1][3]))
    return [(row, corrected) for _, row, corrected in scored]


def _top_venues(conn, author_id, n=3):
    counts = Counter(venue_of(k) for (k,) in conn.execute(
        "SELECT p.key FROM authorship s JOIN papers p ON p.id = s.paper_id WHERE s.author_id = ?",
        (author_id,)))
    return [{"venue": v, "count": c} for v, c in counts.most_common(n)]


def _result(conn, row):
    return {"id": row[0], "name": row[1], "n_papers": row[3],
            "first_year": row[4], "last_year": row[5], "venues": _top_venues(conn, row[0])}


def search(conn, query, limit=15):
    query = query[:MAX_QUERY_CHARS]
    full = fold(query)
    tokens = full.split()[:MAX_QUERY_TOKENS]
    out = {"query": query, "results": [], "corrected": None, "hint": None}
    if not any(len(t) >= 3 for t in tokens):
        out["hint"] = "Type at least 3 letters of a name."
        return out

    rows = _candidates(conn, tokens, 400)
    if rows:
        rows = sorted(rows, key=lambda r: (_tier(r, tokens, full), -r[3]))[:limit]
        out["results"] = [_result(conn, r) for r in rows]
        return out

    fuzzy = _fuzzy(conn, tokens)[:limit]
    if fuzzy:
        out["corrected"] = fuzzy[0][1]
        out["results"] = [_result(conn, row) for row, _ in fuzzy]
    return out


# --------------------------------------------------------------- profile

def _paper(row):
    key, title, year, kind = row
    return {"key": key, "title": title, "year": year,
            "type": "inproceedings" if kind else "article", "venue": venue_of(key)}


def papers_page(conn, author_id, offset=0, limit=50):
    rows = conn.execute(
        "SELECT p.key, p.title, p.year, p.type FROM authorship s JOIN papers p ON p.id = s.paper_id "
        "WHERE s.author_id = ? ORDER BY p.year IS NULL, p.year DESC, p.id DESC LIMIT ? OFFSET ?",
        (author_id, limit, offset)).fetchall()
    return [_paper(r) for r in rows]


def profile(conn, author_id, first_page=50):
    author = conn.execute(
        "SELECT id, name, n_papers, first_year, last_year FROM authors WHERE id = ?",
        (author_id,)).fetchone()
    if author is None:
        return None
    rows = conn.execute(
        "SELECT p.key, p.year, p.type FROM authorship s JOIN papers p ON p.id = s.paper_id "
        "WHERE s.author_id = ?", (author_id,)).fetchall()
    per_year = Counter(y for _, y, _ in rows if y is not None)
    venues = Counter(venue_of(k) for k, _, _ in rows)
    n_inproc = sum(1 for _, _, t in rows if t)
    coauthors = conn.execute(
        "SELECT a.id, a.name, COUNT(*) AS shared FROM authorship s1 "
        "JOIN authorship s2 ON s2.paper_id = s1.paper_id AND s2.author_id <> s1.author_id "
        "JOIN authors a ON a.id = s2.author_id WHERE s1.author_id = ? "
        "GROUP BY s2.author_id ORDER BY shared DESC, a.n_papers DESC LIMIT 12",
        (author_id,)).fetchall()
    n_coauthors = conn.execute(
        "SELECT COUNT(DISTINCT s2.author_id) FROM authorship s1 "
        "JOIN authorship s2 ON s2.paper_id = s1.paper_id AND s2.author_id <> s1.author_id "
        "WHERE s1.author_id = ?", (author_id,)).fetchone()[0]
    return {
        "id": author[0], "name": author[1], "n_papers": author[2],
        "first_year": author[3], "last_year": author[4],
        "n_articles": len(rows) - n_inproc, "n_inproceedings": n_inproc,
        "n_coauthors": n_coauthors, "n_venues": len(venues),
        "per_year": sorted(per_year.items()),
        "venues": [{"venue": v, "count": c} for v, c in venues.most_common(10)],
        "coauthors": [{"id": i, "name": n, "shared": s} for i, n, s in coauthors],
        "papers": papers_page(conn, author_id, 0, first_page),
    }
