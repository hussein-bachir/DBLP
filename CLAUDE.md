# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Master's course assignment: extract publication records from the full DBLP XML
dump, analyze them with pandas/matplotlib/networkx, and present the findings
as an interactive JS dashboard (`dashboard/`, ECharts, no build step) — not
Streamlit. `CONTEXT.md` in the repo root is the canonical, continuously
updated project log (goals, solved bugs, current task, in-progress status);
read it before making changes and keep it current as you work.

## Environment

- Windows, PowerShell primary shell. Git repo (`git init`'d locally; no
  remote configured).
- Python 3.12 venv at `venv/` (not committed). Dependencies are pinned in
  `requirements.txt` (`lxml`, `pandas`, `numpy`, `matplotlib`, `seaborn`,
  `networkx`, plus `fastapi` and `uvicorn` for the author-search backend):
  `.\venv\Scripts\python.exe -m pip install -r requirements.txt`. Anything
  that runs `dashboard/server.py` needs the FastAPI packages, so use the venv
  interpreter, not a bare system Python.
- Run scripts via the venv interpreter directly, e.g.:
  `.\venv\Scripts\python.exe scripts\parse_dblp.py`
- Every script under `scripts/`, `debug/`, and `dashboard/preprocess.py`
  resolves its data paths from its own location (via a `REPO_ROOT` / `HERE`
  constant built from `__file__`), so they can be invoked from any working
  directory.
- No test suite, linter, or build step in this project.

## Layout

- `data/raw/` — original DBLP download: `dblp.xml.gz`, `dblp.dtd`.
- `data/processed/` — parser/filter output (`dblp_full.csv`,
  `dblp_sample.csv`, `dblp_after_2018.csv`, ...). Both `data/raw/*.gz` and
  `data/processed/*.csv` are gitignored (multi-hundred-MB to multi-GB,
  regenerable from `scripts/`).
- `scripts/` — the parse → filter → visualize/analyze pipeline (below).
- `charts/` — matplotlib/seaborn PNG output from `scripts/visualize_dblp*.py`
  and `scripts/analyze_*.py`. Gitignored, regenerable.
- `debug/` — standalone diagnostic scripts (`diagnose_parse.py`,
  `watch_window.py`) used to root-cause the parser bugs below; reference/
  history, not part of the regular pipeline.
