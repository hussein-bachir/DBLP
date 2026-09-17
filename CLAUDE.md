# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Master's course assignment: extract publication records from the full DBLP XML
dump, analyze them with pandas/matplotlib/networkx, and (per `CONTEXT.md`)
present the findings as an interactive JS dashboard (ECharts, no build step) —
not Streamlit. `CONTEXT.md` in the repo root is the canonical, continuously
updated project log (goals, solved bugs, current task, in-progress status);
read it before making changes and keep it current as you work. This is not a
git repository.

## Environment

- Windows, PowerShell primary shell.
- Python 3.12 venv at `venv/` (not committed as a lockfile — no
  `requirements.txt` exists). Installed: `lxml`, `pandas`, `numpy`,
  `matplotlib`, `seaborn`, `networkx`.
- Run scripts via the venv interpreter directly, e.g.:
  `.\venv\Scripts\python.exe parse_dblp.py`
- No test suite, linter, or build step in this project.

## Data pipeline (run in this order)

1. `parse_dblp.py` — streams `dblp.xml.gz` (gzip, ISO-8859-1) against
   `dblp.dtd`, extracts `article`/`inproceedings` records (key, title, year,
   authors) into `dblp_full.csv`. This is the full, unlimited, memory-safe
   parser and is the one to use for anything feeding the final analysis.
   Multi-hundred-MB output; takes real wall-clock time to run.
2. `parse_dblp_200k.py` — same parser logic but with a `limit` parameter for
   quick iteration/debugging against a small sample (`dblp_sample.csv`). Do
   NOT use its output for actual findings — see bias note below.
3. `filter_after_2018.py` — filters a parsed CSV down to `year > 2018`,
   writing `dblp_after_2018.csv`. This is the file the `analyze_*.py` and
   `visualize_dblp*.py` scripts consume.
4. `visualize_dblp.py`, `visualize_dblp_extra.py` — exploratory matplotlib/
   seaborn charts (`chart_1_*.png` … `chart_9_*.png`).
5. `analyze_coauthor_network.py`, `analyze_topic_trends.py`,
   `analyze_venue_comparison.py` — deeper analyses (co-authorship network via
   `networkx`, keyword/topic trends, per-venue growth) producing
   `chart_10_*.png`–`chart_12_*.png`.
6. `dashboard/` (not yet created as of this writing — see CONTEXT.md "Current
   task") is meant to hold `preprocess.py` (aggregates the CSV into small
   JSON files under `dashboard/data/`, since the raw CSV is far too large to
   load client-side) plus `index.html`/`app.js`/`style.css`. The dashboard
   must be served via `python -m http.server` from within `dashboard/` —
   opening `index.html` directly breaks the JSON `fetch()` calls under the
   `file://` CORS restriction.

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
  DBLP indexing lag, not a real publication decline — existing scripts
  already trim to a 2019–2025 window; preserve that when adding charts.
- On Windows, avoid multi-line `python -c "..."` one-liners (cmd doesn't
  handle them) — write a throwaway `.py` script instead.
- `debug/` contains standalone diagnostic scripts (`diagnose_parse.py`,
  `watch_window.py`) used to root-cause the parser bugs above; they're
  reference/history, not part of the pipeline.
