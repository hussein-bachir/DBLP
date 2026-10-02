"""The tools the Ask agent's language model may call, and what they return.

Each tool is a JSON schema (sent to the model) plus a method on `Toolbox`,
which owns one read-only connection to authors.sqlite for one question. The
model never writes SQL: it can only call these fixed, parameterised queries.

Results are deliberately compact (free-tier providers limit tokens per
minute). Every paper a tool returns gets a reference like "P3" that stays the
same for the whole question; the model cites papers with those, and the
answer's sources are looked up from them afterwards.
"""
import time

import author_index as ai
from rag import title_search as ts

YEAR_INCOMPLETE = 2025   # DBLP is still indexing the latest years (see CLAUDE.md)
TOOL_SECONDS = 30        # a single tool call is interrupted after this long

_YEARS = {
    "year_from": {"type": "integer", "description": "Only papers from this year on."},
    "year_to": {"type": "integer", "description": "Only papers up to this year."},
    "venue": {"type": "string", "description":
              "Only one venue: a DBLP key prefix such as 'conf/nips', 'conf/icse', 'journals/tpami', "
              "or just its short name ('nips'). NeurIPS is 'nips', arXiv is 'journals/corr'."},
}

TOOLS = [
    {"type": "function", "function": {
        "name": "search_papers",
        "description": "Find papers whose TITLES match a topic, by keywords and by meaning. Use it for "
                       "'papers about X', examples, and to see what a topic looks like. Returns at most "
                       "`limit` papers with a ref (P1, P2, ...) to cite. Not for counting: use topic_stats.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description":
                      "Topic words as they would appear in a title, e.g. 'federated learning healthcare'. "
                      "Put \"double quotes\" around an exact phrase. May be empty when author_id is given "
                      "(then lists that author's newest papers)."},
            **_YEARS,
            "author_id": {"type": "integer", "description": "Only papers by this author (id from find_author)."},
            "limit": {"type": "integer", "description": "How many papers (default 12, max 25)."},
        }, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "topic_stats",
        "description": "EXACT counts of papers whose title contains EVERY word of `query` (stemmed, so "
                       "'network' also matches 'networks'), grouped by year, venue, author or type "
                       "(article = journal, inproceedings = conference). Empty query counts all papers. "
                       "Use for 'how many', trends over time, top venues/authors for a topic.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Words that must all appear in the title; may be empty."},
            "group_by": {"type": "string", "enum": ["year", "venue", "author", "type"]},
            **_YEARS,
            "author_id": {"type": "integer", "description": "Only papers by this author (id from find_author)."},
            "limit": {"type": "integer", "description": "Top N groups for venue/author (default 10, max 20)."},
        }, "required": ["query", "group_by"]}}},
    {"type": "function", "function": {
        "name": "find_author",
        "description": "Look up researchers by name (accent-insensitive, tolerates typos). Returns candidate "
                       "ids with paper counts, active years and top venues. DBLP marks different people "
                       "who share a name with a 4-digit suffix ('Wei Wang 0001'); if several match, say so.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}}, "required": ["name"]}}},
    {"type": "function", "function": {
        "name": "author_profile",
        "description": "A researcher's profile by id (from find_author): totals, papers per year, top "
                       "venues, top co-authors and newest papers (citable refs).",
        "parameters": {"type": "object", "properties": {
            "author_id": {"type": "integer"}}, "required": ["author_id"]}}},
]


def _clamp(value, low, high, default):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _filters(args):
    out = {}
    for name in ("year_from", "year_to", "author_id"):
        if args.get(name) not in (None, ""):
            out[name] = _clamp(args[name], -10**9, 10**9, None)
    if args.get("venue"):
        out["venue"] = str(args["venue"])[:60]
    return out


class Toolbox:
    """The tools for one question, and the papers/authors they have shown the model."""

    def __init__(self, conn, cancelled=lambda: False):
        self.conn = conn
        self.cancelled = cancelled
        self.refs = {}       # paper id -> "P#"
        self.papers = {}     # "P#" -> paper dict, for the sources list
        self.authors = {}    # author id -> name, for links in the answer

    def describe(self, name, args):
        """A one-line, user-facing description of a tool call, for the progress line."""
        q = (args.get("query") or "").strip()
        if name == "search_papers":
            return f"Searching titles for “{q}”" if q else "Listing the author's newest papers"
        if name == "topic_stats":
            what = f"titles containing “{q}”" if q else "all papers"
            return f"Counting {what} by {args.get('group_by', 'year')}"
        if name == "find_author":
            return f"Looking up researcher “{args.get('name', '')}”"
        if name == "author_profile":
            return "Reading a researcher's profile"
        return f"Calling {name}"

    def call(self, name, args):
        """Run one tool; always returns a JSON-able dict (errors included, for the model to see)."""
        method = getattr(self, "_" + name, None)
        if method is None or name not in {t["function"]["name"] for t in TOOLS}:
            return {"error": f"unknown tool {name}"}
        deadline = time.monotonic() + TOOL_SECONDS
        # interrupt a long query: SQLite polls this handler while it works
        self.conn.set_progress_handler(
            lambda: 1 if self.cancelled() or time.monotonic() > deadline else 0, 50_000)
        try:
            return method(args)
        except ValueError as exc:
            return {"error": str(exc)}
        except Exception as exc:  # sqlite3.OperationalError("interrupted") and friends
            if "interrupt" in str(exc):
                return {"error": "this query took too long; narrow it (fewer common words, a year range or a venue)"}
            raise
        finally:
            self.conn.set_progress_handler(None, 0)

    def _ref(self, paper):
        ref = self.refs.get(paper["id"])
        if ref is None:
            ref = f"P{len(self.refs) + 1}"
            self.refs[paper["id"]] = ref
            self.papers[ref] = paper
        return ref

    def _compact(self, paper):
        names = [a["name"] for a in paper["authors"]]
        more = paper["n_authors"] - len(names)
        return {"ref": self._ref(paper), "title": paper["title"], "year": paper["year"],
                "venue": paper["venue"], "authors": ", ".join(names) + (f" +{more} more" if more > 0 else "")}

    # ------------------------------------------------------------ the tools

    def _search_papers(self, args):
        limit = _clamp(args.get("limit"), 1, 25, 12)
        result = ts.hybrid(self.conn, str(args.get("query") or ""), limit, **_filters(args))
        return {"papers": [self._compact(p) for p in result["papers"]],
                "matched_by": result["methods"]}

    def _topic_stats(self, args):
        group_by = args.get("group_by", "year")
        if group_by not in ("year", "venue", "author", "type"):
            raise ValueError("group_by must be one of year, venue, author, type")
        result = ts.topic_stats(self.conn, str(args.get("query") or ""), group_by,
                                _clamp(args.get("limit"), 1, 20, 10), **_filters(args))
        if group_by == "author":
            for g in result["groups"]:
                self.authors[g["author_id"]] = g["key"]
        out = {"total_papers": result["total"], "groups": [[g["key"], g["count"]] for g in result["groups"]]}
        if group_by == "author":
            out["author_ids"] = [g["author_id"] for g in result["groups"]]
        years = [g["key"] for g in result["groups"]] if group_by == "year" else []
        if group_by != "year" or any(y >= YEAR_INCOMPLETE for y in years):
            out["note"] = (f"Counts for {YEAR_INCOMPLETE} and later are incomplete (DBLP is still indexing "
                           "them); don't read a drop in those years as a real decline.")
        return out

    def _find_author(self, args):
        result = ai.search(self.conn, str(args.get("name") or ""), limit=6)
        if result["hint"]:
            return {"error": result["hint"]}
        for r in result["results"]:
            self.authors[r["id"]] = r["name"]
        out = {"candidates": [{"author_id": r["id"], "name": r["name"], "papers": r["n_papers"],
                               "years": f"{r['first_year']}-{r['last_year']}",
                               "top_venues": [v["venue"] for v in r["venues"]]} for r in result["results"]]}
        if result["corrected"]:
            out["note"] = f"no exact match; showing close spellings ({result['corrected']})"
        return out

    def _author_profile(self, args):
        author_id = _clamp(args.get("author_id"), 1, 10**9, None)
        prof = ai.profile(self.conn, author_id, first_page=12) if author_id else None
        if prof is None:
            return {"error": "no author with that id; use find_author first"}
        self.authors[prof["id"]] = prof["name"]
        for c in prof["coauthors"]:
            self.authors[c["id"]] = c["name"]
        newest = ts.papers(self.conn, [i for (i,) in self.conn.execute(
            "SELECT p.id FROM authorship s JOIN papers p ON p.id = s.paper_id WHERE s.author_id = ? "
            "ORDER BY p.year IS NULL, p.year DESC, p.id DESC LIMIT 12", (prof["id"],))])
        return {
            "author_id": prof["id"], "name": prof["name"], "papers": prof["n_papers"],
            "years": f"{prof['first_year']}-{prof['last_year']}",
            "journal_articles": prof["n_articles"], "conference_papers": prof["n_inproceedings"],
            "distinct_coauthors": prof["n_coauthors"], "distinct_venues": prof["n_venues"],
            "papers_per_year": prof["per_year"],
            "top_venues": [[v["venue"], v["count"]] for v in prof["venues"]],
            "top_coauthors": [[c["name"], c["shared"]] for c in prof["coauthors"][:10]],
            "newest_papers": [self._compact(p) for p in newest],
        }
