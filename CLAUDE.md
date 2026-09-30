# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Master's course assignment: extract publication records from the full DBLP XML
dump, analyze them, and present the findings as an interactive dashboard plus a
researcher lookup. The stack is a Python data pipeline, a FastAPI backend and a
React + TypeScript front end. `CONTEXT.md` in the repo root is the canonical,
continuously updated project log (goals, solved bugs, current task,
in-progress status); read it before making changes and keep it current as you
work.

## Environment

- Windows, PowerShell primary shell. Git repo (no remote configured).
- Python 3.12 venv at `venv/` (not committed). Dependencies are pinned in
  `requirements.txt`:
  `.\venv\Scripts\python.exe -m pip install -r requirements.txt`. Use the venv
  interpreter, not a bare system Python (the backend needs `fastapi`/`uvicorn`).
- Every Python script resolves its data paths from its own location (a
  `REPO_ROOT` / `HERE` built from `__file__`), so it can be run from any working
  directory, e.g. `.\venv\Scripts\python.exe pipeline\parse_dblp.py`.
- The Python side has no test suite, linter or build step. The React app in
  `frontend/` has all three (see "Frontend commands" below).
- Node 20.18 is installed, which is older than what current Vite (8.x, needs
  20.19+) and Vitest 5 (needs 22.12+) require, so `frontend/` pins Vite 6,
  Vitest 4.1 and TypeScript 5.9. Upgrading Node to 22 LTS would allow newer
  majors; until then don't bump those without checking their `engines`.

## Layout

Data flows one way: `pipeline/` → `data/` → `backend/` → `frontend/`.

- `pipeline/` — turns the raw DBLP dump into a CSV. `parse_dblp.py` is the
  full parser; `pipeline/debug/` holds a quick limited-sample parser and the
  diagnostic scripts used to root-cause the parser bugs below (history, not part
  of the regular pipeline).
- `data/raw/` — original DBLP download: `dblp.xml.gz`, `dblp.dtd`.
  `data/processed/` — parser output and derived files (`dblp_full.csv`,
  `authors.sqlite`, …). The big ones are gitignored and regenerable.
- `backend/` — everything that prepares or serves data for the app:
  `api.py` (the FastAPI app: typed `/api/*` endpoints, OpenAPI docs at `/docs`,
  and it serves the built React app from `/`), `server.py` (launcher:
  `python server.py [port]` runs it under uvicorn on 127.0.0.1),
  `author_index.py` (stdlib-only query layer that `api.py` wraps; keep HTTP
  concerns out of it), `build_author_index.py` (builds
  `data/processed/authors.sqlite`, ~2.4 GB, ~6 min), `build_chart_data.py`
  (aggregates the CSV into the small JSON files the charts read) and
  `export_openapi.py` (writes the schema the front end generates types from).
- `frontend/` — the React + Vite + TypeScript app: a dashboard of 11 charts plus
  the co-authorship network at `/`, and researcher profiles at `/author/:id`.
  `public/data/*.json` are the chart data files (written by
  `backend/build_chart_data.py`, committed). `src/api/schema.d.ts` is GENERATED
  from FastAPI's OpenAPI schema and committed, so building doesn't need Python.
  `src/data/schemas.ts` holds a zod schema per JSON file (types + runtime
  validation). TanStack Query does the data fetching, React Router the routes,
  ECharts is wrapped in one small component (`src/components/EChart.tsx`), and
  all chart/network decisions are pure functions in `src/lib/` with tests.
- `analysis/` — the original exploratory matplotlib/seaborn scripts. They read
  `data/processed/dblp_after_2018.csv` and write PNGs to `analysis/charts/`
  (gitignored). Superseded by the dashboard, kept as part of the coursework.

## Frontend commands (run in `frontend/`)

- `npm install` once. `npm run dev` for development: Vite on
  `http://localhost:5173/`, proxying `/api` to FastAPI on port 8000, so start
  `python server.py` first.
- `npm run build` type-checks then writes `frontend/dist`, which
  `backend/api.py` serves at `http://localhost:8000/` (gitignored; rebuild after
  changing the source — the server needs no restart).
- `npm test` (Vitest + Testing Library; the API and the chart data files are
  served from a stubbed `fetch`, the latter from the real committed JSON),
  `npm run lint`, `npm run typecheck`.
