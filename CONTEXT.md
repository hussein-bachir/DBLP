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

## Current task: the JS dashboard
- `dashboard/preprocess.py` aggregates the CSV into small JSON files
  (under `dashboard/data/`) since the raw CSV (millions of rows) is too
  large to load client-side.
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
  screenshot check, zero console errors, zero failed requests). Ran
  `preprocess.py` against `dblp_after_2018.csv` (1,733,499 records after
  the 2019-2025 filter) to produce the 13 JSON files under
  `dashboard/data/`, served the folder with `python -m http.server`, and
  fixed two real bugs found only by actually rendering the page (not
  visible from reading the code):
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
