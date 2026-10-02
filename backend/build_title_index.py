"""Add a keyword (BM25) index over paper titles to the author index.

Run after build_author_index.py: it adds one table to data/processed/authors.sqlite
in place,

  papers_fts  FTS5 over papers.title (porter stemming, accent-insensitive),
              external content, so rowid = papers.id

and records `titles_fts_built_at` in `meta`. It drops and recreates the table,
so it is safe to re-run. Rebuilding authors.sqlite throws this table away;
run this again afterwards (the Ask feature reports it missing until you do).
"""
import os
import sqlite3
import sys
import time

from author_index import DB_PATH


def main(db_path=DB_PATH):
    if not os.path.exists(db_path):
        sys.exit(f"{db_path} not found. Run build_author_index.py first.")
    started = time.time()
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA cache_size = -300000;
        DROP TABLE IF EXISTS papers_fts;
        DELETE FROM meta WHERE k = 'titles_fts_built_at';
    """)
    conn.commit()
    print("building the title index (a few minutes)...", flush=True)
    conn.execute("""CREATE VIRTUAL TABLE papers_fts USING fts5(
                    title, content='papers', content_rowid='id',
                    tokenize='porter unicode61 remove_diacritics 2')""")
    conn.execute("INSERT INTO papers_fts(papers_fts) VALUES ('rebuild')")
    conn.execute("INSERT INTO papers_fts(papers_fts) VALUES ('optimize')")
    conn.execute("INSERT INTO meta VALUES ('titles_fts_built_at', ?)", (time.strftime("%Y-%m-%d %H:%M:%S"),))
    conn.commit()
    conn.close()
    print(f"done in {(time.time() - started) / 60:.1f} min -> {os.path.abspath(db_path)} "
          f"({os.path.getsize(db_path) / 1e9:.2f} GB)")


if __name__ == "__main__":
    main(*sys.argv[1:2])
