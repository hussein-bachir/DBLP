# Project context: DBLP extraction + visualization dashboard

## Goal
Extract `article`/`inproceedings` records (key, title, year, authors) from the
full DBLP XML dump, analyze them, and present findings as an interactive
JS dashboard (not Streamlit) for a master's course assignment.

## Files in this project
Layout as of the repository cleanup (data flows `pipeline/` -> `data/` ->
`backend/` -> `frontend/`; older entries in this log use the previous names
`scripts/`, `debug/`, `dashboard/preprocess.py` and the vanilla `dashboard/`
front end, which has been deleted; mapped below):
- `data/raw/dblp.xml.gz`, `data/raw/dblp.dtd` -- raw source data
  (downloaded from dblp.org), gitignored
- `data/processed/*.csv`, `authors.sqlite` -- parser output and derived files
  (`dblp_full.csv`, ...), gitignored
- `pipeline/parse_dblp.py` (was `scripts/`) -- the working, memory-safe
  full-dataset parser; `pipeline/debug/` (was `debug/`, plus the limited-sample
  `parse_dblp_200k.py`) -- diagnostics used to root-cause the parser bugs below
- `backend/` -- `api.py` (FastAPI), `server.py`, `author_index.py`,
  `build_author_index.py`, `build_chart_data.py` (was
  `dashboard/preprocess.py`), `export_openapi.py`
- `frontend/` -- the React + Vite + TypeScript app (dashboard, network,
  researcher profiles); `public/data/*.json` are the chart data files
- `analysis/` (was `scripts/`) -- the original exploratory matplotlib scripts
  (`visualize_dblp*.py`, `analyze_*.py`, `filter_after_2018.py`), charts saved
  to `analysis/charts/` (gitignored)

Every Python script resolves its paths from its own location (a
`REPO_ROOT`/`HERE` built from `__file__`), so it works regardless of the
invoking working directory. The repo is a local git repository (no remote)
with the large data/`venv/`/log files gitignored -- see `.gitignore`.

## Non-obvious bugs already solved (don't reintroduce these)

1. **DTD entity resolution**: `dblp.dtd` uses a parameter entity
   (`<!ENTITY % field "...">`) inside element content-model declarations
   (`<!ELEMENT article (%field;)*>`). Loading this DTD via `iterparse`'s
   incremental/streaming loader triggers a libxml2 bug
   (`XMLSyntaxError: ContentDecl`) that does NOT occur when the DTD is
   read standalone via `etree.DTD()`. Fix: never pass `load_dtd=True` to
   the streaming parser. Instead, parse the DTD standalone once with
   `etree.DTD(path)`, extract its named entities via `dtd.entities()`
   into a dict, and manually regex-substitute `&name;` occurrences in
   each line before feeding it to the parser.

2. **`XMLPullParser` + `parent.remove(elem)` silently breaks nesting**:
   using `parent.remove(elem)` for streaming memory cleanup (the classic
   iterparse pattern) causes `XMLPullParser` to stop firing `end` events
   for top-level elements partway through the file, with ZERO parser
   errors logged -- confirmed via extensive diagnostic scripts. Fix: use
   `elem.clear()` + `while elem.getprevious() is not None: del parent[0]`
   instead of `.remove()`. Also apply this cleanup to EVERY direct child
   of `<dblp>` (not just `article`/`inproceedings`), since the file is
   dominated by `incollection`/`book`/`data` records that would otherwise
   never be cleared and would leak memory over a full run.

3. **Sequential sampling bias**: DBLP's XML dump is NOT randomly ordered.
   Early portions of the file are dominated by specific record-type/venue
   blocks (verified empirically: reading with a fixed record limit like
   200k-500k produced 0% journal articles, 100% conference papers, and a
   skewed top-authors/venues list dominated by whichever conference block
   happened to be first). **Always prefer the unlimited full-file parse**
   (`parse_dblp.py`, no `limit` parameter) over any early-cutoff version
   for anything used in the final analysis/report.

4. Windows `cmd` doesn't handle multi-line `python -c "..."` strings --
   always write a small `.py` script file instead of inline `-c` for
   anything beyond a one-liner.

5. **Pinned CDN library version can 404 and fail silently-ish** (historical:
   the vanilla dashboard is gone and ECharts is now an npm dependency): `index.html`
   originally pinned `echarts@5.5.1` from cdnjs, but cdnjs has no
   `echarts.min.js` build under that version -- the `<script>` tag got a 404
   HTML response, the browser blocked it as an opaque response
   (`ERR_BLOCKED_BY_ORB`), and every chart failed with `echarts is not
   defined` with no obvious error on the page itself. Fixed by bumping to
   `echarts@6.1.0` (confirmed 200 + `application/javascript`). If ECharts
   (or any pinned CDN asset) stops rendering, check the network tab / CDN
   response status before assuming the app code is wrong.