- After changing `backend/api.py` models: `python backend/export_openapi.py`
  then `npm run gen:api` (in that order), and commit both generated files
  (`openapi.json`, `src/api/schema.d.ts`). The compiler then flags every place
  the front end no longer matches the backend.
- After changing what `backend/build_chart_data.py` writes: update
  `src/data/schemas.ts` to match. `schemas.test.ts` validates every committed
  file against its schema and fails if a file is missing, extra, or the wrong
  shape.

## Data pipeline (run in this order)

1. `pipeline/parse_dblp.py` — streams `data/raw/dblp.xml.gz` against
   `data/raw/dblp.dtd`, extracts `article`/`inproceedings` records (key, title,
   year, authors) into `data/processed/dblp_full.csv`. This is the full,
   unlimited, memory-safe parser and is the one to use for anything feeding the
   final analysis. Multi-hundred-MB output; takes real wall-clock time to run.
2. `backend/build_chart_data.py` — streams the full `dblp_full.csv` (all years
   up to 2025, in chunks, two passes, ~6 min) into the small JSON files in
   `frontend/public/data/`, since the raw CSV is far too large to load
   client-side. It reads `dblp_full.csv` directly.
3. `backend/build_author_index.py` — one pass over `dblp_full.csv` into the
   SQLite author index (papers, authors, authorship, a trigram full-text index
   over accent-folded names, and a word list for typo matching). Rebuild it
   whenever `dblp_full.csv` changes. `AUTHOR_INDEX_PATH` overrides its location.
4. `python server.py [port]` from `backend/` (default 8000, localhost only)
   serves the API and the built front end. The `/api/*` JSON contract (field
   names, `{"error": ...}` bodies, 503 + `"ready": false` when the index is
   missing) is what the front end depends on; change models and front end
   together.
5. Optional coursework analysis: `analysis/filter_after_2018.py` writes
   `data/processed/dblp_after_2018.csv`, which the other `analysis/` scripts
   read. Its `INPUT_CSV` defaults to `dblp_sample.csv` (the biased 5M-record
   sample) — point it at `dblp_full.csv` for any real findings.
   `pipeline/debug/parse_dblp_200k.py` produces that sample; do NOT use its
   output for actual findings — see the bias note below.

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
  DBLP indexing lag, not a real publication decline — the chart data is cut off
  at 2025 (`backend/build_chart_data.py` `YEAR_MAX`); preserve that when adding
  charts. Ratio/average charts open at 1970 (`ZOOM_START_YEAR`) because earlier
  years are too sparse for stable shares.
- On Windows, avoid multi-line `python -c "..."` one-liners (cmd doesn't
  handle them) — write a throwaway `.py` script instead.
- **The dump's XML declaration must be rewritten before it reaches the
  parser.** The dump is plain ASCII (non-ASCII characters are DTD entities) and
  declares `encoding="ISO-8859-1"`. lxml hands each `str` to libxml2 as UTF-8,
  libxml2 obeys the declaration and re-reads those bytes as Latin-1, and every
  non-ASCII character comes out garbled (`MÃ©rouane`). `parse_dblp.py` rewrites
  the declaration to `encoding="UTF-8"` on the first line. Changing the encoding
  the file is opened with does NOT fix it. `dblp_full.csv` is clean UTF-8, so
  consumers need no repair step; `dblp_sample.csv` and `dblp_after_2018.csv`
  predate the fix and are still garbled until regenerated.
- **Read titles with `''.join(title.itertext())`, not `findtext('title')`.**
  Titles hold inline markup (`<i>`, `<sub>`, `<sup>`) and `findtext` returns
  only the text before the first tag.
- DBLP separates people who share a name with a trailing 4-digit number
  ("Hussein Hazimeh 0001" / "0002" are different people). Keep the suffix in
  stored names; strip it only for matching (`author_index.fold`).
- The network graph holds node positions still while an author is highlighted by
  reading them back from the ECharts series model (`readPositions` in
  `src/lib/network.ts`). That is an internal ECharts API; if a chart upgrade
  breaks it the function returns an empty map and the layout just re-settles
  (the tests use a fake chart, so they won't catch a real regression — check the
  graph in a browser after upgrading ECharts).
