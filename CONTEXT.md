# Project context: DBLP extraction + visualization dashboard

## Goal
Extract `article`/`inproceedings` records (key, title, year, authors) from the
full DBLP XML dump, analyze them, and present findings as an interactive
JS dashboard (not Streamlit) for a master's course assignment.

## Files in this project (reorganized -- see below)
- `data/raw/dblp.xml.gz`, `data/raw/dblp.dtd` -- raw source data
  (downloaded from dblp.org), gitignored
- `data/processed/*.csv` -- parser/filter output (`dblp_full.csv`,
  `dblp_sample.csv`, `dblp_after_2018.csv`, ...), gitignored
- `scripts/parse_dblp.py` -- the working, memory-safe full-dataset parser
- `scripts/visualize_dblp.py`, `scripts/visualize_dblp_extra.py` --
  matplotlib exploratory charts, saved to `charts/` (gitignored)
- `scripts/analyze_coauthor_network.py`, `scripts/analyze_topic_trends.py`,
  `scripts/analyze_venue_comparison.py` -- deeper analytical scripts
- `debug/` -- standalone diagnostic scripts used to root-cause the parser
  bugs below; reference/history, not part of the regular pipeline
- `dashboard/` -- the JS dashboard (index.html, app.js, style.css,
  preprocess.py, data/*.json) -- built, run, and verified working
  (see "Current task" below)

All scripts resolve `data/`/`charts/` paths relative to the repo root via a
`REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))`
constant, so they work regardless of the invoking working directory. The
repo is a local git repository (`git init`'d, no remote) with the large
data/`venv/`/log files gitignored -- see `.gitignore`.

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

5. **Pinned CDN library version can 404 and fail silently-ish**: `index.html`
   originally pinned `echarts@5.5.1` from cdnjs, but cdnjs has no
   `echarts.min.js` build under that version -- the `<script>` tag got a 404
   HTML response, the browser blocked it as an opaque response
   (`ERR_BLOCKED_BY_ORB`), and every chart failed with `echarts is not
   defined` with no obvious error on the page itself. Fixed by bumping to
   `echarts@6.1.0` (confirmed 200 + `application/javascript`). If ECharts
   (or any pinned CDN asset) stops rendering, check the network tab / CDN
   response status before assuming the app code is wrong.

6. **`dblp_after_2018.csv` is derived from the biased 5M-record sample, not
   the full parse.** `scripts/filter_after_2018.py` defaults `INPUT_CSV` to
   `dblp_sample.csv`, so anything built on `dblp_after_2018.csv` (the
   `scripts/analyze_*.py` / `visualize_dblp*.py` charts, and the first
   version of the dashboard) covered only ~1.73M of the 3.45M papers dated
   2019-2025, and showed 24% journal articles versus the true ~52%. The
   dashboard now reads `dblp_full.csv` directly (branch `all-years`); the
   `scripts/` charts still need `INPUT_CSV` pointed at `dblp_full.csv` and
   `filter_after_2018.py` re-run before their numbers are usable.

7. **Accented names in `dblp_full.csv` are mojibake.** `parse_dblp.py` (and
   `parse_dblp_200k.py`, `debug/`) decode the dump as `iso-8859-1`, but it is
   UTF-8, so `Mérouane Debbah` is stored as `MÃ©rouane Debbah`. All 241,638
   non-ASCII author names (5.7% of 4.26M authors) are affected, and none are
   clean. Found while building author search: a search for `cudré` could not
   match `CudrÃ©-Mauroux`. Fixed downstream, not at the source:
   `dashboard/author_index.repair_text()` re-encodes as Latin-1 and decodes as
   UTF-8 (lossless; strings that aren't garbled are left alone), and both
   `build_author_index.py` and `preprocess.py` apply it. The parsers and the
   `scripts/` charts are unchanged, so those still show garbled names. The
   proper fix is `encoding='utf-8'` in the parsers plus a re-parse (not done).
   Related, unfixed: `elem.findtext('title')` keeps only the text before the
   first inline tag, so titles containing `<i>`/`<sub>` markup are cut short.

## Current task: the JS dashboard
- `dashboard/preprocess.py` streams `data/processed/dblp_full.csv` (chunked,
  two passes, ~6 min) into small JSON files (under `dashboard/data/`) since
  the raw CSV (8.4M rows) is too large to load client-side.
- **All-years version (branch `all-years`)**: covers every record 1936-2025
  (8,051,300 records; 372,476 dated 2026+ or with no valid year are left
  out because DBLP is still indexing them). `master` still has the earlier
  2019-2025-from-the-sample dashboard. Ratio/average charts open at 1970 with
  a year slider reaching back to 1936, because the early decades have
  too few records for stable shares. Findings worth knowing: `journals/corr`
  (the arXiv mirror) is ~10% of all records and dominates top venues; the
  Remote Sensing journal has zero 2025 records in DBLP itself (indexing gap,
  not a real drop); the "transformer" title keyword also matches electrical
  transformers, which is the ~1% bump before 2017.
- **Co-authorship network controls**: an author search box (accent- and
  case-insensitive, substring match, covers all 150 network authors -- not
  the 4.1M in the dataset) plus two sliders, "min. shared papers per link"
  (default 5) and "authors shown" (default top 100). Half of the 2,185 links
  are one- or two-paper collaborations, which is what made the graph a
  hairball; at the defaults it shows 83 authors / 197 links and the research
  groups separate cleanly. Authors with no link at the current threshold are
  hidden. Searching pins existing node positions (`fixed` + `x`/`y` read back
  from the chart) so the highlight doesn't reshuffle the layout, widens the
  "authors shown" slider if the match is hidden, and restores it on clear.
  Slider changes do re-run the layout.
- **Author lookup (search box at the top of the page)**: finds any of the
  4.26M authors, not just the network's 150. Type a name (any word order, any
  fragment of 3+ letters, accents optional); results show paper count, years
  and top venues so people who share a name can be told apart -- e.g. DBLP has
  two different "Hussein Hazimeh" (0001: 37 papers, ML/optimization venues;
  0002: 25 papers, different venues and co-authors). If nothing matches
  exactly, close spellings are tried ("hussein kenaan" finds "Hussein
  Kanaan"). Picking a result opens a profile: papers per year, venues,
  co-authors (click to jump to them), and the full publication list linked to
  dblp.org. DBLP has no affiliation data, so the profile says so and the user
  confirms identity from venues/co-authors. Needs `python server.py` and the
  SQLite index (`build_author_index.py`, ~6 min, 2.4 GB, gitignored); on a
  plain static server the box explains what to run and the charts still work.
  `#author=<id>` in the URL deep-links to a profile (ids change if the index
  is rebuilt from a different CSV).
- **Backend migration, step 1 of 3 (branch `fastapi-backend`)**: the stdlib
  `http.server` backend was replaced by FastAPI (`dashboard/api.py`), with the
  same `/api/*` contract so the vanilla front end is unchanged. Verified by
  running old and new servers side by side: 35 of 35 success responses
  (15 searches, 15 profiles, 3 paging calls, status) were identical JSON.
  Deliberate differences: bad input returns 422 (was 400), `id=0` is a 422
  (was a 404), a `q` over 500 chars is rejected (was truncated to 100), only
  the four web assets and `data/*.json` are served (the old server also served
  the `.py` sources), and `/docs` + `/openapi.json` now exist. Plan: step 2 is
  React + Vite + TypeScript for search/profile (TanStack Query for calls,
  Vite dev proxy to this API, so CORS isn't needed), step 3 moves the charts.
  Note: a running `server.py` keeps the code it started with; restart it to
  pick up backend changes.
- Design system: deep ink-navy background (#12172B), brass-gold accent
  (#C9A227), verdigris secondary accent (#5B8A82); Source Serif 4 for
  headlines, IBM Plex Sans/Mono for body/data -- deliberately avoiding
  generic "SaaS dashboard" cliches per the frontend-design guidance.
- Charting library: ECharts (CDN, no build step) -- chosen for its
  built-in heatmap and force-directed graph support (used for the
  co-authorship network).
- Must be served via a local web server (`python -m http.server`) --
  opening `index.html` directly will fail on the JSON fetches due to
  CORS restrictions on the `file://` protocol.
- Status: built, run, and verified rendering correctly (headless-browser
  screenshot check, zero console errors, zero failed requests). The first
  version ran `preprocess.py` against `dblp_after_2018.csv` (1,733,499
  records, the biased sample -- see bug #6); the all-years branch re-ran it
  against the full parse. Either way it produces the 13 JSON files under
  `dashboard/data/`, served with `python -m http.server`. Real bugs found
  only by actually rendering the page (not visible from reading the code):
  - the pinned `echarts@5.5.1` CDN URL 404'd (see bug #5 above) --
    bumped to `echarts@6.1.0`.
  - the "Top Venues" bar chart's value-axis tick labels overlapped
    into unreadable text in the narrower card width -- added a `k`
    -abbreviation formatter (`5k`, `10k`, ...); also fixed a latent
    `Object.assign` merge-order bug in the same helper that was
    silently discarding a custom `axisLabel.fontSize`.
  - the type-distribution donut's outside pie labels ("Conference
    paper") were clipped at the canvas edge in the narrow card --
    switched to inside `{d}%` labels, relying on the legend for names.
  All 12 charts (publications/year, article-vs-conference donut, top
  authors, top venues, co-author-count distribution, avg team size over
  time, author productivity, distinct venues/year, top title words,
  topic-prevalence trends, venue-comparison trends, co-authorship force
  graph) render with real data. Next step, if any: writeup/polish only.

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