6. **`dblp_after_2018.csv` is derived from the biased 5M-record sample, not
   the full parse.** `analysis/filter_after_2018.py` defaults `INPUT_CSV` to
   `dblp_sample.csv`, so anything built on `dblp_after_2018.csv` (the
   `analysis/analyze_*.py` / `visualize_dblp*.py` charts, and the first
   version of the dashboard) covered only ~1.73M of the 3.45M papers dated
   2019-2025, and showed 24% journal articles versus the true ~52%. The
   dashboard now reads `dblp_full.csv` directly (branch `all-years`); the
   `analysis/` charts still need `INPUT_CSV` pointed at `dblp_full.csv` and
   `filter_after_2018.py` re-run before their numbers are usable.

7. **Accented names came out of the parser as mojibake** (`Mérouane Debbah`
   stored as `MÃ©rouane Debbah`; all 241,638 non-ASCII author names, 5.7% of
   4.26M authors). Found while building author search: a search for `cudré`
   could not match `CudrÃ©-Mauroux`. First worked around downstream with a
   `repair_text()` step in the two builders, on the assumption that the dump
   was UTF-8 being decoded as `iso-8859-1`. That diagnosis was wrong: the dump
   is plain ASCII (non-ASCII characters are DTD entities such as `&eacute;`)
   and opening it as `utf-8` changes nothing. The real cause is the dump's XML
   declaration, `encoding="ISO-8859-1"`: lxml hands each `str` to libxml2 as
   UTF-8, libxml2 obeys the declaration and re-reads those bytes as Latin-1.
   Fixed at the source (2026-09-30): `parse_dblp.py` and `parse_dblp_200k.py`
   rewrite the declaration to `encoding="UTF-8"` on the first line, the dump
   was re-parsed, and `repair_text()` was removed. Checked against the old CSV:
   same 8,423,776 rows and keys in the same order, every author field equal to
   the old one after repair, and no name left that the old repair would alter.
   `dblp_sample.csv` and `dblp_after_2018.csv` were NOT regenerated, so the
   `analysis/` charts still show garbled names.

8. **`elem.findtext('title')` cut titles at the first inline tag.** Titles hold
   inline markup (`<i>`, `<sub>`, `<sup>`), and `findtext` returns only the
   text before the first child element, so `Observer-based H∞ control
   of networked systems...` was stored as `Observer-based H`. Fixed in the same re-parse
   with `''.join(title_elem.itertext())`: 70,227 titles changed, 5,959 of which
   had been stored empty because the title started with a tag. No title is
   empty now.

## Current state: the web app (React + FastAPI)

`python backend/server.py` serves the built React app at `/` (the dashboard of
11 charts plus the co-authorship network, and researcher profiles at
`/author/:id`) and the read-only `/api/*` search API (docs at `/docs`).
The vanilla-JS dashboard that preceded it has been deleted.

- **Chart data**: `backend/build_chart_data.py` streams
  `data/processed/dblp_full.csv` (chunked, two passes, ~6 min) into 13 small JSON
  files in `frontend/public/data/` (the raw CSV, 8.4M rows, is far too large to
  load client-side). The front end validates each file with a zod schema
  (`src/data/schemas.ts`) when it loads, and `schemas.test.ts` checks the
  committed files against those schemas, so a change to the builder that the
  charts don't understand fails a test instead of drawing a blank chart. A
  missing or malformed file shows an error in just that card, with the command
  to regenerate it.
- **Coverage**: every record 1936-2025 (8,051,300 records; 372,476 dated 2026+
  or with no valid year are left out because DBLP is still indexing them).
  Ratio/average charts open at 1970 with a year slider reaching back to 1936,
  because the early decades have too few records for stable shares. Findings
  worth knowing: `journals/corr` (the arXiv mirror) is ~10% of all records and
  dominates top venues; the Remote Sensing journal has zero 2025 records in DBLP
  itself (indexing gap, not a real drop); the "transformer" title keyword also
  matches electrical transformers, which is the ~1% bump before 2017.
- **Co-authorship network** (`NetworkCard.tsx`, logic in `src/lib/network.ts`):
  the 150 most prolific authors, an author search box (accent- and
  case-insensitive, covers only these 150, not the 4.1M), and two sliders, "min.
  shared papers per link" (default 5) and "authors shown" (default top 100).
  Half of the 2,185 links are one- or two-paper collaborations, which is what
  made the graph a hairball; at the defaults it shows ~83 authors / ~197 links and
  the research groups separate cleanly. Authors with no link at the current
  threshold are hidden. Highlighting pins existing node positions (`fixed` +
  `x`/`y` read back from the chart) so the layout doesn't reshuffle, widens the
  "authors shown" slider if the match is hidden, and restores it on clear; slider
  changes re-run the layout. A profile of an author who is in the network has a
  "Highlight in network" link (`/?highlight=<name>#network`).
