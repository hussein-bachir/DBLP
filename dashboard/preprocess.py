"""Aggregate dblp_after_2018.csv into small JSON files under data/ for the
client-side dashboard. The raw CSV has millions of rows and can't be loaded
in the browser, so every heavy computation (author counts, the co-authorship
network, keyword trends...) happens here, once, with pandas/networkx.

Mirrors the logic already validated in the ../scripts/analyze_*.py /
visualize_dblp*.py scripts, but writes JSON instead of matplotlib PNGs.
"""
import json
import os
import re
from collections import Counter
from itertools import combinations

import networkx as nx
import pandas as pd

CSV_PATH = os.path.join("..", "data", "processed", "dblp_after_2018.csv")
OUT_DIR = "data"
YEAR_MIN, YEAR_MAX = 2019, 2025  # trims the DBLP-indexing-lag tail, see CONTEXT.md
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

STOPWORDS = set("""
a an the of for on in to and with using towards from by via approach based
study analysis review survey new novel systems system model models method
methods framework case into over under between across
""".split())


def save(name, obj):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    print(f"  wrote {path}")


def extract_venue(key):
    if not isinstance(key, str):
        return None
    parts = key.split('/')
    if len(parts) >= 2:
        return f"{parts[0]}/{parts[1]}"
    return None


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"Loading {CSV_PATH} ...")
    df = pd.read_csv(CSV_PATH)
    df['year'] = pd.to_numeric(df['year'], errors='coerce')
    df = df[(df['year'] >= YEAR_MIN) & (df['year'] <= YEAR_MAX)].copy()
    df['year'] = df['year'].astype(int)
    df['venue'] = df['key'].apply(extract_venue)
    df['author_list'] = df['authors'].fillna("").apply(
        lambda s: [a.strip() for a in s.split(';') if a.strip()]
    )
    df['n_authors'] = df['author_list'].apply(len)
    print(f"{len(df)} records in {YEAR_MIN}-{YEAR_MAX}")

    all_years = sorted(df['year'].unique().tolist())

    author_counter = Counter()
    for lst in df['author_list']:
        author_counter.update(lst)

    # ---------- overview ----------
    print("Overview...")
    save("overview.json", {
        "total_records": int(len(df)),
        "year_min": int(df['year'].min()),
        "year_max": int(df['year'].max()),
        "distinct_authors": len(author_counter),
        "distinct_venues": int(df['venue'].nunique()),
    })

    # ---------- publications per year ----------
    print("Publications per year...")
    year_counts = df.groupby('year').size().sort_index()
    save("publications_per_year.json", [
        {"year": int(y), "count": int(c)} for y, c in year_counts.items()
    ])

    # ---------- type distribution ----------
    print("Type distribution...")
    type_counts = df['type'].value_counts()
    save("type_distribution.json", [
        {"type": t, "count": int(c)} for t, c in type_counts.items()
    ])

    # ---------- top authors ----------
    print("Top authors...")
    top_authors = author_counter.most_common(TOP_N_AUTHORS)
    save("top_authors.json", [{"name": n, "count": c} for n, c in top_authors])

    # ---------- co-author count distribution ----------
    print("Co-author distribution...")
    dist = df['n_authors'].value_counts().sort_index()
    dist = dist[dist.index.to_series().between(1, 20)]
    save("coauthor_distribution.json", [
        {"n_authors": int(k), "count": int(v)} for k, v in dist.items()
    ])

    # ---------- top venues ----------
    print("Top venues...")
    venue_counts = df['venue'].value_counts().head(TOP_N_VENUES)
    save("top_venues.json", [
        {"venue": v, "count": int(c)} for v, c in venue_counts.items()
    ])

    # ---------- author productivity buckets ----------
    print("Author productivity...")
    paper_counts_per_author = pd.Series(author_counter, dtype="int64")
    bins = [0, 1, 2, 3, 5, 10, 20, max(int(paper_counts_per_author.max()), 21)]
    labels = ["1", "2", "3", "4-5", "6-10", "11-20", "20+"]
    bucketed = pd.cut(paper_counts_per_author, bins=bins, labels=labels, include_lowest=True)
    bucket_counts = bucketed.value_counts().reindex(labels).fillna(0)
    save("author_productivity.json", [
        {"bucket": str(b), "count": int(c)} for b, c in bucket_counts.items()
    ])

    # ---------- avg team size by year ----------
    print("Avg team size by year...")
    team_size_by_year = df.groupby('year')['n_authors'].mean().sort_index()
    save("avg_team_size_by_year.json", [
        {"year": int(y), "avg_authors": round(float(v), 3)}
        for y, v in team_size_by_year.items()
    ])

    # ---------- distinct venues per year ----------
    print("Distinct venues per year...")
    venues_by_year = df.groupby('year')['venue'].nunique().sort_index()
    save("venues_per_year.json", [
        {"year": int(y), "distinct_venues": int(v)}
        for y, v in venues_by_year.items()
    ])

    # ---------- top title words ----------
    print("Top title words...")
    word_counter = Counter()
    for title in df['title'].dropna():
        for w in re.findall(r"[a-zA-Z']+", title.lower()):
            if len(w) > 2 and w not in STOPWORDS:
                word_counter[w] += 1
    save("top_title_words.json", [
        {"word": w, "count": c} for w, c in word_counter.most_common(TOP_N_WORDS)
    ])

    # ---------- topic trends ----------
    print("Topic trends...")
    df['title_lower'] = df['title'].fillna("").str.lower()
    papers_per_year = df.groupby('year').size()
    topic_series = {}
    for kw in TOPIC_KEYWORDS:
        pattern = r'\b' + kw.replace(' ', r'\s+') + r'\b'
        matches = df[df['title_lower'].str.contains(pattern, regex=True, na=False)]
        counts_per_year = matches.groupby('year').size()
        pct_per_year = (counts_per_year / papers_per_year * 100).reindex(all_years).fillna(0)
        topic_series[kw] = [round(float(v), 3) for v in pct_per_year.values]
    save("topic_trends.json", {"years": all_years, "series": topic_series})

    # ---------- venue comparison ----------
    print("Venue comparison...")
    venue_series = {}
    for venue_key, label in VENUES_TO_COMPARE.items():
        counts = df[df['venue'] == venue_key].groupby('year').size().reindex(all_years).fillna(0)
        venue_series[label] = [int(v) for v in counts.values]
    save("venue_comparison.json", {"years": all_years, "series": venue_series})

    # ---------- co-authorship network ----------
    print(f"Co-authorship network (top {TOP_N_NETWORK_AUTHORS} authors)...")
    top_network_authors = set(a for a, _ in author_counter.most_common(TOP_N_NETWORK_AUTHORS))

    edge_weights = Counter()
    for lst in df['author_list']:
        filtered = sorted(set(a for a in lst if a in top_network_authors))
        if len(filtered) < 2:
            continue
        for a, b in combinations(filtered, 2):
            edge_weights[(a, b)] += 1

    G = nx.Graph()
    G.add_nodes_from(top_network_authors)
    for (a, b), w in edge_weights.items():
        G.add_edge(a, b, weight=w)

    degree_centrality = nx.degree_centrality(G)
    communities = list(nx.community.greedy_modularity_communities(G, weight='weight'))
    community_map = {}
    for i, comm in enumerate(communities):
        for node in comm:
            community_map[node] = i

    nodes = [
        {
            "id": n,
            "papers": author_counter[n],
            "group": community_map.get(n, -1),
            "degree": round(degree_centrality.get(n, 0), 4),
        }
        for n in G.nodes()
    ]
    edges = [
        {"source": a, "target": b, "weight": w}
        for a, b, w in G.edges(data='weight')
    ]
    save("coauthor_network.json", {
        "nodes": nodes,
        "edges": edges,
        "n_communities": len(communities),
    })

    print("\nAll JSON files written to", os.path.abspath(OUT_DIR))


if __name__ == "__main__":
    main()
