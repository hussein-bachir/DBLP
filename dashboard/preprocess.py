"""Aggregate dblp_full.csv (every article/inproceedings record, all years) into
small JSON files under data/ for the client-side dashboard. The raw CSV has
millions of rows and can't be loaded in the browser, so every heavy
computation (author counts, the co-authorship network, keyword trends...)
happens here, once, with pandas/networkx.

The CSV is streamed in chunks (twice: once for all the counters, once for the
co-authorship edges, which need the global top-N authors first) so memory stays
bounded even at ~8.4M rows.

Mirrors the logic in the ../scripts/analyze_*.py / visualize_dblp*.py
scripts, but writes JSON instead of matplotlib PNGs.
"""
import json
import os
import re
import time
from collections import Counter, defaultdict
from itertools import combinations

import networkx as nx
import pandas as pd

from author_index import repair_text

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "..", "data", "processed", "dblp_full.csv")
OUT_DIR = os.path.join(HERE, "data")
# Upper bound trims the still-being-indexed tail (2026 partial, 2027 "to
# appear"), see CONTEXT.md. Lower bound is just "everything".
YEAR_MIN, YEAR_MAX = 1900, 2025
CHUNK_ROWS = 500_000
TOP_N_AUTHORS = 20
TOP_N_VENUES = 20
TOP_N_WORDS = 30
TOP_N_NETWORK_AUTHORS = 150

VENUES_TO_COMPARE = {
    "conf/cvpr": "Computer Vision (CVPR)",
    "conf/acl": "NLP (ACL)",
    "conf/cdc": "Control Theory (CDC)",
    "conf/sigir": "Information Retrieval (SIGIR)",
    "journals/remotesensing": "Remote Sensing (journal)",
}

TOPIC_KEYWORDS = ["neural", "transformer", "blockchain", "quantum",
                  "privacy", "robot", "graph", "large language"]
TOPIC_PATTERNS = {
    kw: r'\b' + kw.replace(' ', r'\s+') + r'\b' for kw in TOPIC_KEYWORDS
}

STOPWORDS = set("""
a an the of for on in to and with using towards from by via approach based
study analysis review survey new novel systems system model models method
methods framework case into over under between across
""".split())
WORD_RE = re.compile(r"[a-zA-Z']+")
VENUE_RE = r'^([^/]+/[^/]+)'


def save(name, obj):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    print(f"  wrote {path}")


def split_authors(s):
    # dblp_full.csv has UTF-8 names decoded as Latin-1 ("MÃ©rouane"); repair
    # them BEFORE stripping (a trailing "à" is "Ã" + a non-breaking space)
    return [name for name in (repair_text(a).strip() for a in s.split(';')) if name]