- `dashboard/` — the JS dashboard: `index.html`, `app.js`, `style.css`,
  `preprocess.py`, and its output `data/*.json` (small, and committed, since
  it's what the charts read at runtime). Author lookup adds
  `author-search.js` (front end), `api.py` (the FastAPI app: typed
  `/api/*` endpoints + only the web assets as static files; OpenAPI docs at
  `/docs`), `server.py` (launcher: `python server.py [port]` runs `api.py`
  under uvicorn on 127.0.0.1), `author_index.py` (stdlib-only query layer that
  `api.py` wraps; keep HTTP concerns out of it) and `build_author_index.py`,
  which builds `data/processed/authors.sqlite` (~2.4 GB, gitignored, ~6 min).

## Data pipeline (run in this order)

1. `scripts/parse_dblp.py` — streams `data/raw/dblp.xml.gz` (gzip,
   ISO-8859-1) against `data/raw/dblp.dtd`, extracts `article`/
   `inproceedings` records (key, title, year, authors) into
   `data/processed/dblp_full.csv`. This is the full, unlimited, memory-safe
   parser and is the one to use for anything feeding the final analysis.
   Multi-hundred-MB output; takes real wall-clock time to run.
2. `scripts/parse_dblp_200k.py` — same parser logic but with a `limit`
   parameter for quick iteration/debugging against a small sample
   (`data/processed/dblp_sample.csv`). Do NOT use its output for actual
   findings — see bias note below.
3. `scripts/filter_after_2018.py` — filters a parsed CSV down to
   `year > 2018`, writing `data/processed/dblp_after_2018.csv`. This is the
   file the `analyze_*.py` and `visualize_dblp*.py` scripts consume. Its
   `INPUT_CSV` defaults to `dblp_sample.csv` (the biased 5M-record sample) —
   point it at `dblp_full.csv` for any real findings.
4. `scripts/visualize_dblp.py`, `scripts/visualize_dblp_extra.py` —
   exploratory matplotlib/seaborn charts (`charts/chart_1_*.png` …
   `chart_9_*.png`).
5. `scripts/analyze_coauthor_network.py`, `scripts/analyze_topic_trends.py`,
   `scripts/analyze_venue_comparison.py` — deeper analyses (co-authorship
   network via `networkx`, keyword/topic trends, per-venue growth) producing
   `charts/chart_10_*.png`–`chart_12_*.png`.
6. `dashboard/preprocess.py` — streams the full `data/processed/dblp_full.csv`
   (all years up to 2025, in chunks, two passes) into small JSON files under
   `dashboard/data/`, since the raw CSV is far too large to load
   client-side. It reads `dblp_full.csv` directly, so it does not depend on
   `filter_after_2018.py`. Built, run, and verified rendering
   correctly (see CONTEXT.md for the bugs found/fixed along the way). Opening
   `index.html` directly breaks the JSON `fetch()` calls under the
   `file://` CORS restriction, so serve it over HTTP.
7. `dashboard/build_author_index.py` — one pass over `dblp_full.csv` into the
   SQLite author index (papers, authors, authorship, a trigram full-text
   index over accent-folded names, and a word list for typo matching).
   Then run `python server.py [port]` from `dashboard/` (default 8000,
   localhost only). The FastAPI app serves the dashboard and
   `/api/status`, `/api/search`, `/api/author`, `/api/papers` (see `/docs`)
   for the search box at the top of the page. The `/api/*` JSON contract
   (field names, `{"error": ...}` bodies, 503 + `"ready": false` when the
   index is missing) is what `author-search.js` depends on; the old stdlib
   server returned byte-identical payloads, so change models and front end
   together. On a plain static server the charts still work and the search
   box explains what to run. Rebuild the index whenever `dblp_full.csv`
   changes. `AUTHOR_INDEX_PATH` overrides the index location.

All DBLP `key` values look like `conf/venue/id` or `journals/venue/id`;
venue is extracted as `parts[0] + '/' + parts[1]` after splitting on `/`.

## Non-obvious constraints (see CONTEXT.md for full detail — don't reintroduce these)

- **DTD entities must be resolved manually, not via the streaming parser.**
  Passing `load_dtd=True` to `etree.XMLPullParser` triggers a libxml2
  `ContentDecl` bug because `dblp.dtd` uses a parameter entity inside an
  element content-model declaration. Instead: load `dblp.dtd` standalone
  once via `etree.DTD(path)`, build a `{entity.name: entity.content}` map
  from `dtd.entities()`, and regex-substitute `&name;` in each raw line
  before `parser.feed()`.
- **Streaming cleanup must use `elem.clear()` + `del parent[0]`, never
  `parent.remove(elem)`.** `.remove()` silently makes `XMLPullParser` stop
  firing `end` events for top-level elements partway through the file, with
  no parser errors logged. Apply the clear/del cleanup to every direct
  child of `<dblp>`, not just `article`/`inproceedings`, or memory leaks
  over a full run.
- **Never draw conclusions from an early-cutoff parse.** The DBLP dump is
  not randomly ordered — a fixed record limit (e.g. 200k) samples a
  contiguous, venue-skewed block, not a representative slice. Always use
  the full unlimited `parse_dblp.py` output for anything that goes into the
  actual analysis/report; limited runs are for pipeline debugging only.
- The most recent 1–2 years in any time series are artificially low due to
  DBLP indexing lag, not a real publication decline — the scripts already
  cut off at 2025 (`dashboard/preprocess.py` `YEAR_MAX`, and the 2019–2025
  window in `scripts/`); preserve that when adding charts. Ratio/average
  charts in the dashboard open at 1970 because earlier years are too sparse
  for stable shares.
- On Windows, avoid multi-line `python -c "..."` one-liners (cmd doesn't
  handle them) — write a throwaway `.py` script instead.
- **Non-ASCII text in `dblp_full.csv` is garbled** (UTF-8 bytes decoded as
  Latin-1: `MÃ©rouane`). `parse_dblp.py` opens the dump as `iso-8859-1`, but
  the dump is UTF-8. Every non-ASCII author name is affected (~240k authors).
  `author_index.repair_text()` reverses it losslessly and is applied in
  `build_author_index.py` and `preprocess.py`; any new consumer of the CSV
  that shows or matches names must do the same (or the parser be fixed and
  the dump re-parsed).
- DBLP separates people who share a name with a trailing 4-digit number
  ("Hussein Hazimeh 0001" / "0002" are different people). Keep the suffix in
  stored names; strip it only for matching (`author_index.fold`).
- **A pinned CDN library version can 404 silently.** `dashboard/index.html`
  loads ECharts from cdnjs pinned to an exact version — if charts stop
  rendering, check the browser network tab / CDN response status before
  assuming the app code broke; a bad pin fails as a blocked opaque response,
  not an obvious 404 in the page.
