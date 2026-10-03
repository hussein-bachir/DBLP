"""Build the semantic (meaning-based) search index over paper titles.

    python rag/build_title_vectors.py                   every paper (GPU: ~30 min; CPU: hours)
    python rag/build_title_vectors.py --min-year 2015   only papers from 2015 on (CPU-friendly)
    python rag/build_title_vectors.py --restart         throw away a previous partial run

Embeds each title of data/processed/authors.sqlite with a sentence-transformer
(default all-MiniLM-L6-v2, 384 dimensions) and writes
data/processed/title_vectors/ (gitignored):

  vectors.f16    the embeddings, float16, one row per paper (memory-mapped)
  ids.npy        papers.id of each row
  progress.json  how far embedding got; a killed run continues from there
  index.faiss    FAISS index over the vectors, ids = papers.id
  meta.json      model, size, and the authors.sqlite it was built from

Uses a CUDA GPU automatically when torch can see one (install the CUDA build of
torch for that, see CLAUDE.md), else the CPU. The folder can be copied to a
machine with a GPU mid-run and continued there. Papers left out by --min-year
are still found by keyword search. Re-run after rebuilding authors.sqlite: the
vector ids are papers.id, which a rebuild may change (the API refuses a stale
index).
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np

if __name__ == "__main__":  # run as a script: import from backend/ (author_index, api, rag), not backend/rag/
    sys.path[0] = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

from author_index import DB_PATH, connect  # noqa: E402
from rag.title_search import VECTORS_DIR, load_model, pick_device  # noqa: E402

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
CHUNK = 50_000            # titles embedded between progress checkpoints
FLAT_MAX = 300_000        # up to this many vectors, exact search is fast enough
TRAIN_PER_LIST = 50       # training vectors per IVF list (FAISS's minimum is 39)
TRAIN_MAX = 400_000       # cap on vectors used to train the compressed index


def log(started, message):
    print(f"[{(time.time() - started) / 60:6.1f} min] {message}", flush=True)


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def select_ids(conn, min_year):
    if min_year is None:
        rows = conn.execute("SELECT id FROM papers ORDER BY id")
    else:
        rows = conn.execute("SELECT id FROM papers WHERE year >= ? ORDER BY id", (min_year,))
    return np.fromiter((r[0] for r in rows), dtype=np.int64)


def titles_for(conn, ids):
    """Titles for a sorted run of ids, in the same order."""
    wanted = set(ids.tolist())
    rows = conn.execute("SELECT id, title FROM papers WHERE id BETWEEN ? AND ? ORDER BY id",
                        (int(ids[0]), int(ids[-1])))
    got = {i: (t or "") for i, t in rows if i in wanted}
    return [got.get(int(i), "") for i in ids]


def embed(args, conn, out, started, built_at):
    progress_path = os.path.join(out, "progress.json")
    ids_path = os.path.join(out, "ids.npy")
    vec_path = os.path.join(out, "vectors.f16")
    progress = None if args.restart else read_json(progress_path)
    wanted = {"model": args.model, "min_year": args.min_year, "index_built_at": built_at}

    if progress and any(progress.get(k) != v for k, v in wanted.items()):
        sys.exit(f"{out} holds a partial run with different settings "
                 f"({ {k: progress.get(k) for k in wanted} }). Re-run with --restart to discard it.")

    device = args.device or pick_device()
    model = load_model(args.model, device)
    if device == "cuda":
        model.half()   # fp16 on the GPU: about twice as fast, same vectors to 3 decimals
    dims = model.get_sentence_embedding_dimension()
    batch = args.batch or (512 if device == "cuda" else 128)

    if progress is None:
        for name in ("index.faiss", "meta.json"):
            if os.path.exists(os.path.join(out, name)):
                os.remove(os.path.join(out, name))
        ids = select_ids(conn, args.min_year)
        np.save(ids_path, ids)
        np.memmap(vec_path, dtype=np.float16, mode="w+", shape=(len(ids), dims)).flush()
        progress = {**wanted, "dims": dims, "papers": int(len(ids)), "done": 0}
        write_json(progress_path, progress)
    ids = np.load(ids_path)
    n, done = progress["papers"], progress["done"]
    log(started, f"device={device} batch={batch} model={args.model} dims={dims}: "
                 f"{n:,} titles, {done:,} already embedded")
    if done >= n:
        return ids, dims

    vectors = np.memmap(vec_path, dtype=np.float16, mode="r+", shape=(n, dims))
    t0, done0 = time.time(), done
    while done < n:
        end = min(done + CHUNK, n)
        titles = titles_for(conn, ids[done:end])
        emb = model.encode(titles, batch_size=batch, normalize_embeddings=True,
                           convert_to_numpy=True, show_progress_bar=False)
        vectors[done:end] = emb.astype(np.float16)
        vectors.flush()
        done = end
        progress["done"] = done
        write_json(progress_path, progress)
        rate = (done - done0) / max(time.time() - t0, 1e-9)
        log(started, f"{done:,}/{n:,} titles ({rate:,.0f}/s, about {(n - done) / rate / 60:.0f} min left)")
    del vectors
    return ids, dims


def build_index(ids, dims, out, started):
    import faiss

    n = len(ids)
    vectors = np.memmap(os.path.join(out, "vectors.f16"), dtype=np.float16, mode="r", shape=(n, dims))
    if n <= FLAT_MAX:
        log(started, f"exact index over {n:,} vectors")
        index = faiss.IndexIDMap(faiss.IndexFlatIP(dims))
    else:
        nlist = min(8192, int(4 * math.sqrt(n)))
        m = 48 if dims % 48 == 0 else next(k for k in (32, 24, 16, 8) if dims % k == 0)
        log(started, f"compressed index IVF{nlist},PQ{m} over {n:,} vectors: training")
        index = faiss.index_factory(dims, f"IVF{nlist},PQ{m}", faiss.METRIC_INNER_PRODUCT)
        # FAISS wants >= 39 training vectors per cluster; more costs RAM (float32) for little gain
        rng = np.random.default_rng(0)
        sample = np.sort(rng.choice(n, size=min(n, TRAIN_PER_LIST * nlist, TRAIN_MAX), replace=False))
        index.train(np.asarray(vectors[sample], dtype=np.float32))
    log(started, "adding vectors")
    step = 200_000
    for start in range(0, n, step):
        index.add_with_ids(np.asarray(vectors[start:start + step], dtype=np.float32), ids[start:start + step])
    tmp = os.path.join(out, "index.faiss.tmp")
    faiss.write_index(index, tmp)
    os.replace(tmp, os.path.join(out, "index.faiss"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-year", type=int, default=None, help="only embed papers from this year on")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--device", choices=["cuda", "mps", "cpu"], help="default: a GPU if available")
    parser.add_argument("--batch", type=int, help="titles per batch (default 512 on GPU, 128 on CPU)")
    parser.add_argument("--restart", action="store_true", help="discard a partial run")
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--out", default=VECTORS_DIR)
    args = parser.parse_args()

    started = time.time()
    conn = connect(args.db)
    if conn is None:
        sys.exit(f"{args.db} not found. Run build_author_index.py first.")
    built_at = conn.execute("SELECT v FROM meta WHERE k = 'built_at'").fetchone()[0]
    os.makedirs(args.out, exist_ok=True)

    ids, dims = embed(args, conn, args.out, started, built_at)
    conn.close()
    build_index(ids, dims, args.out, started)
    write_json(os.path.join(args.out, "meta.json"), {
        "complete": True, "model": args.model, "dims": dims, "papers": int(len(ids)),
        "min_year": args.min_year, "index_built_at": built_at,
        "built_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    })
    size = os.path.getsize(os.path.join(args.out, "index.faiss")) / 1e9
    log(started, f"done: {len(ids):,} titles -> {os.path.abspath(args.out)} (index {size:.2f} GB). "
                 "Restart server.py to use it.")


if __name__ == "__main__":
    main()