- **Researcher lookup** (search box in the header of every page): finds any of
  the 4.26M authors. Type a name (any word order, any fragment of 3+ letters,
  accents optional); results show paper count, years and top venues so people
  who share a name can be told apart -- e.g. DBLP has two different "Hussein
  Hazimeh" (0001: 37 papers, ML/optimization venues; 0002: 25 papers, different
  venues and co-authors). If nothing matches exactly, close spellings are tried
  ("hussein kenaan" finds "Hussein Kanaan"). Picking a result opens a profile:
  papers per year, venues, co-authors (click to jump to them), and the full
  publication list linked to dblp.org. DBLP has no affiliation data, so the
  profile says so and the user confirms identity from venues/co-authors. Needs
  the SQLite index (`build_author_index.py`, ~6 min, 2.4 GB, gitignored); without
  it the box explains what to build and the charts still work. Author ids change
  if the index is rebuilt from a different CSV, so `/author/<id>` links are not
  permanent.
- **Design system**: deep ink-navy background (#12172B), brass-gold accent
  (#C9A227), verdigris secondary accent (#5B8A82); Source Serif 4 for headlines,
  IBM Plex Sans/Mono for body/data -- deliberately avoiding generic "SaaS
  dashboard" cliches. Charts use ECharts (an npm dependency, tree-shaken to the
  chart types used and code-split into its own chunk).
- **Tests**: 147 frontend tests (Vitest + Testing Library). Pure logic (chart
  option builders, the network's filtering/highlighting/search/slider rules) is
  tested directly; components are tested with the real committed JSON through a
  stubbed `fetch`. The network tests were mutation-checked (breaking the
  threshold comparison, the slider rounding and the dimming each fail tests).

### How it got here (each step was verified before the next)

- **All-years**: the first dashboard was built from `dblp_after_2018.csv`,
  which derives from the biased 5M-record sample (bug #6), so it covered ~1.73M
  of 3.45M papers for 2019-2025 and showed 24% journal articles versus the true
  ~52%. `build_chart_data.py` now reads the full parse.
- **Step 1 -- FastAPI backend**: the stdlib `http.server` backend was replaced by
  FastAPI (`backend/api.py`) with the same `/api/*` contract. Verified by running
  old and new servers side by side: 35 of 35 success responses (searches,
  profiles, paging, status) were identical JSON. Deliberate differences: bad
  input returns 422 (was 400), `id=0` is a 422 (was a 404), a `q` over 500 chars
  is rejected (was truncated to 100), only web assets are served (the old server
  also served the `.py` sources), and `/docs` + `/openapi.json` exist. A running
  `server.py` keeps the code it started with; restart it to pick up changes.
- **Step 2 -- React search and profiles**: React 19 + Vite 6 + TypeScript with
  TanStack Query (cancels superseded keystroke requests, caches profiles),
  React Router (real back/forward), and API types generated from the backend's
  OpenAPI schema. Bugs the tests/browser run found: (1) pressing Enter right
  after typing opened a result from the PREVIOUS query, because the old list
  stays on screen while the next loads -- Enter now only picks from results for
  exactly what is typed, and otherwise queues "open the top match" until fresh
  results arrive; (2) the status text said "2 matchs" (naive pluralisation).
- **Repository cleanup**: `dashboard/` mixed the backend with the old front end;
  it was split into `backend/`, `pipeline/`, `analysis/` and `frontend/` (see
  "Files in this project").
- **Step 3 -- charts and network into React**: the 11 chart cards and the
  network were ported from the vanilla `app.js` as pure functions plus thin
  components, the vanilla dashboard was deleted, the app moved from `/app/` to
  `/`, and `build_chart_data.py` now writes to `frontend/public/data/`. Bugs
  found while rendering the old vanilla version, whose fixes are carried over:
  the "Top Venues" value-axis tick labels overlapped in a narrow card (fixed with
  a `k`-abbreviation formatter, `abbrevNumber`); the donut's outside labels were
  clipped at the canvas edge (now whole-number shares drawn inside the ring); and
  a pinned `echarts@5.5.1` CDN URL had 404'd (bug #5 -- irrelevant now that
  ECharts is bundled from npm).

## Report/methodology notes worth keeping in the final writeup
- The article/inproceedings ratio, top-authors, and top-venues findings
  are only meaningful when computed from the FULL unlimited parse, not
  any of the earlier limited-sample runs -- state this explicitly as a
  methodology point, since it's genuine evidence of understanding your
  own pipeline's failure modes.
- The most recent 1-2 years in any time-series chart will show an
  artificial drop-off due to DBLP indexing lag, not a real decline --
  worth trimming or annotating in final charts (already handled via a
  2019-2025 filter in the current scripts).
