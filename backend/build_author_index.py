"""Build the SQLite index behind the dashboard's author search.

Streams data/processed/dblp_full.csv (every article/inproceedings record) once
and writes data/processed/authors.sqlite with:

  papers      one row per record (key, title, year, type)
  authors     one row per distinct author string (DBLP already separates
              same-name people with a trailing number, e.g. "... 0001")
  authorship  author <-> paper links, clustered by author
  authors_fts trigram full-text index over the accent-folded names
  tokens      distinct name words, used for "did you mean" spelling matches

The index is large (a couple of GB) and fully regenerable, so it is gitignored.
It is written to a temporary file and only moved into place on success, so an
interrupted build never leaves a half-written index behind.
"""
import os
import sqlite3
import sys
import time
from collections import Counter

import pandas as pd

from author_index import DB_PATH, HERE, fold, repair_text

CSV_PATH = os.path.join(HERE, "..", "data", "processed", "dblp_full.csv")
CHUNK_ROWS = 300_000
INSERT_BATCH = 200_000


def log(started, message):
    print(f"[{(time.time() - started) / 60:5.1f} min] {message}", flush=True)


def main(csv_path=CSV_PATH, db_path=DB_PATH):
    started = time.time()
    tmp_path = db_path + ".building"
    for leftover in (tmp_path, tmp_path + "-journal"):
        if os.path.exists(leftover):
            os.remove(leftover)

    conn = sqlite3.connect(tmp_path)
    conn.executescript("""
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA cache_size = -300000;
        CREATE TABLE papers (id INTEGER PRIMARY KEY, key TEXT NOT NULL, title TEXT,
                             year INTEGER, type INTEGER NOT NULL);
        CREATE TABLE authorship_raw (author_id INTEGER NOT NULL, paper_id INTEGER NOT NULL);
    """)

    author_ids = {}
    names, n_papers, first_year, last_year = [], [], [], []
    paper_id = 0

    log(started, f"pass over {csv_path}")
    for chunk in pd.read_csv(csv_path, chunksize=CHUNK_ROWS, dtype=str, keep_default_na=False):
        papers, links = [], []
        for kind, key, title, year, authors in zip(chunk['type'], chunk['key'], chunk['title'],
                                                   chunk['year'], chunk['authors']):
            paper_id += 1
            try:
                y = int(year)
            except ValueError:
                y = None
            papers.append((paper_id, key, repair_text(title), y, 1 if kind == 'inproceedings' else 0))
            seen = set()
            for raw in authors.split(';'):
                # repair BEFORE stripping: a trailing "à" is garbled as "Ã" + a
                # non-breaking space, which str.strip() would remove first
                name = repair_text(raw).strip()
                if not name or name in seen:
                    continue
                seen.add(name)
                aid = author_ids.get(name)
                if aid is None:
                    aid = len(names) + 1
                    author_ids[name] = aid
                    names.append(name)
                    n_papers.append(0)
                    first_year.append(None)
                    last_year.append(None)
                i = aid - 1
                n_papers[i] += 1
                if y is not None:
                    if first_year[i] is None or y < first_year[i]:
                        first_year[i] = y
                    if last_year[i] is None or y > last_year[i]:
                        last_year[i] = y
                links.append((aid, paper_id))
        conn.executemany("INSERT INTO papers VALUES (?, ?, ?, ?, ?)", papers)
        conn.executemany("INSERT INTO authorship_raw VALUES (?, ?)", links)
        conn.commit()
        log(started, f"{paper_id:,} papers, {len(names):,} authors")

    del author_ids  # ~1 GB of dict we no longer need

    log(started, "writing authors table")
    conn.execute("""CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, fold TEXT NOT NULL,
                    n_papers INTEGER NOT NULL, first_year INTEGER, last_year INTEGER)""")
    token_counts = Counter()
    for start in range(0, len(names), INSERT_BATCH):
        rows = []
        for i in range(start, min(start + INSERT_BATCH, len(names))):
            folded = fold(names[i])
            token_counts.update(set(folded.split()))
            rows.append((i + 1, names[i], folded, n_papers[i], first_year[i], last_year[i]))
        conn.executemany("INSERT INTO authors VALUES (?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    n_authors = len(names)
    del names, n_papers, first_year, last_year

    log(started, "indexing authors.fold and the spelling vocabulary")
    conn.execute("CREATE INDEX authors_fold ON authors(fold)")
    conn.execute("""CREATE TABLE tokens (tok TEXT PRIMARY KEY, n INTEGER NOT NULL, c1 TEXT NOT NULL,
                    len INTEGER NOT NULL) WITHOUT ROWID""")
    conn.executemany("INSERT INTO tokens VALUES (?, ?, ?, ?)",
                     ((t, n, t[0], len(t)) for t, n in token_counts.items() if len(t) >= 3))
    conn.execute("CREATE INDEX tokens_by_shape ON tokens(c1, len)")
    conn.commit()
    del token_counts

    log(started, "clustering authorship by author")
    conn.execute("""CREATE TABLE authorship (author_id INTEGER NOT NULL, paper_id INTEGER NOT NULL,
                    PRIMARY KEY (author_id, paper_id)) WITHOUT ROWID""")
    conn.execute("INSERT INTO authorship SELECT author_id, paper_id FROM authorship_raw "
                 "ORDER BY author_id, paper_id")
    conn.execute("DROP TABLE authorship_raw")
    conn.commit()
    log(started, "indexing authorship by paper (for co-author lookups)")
    conn.execute("CREATE INDEX authorship_by_paper ON authorship(paper_id, author_id)")
    conn.commit()

    log(started, "building the trigram name index")
    conn.execute("""CREATE VIRTUAL TABLE authors_fts USING fts5(
                    fold, content='authors', content_rowid='id', tokenize='trigram')""")
    conn.execute("INSERT INTO authors_fts(authors_fts) VALUES ('rebuild')")
    conn.commit()

    conn.execute("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)")
    conn.executemany("INSERT INTO meta VALUES (?, ?)", [
        ("authors", str(n_authors)), ("papers", str(paper_id)),
        ("built_at", time.strftime("%Y-%m-%d %H:%M:%S")),
    ])
    conn.commit()
    conn.close()

    os.replace(tmp_path, db_path)
    log(started, f"done: {n_authors:,} authors, {paper_id:,} papers -> {os.path.abspath(db_path)} "
                 f"({os.path.getsize(db_path) / 1e9:.2f} GB)")


if __name__ == "__main__":
    main(*sys.argv[1:3])