def read_chunks(usecols, stats=None):
    """Yield year-filtered chunks. `stats` (a dict) accumulates rows read/kept."""
    for chunk in pd.read_csv(CSV_PATH, usecols=usecols, chunksize=CHUNK_ROWS, dtype=str):
        year = pd.to_numeric(chunk['year'], errors='coerce')
        keep = year.between(YEAR_MIN, YEAR_MAX)
        if stats is not None:
            stats['read'] += len(chunk)
            stats['kept'] += int(keep.sum())
        yield chunk[keep].assign(year=year[keep].astype(int))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    started = time.time()

    year_counts = Counter()
    type_counts = Counter()
    coauthor_dist = Counter()
    team_size_sum = Counter()
    team_size_n = Counter()
    author_counter = Counter()
    venue_counter = Counter()
    venues_by_year = defaultdict(set)
    word_counter = Counter()
    topic_counts = {kw: Counter() for kw in TOPIC_KEYWORDS}
    venue_year_counts = {v: Counter() for v in VENUES_TO_COMPARE}
    stats = {'read': 0, 'kept': 0}

    print(f"Pass 1/2: counters from {CSV_PATH}")
    for i, chunk in enumerate(read_chunks(['type', 'key', 'title', 'year', 'authors'], stats), 1):
        author_lists = [split_authors(s) for s in chunk['authors'].fillna("")]
        n_authors = pd.Series([len(lst) for lst in author_lists], index=chunk.index)
        for lst in author_lists:
            author_counter.update(lst)

        year_counts.update(chunk['year'].value_counts().to_dict())
        type_counts.update(chunk['type'].value_counts().to_dict())
        coauthor_dist.update(n_authors.value_counts().to_dict())
        grouped = n_authors.groupby(chunk['year']).agg(['sum', 'count'])
        for y, row in grouped.iterrows():
            team_size_sum[y] += int(row['sum'])
            team_size_n[y] += int(row['count'])

        venue = chunk['key'].str.extract(VENUE_RE)[0]
        venue_counter.update(venue.dropna().value_counts().to_dict())
        vy = pd.DataFrame({'year': chunk['year'], 'venue': venue}).dropna().drop_duplicates()
        for y, v in zip(vy['year'], vy['venue']):
            venues_by_year[y].add(v)
        compared = venue.isin(list(VENUES_TO_COMPARE))
        for (v, y), c in chunk[compared].groupby([venue[compared], 'year']).size().items():
            venue_year_counts[v][y] += int(c)

        titles = chunk['title'].fillna("").str.lower()
        for t in titles:
            word_counter.update(w for w in WORD_RE.findall(t) if len(w) > 2 and w not in STOPWORDS)
        for kw, pattern in TOPIC_PATTERNS.items():
            hits = chunk[titles.str.contains(pattern, regex=True)]
            topic_counts[kw].update(hits['year'].value_counts().to_dict())

        print(f"  chunk {i}: {stats['read']:,} rows read, {stats['kept']:,} kept "
              f"({(time.time() - started) / 60:.1f} min)")

    all_years = sorted(year_counts)
    print(f"{stats['kept']:,} records in {all_years[0]}-{all_years[-1]} "
          f"({stats['read'] - stats['kept']:,} excluded outside {YEAR_MIN}-{YEAR_MAX})")

    # ---------- overview ----------
    print("Writing JSON...")
    save("overview.json", {
        "total_records": stats['kept'],
        "excluded_records": stats['read'] - stats['kept'],
        "year_min": int(all_years[0]),
        "year_max": int(all_years[-1]),
        "distinct_authors": len(author_counter),
        "distinct_venues": len(venue_counter),
    })

    save("publications_per_year.json", [
        {"year": int(y), "count": int(year_counts[y])} for y in all_years
    ])
    save("type_distribution.json", [
        {"type": t, "count": int(c)} for t, c in type_counts.most_common()
    ])
    save("top_authors.json", [
        {"name": n, "count": c} for n, c in author_counter.most_common(TOP_N_AUTHORS)
    ])
    save("coauthor_distribution.json", [
        {"n_authors": int(k), "count": int(coauthor_dist[k])}
        for k in sorted(coauthor_dist) if 1 <= k <= 20
    ])
    save("top_venues.json", [
        {"venue": v, "count": int(c)} for v, c in venue_counter.most_common(TOP_N_VENUES)
    ])

    paper_counts_per_author = pd.Series(author_counter, dtype="int64")
    bins = [0, 1, 2, 3, 5, 10, 20, max(int(paper_counts_per_author.max()), 21)]
    labels = ["1", "2", "3", "4-5", "6-10", "11-20", "20+"]
    bucketed = pd.cut(paper_counts_per_author, bins=bins, labels=labels, include_lowest=True)
    bucket_counts = bucketed.value_counts().reindex(labels).fillna(0)
    save("author_productivity.json", [
        {"bucket": str(b), "count": int(c)} for b, c in bucket_counts.items()
    ])

    save("avg_team_size_by_year.json", [
        {"year": int(y), "avg_authors": round(team_size_sum[y] / team_size_n[y], 3)}
        for y in all_years
    ])
    save("venues_per_year.json", [
        {"year": int(y), "distinct_venues": len(venues_by_year[y])} for y in all_years
    ])
    save("top_title_words.json", [
        {"word": w, "count": c} for w, c in word_counter.most_common(TOP_N_WORDS)
    ])

    save("topic_trends.json", {
        "years": [int(y) for y in all_years],
        "series": {
            kw: [round(topic_counts[kw][y] / year_counts[y] * 100, 3) for y in all_years]
            for kw in TOPIC_KEYWORDS
        },
    })
    save("venue_comparison.json", {
        "years": [int(y) for y in all_years],
        "series": {
            label: [int(venue_year_counts[key][y]) for y in all_years]
            for key, label in VENUES_TO_COMPARE.items()
        },
    })

    # ---------- co-authorship network (pass 2: needs global top-N first) ----------
    print(f"Pass 2/2: co-authorship network (top {TOP_N_NETWORK_AUTHORS} authors)...")
    top_network_authors = set(a for a, _ in author_counter.most_common(TOP_N_NETWORK_AUTHORS))
    edge_weights = Counter()
    for chunk in read_chunks(['year', 'authors']):
        for s in chunk['authors'].fillna(""):
            filtered = sorted(set(a for a in split_authors(s) if a in top_network_authors))
            if len(filtered) >= 2:
                edge_weights.update(combinations(filtered, 2))

    G = nx.Graph()
    G.add_nodes_from(top_network_authors)
    for (a, b), w in edge_weights.items():
        G.add_edge(a, b, weight=w)

    degree_centrality = nx.degree_centrality(G)
    communities = list(nx.community.greedy_modularity_communities(G, weight='weight'))
    community_map = {n: i for i, comm in enumerate(communities) for n in comm}

    save("coauthor_network.json", {
        "nodes": [
            {
                "id": n,
                "papers": author_counter[n],
                "group": community_map.get(n, -1),
                "degree": round(degree_centrality.get(n, 0), 4),
            }
            for n in G.nodes()
        ],
        "edges": [
            {"source": a, "target": b, "weight": w}
            for a, b, w in G.edges(data='weight')
        ],
        "n_communities": len(communities),
    })

    print(f"\nAll JSON files written to {OUT_DIR} in {(time.time() - started) / 60:.1f} min")


if __name__ == "__main__":
    main()
