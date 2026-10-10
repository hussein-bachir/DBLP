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
  `dashboard/preprocess.py`), `export_openapi.py`; `backend/rag/` -- the Ask
  feature (moved there from `backend/` on 2026-10-02, with `rag_agent.py`,
  `rag_tools.py`, `rag_eval.py` renamed to `agent.py`, `tools.py`, `eval.py`)
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
  changes re-run the layout. Degree centrality (computed by networkx in
  `build_chart_data.py`: co-authors among the other 149 / 149, over every link
  regardless of the sliders) is shown in the node tooltip and in the highlight
  status line with a rank (ties share it). Caveat for the report: the most
  "central" authors are common Chinese names without a DBLP number (Wei Wang
  0.45, Yang Liu 0.44, Wei Li, Yang Li, Yan Li). Each of these names is most
  likely several different people that DBLP has not split apart, which would
  inflate their centrality (not verified). A profile of an author who is in the network has a
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
- **Tests**: 184 frontend tests (Vitest + Testing Library; 37 of them for Ask). Pure logic (chart
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

## Ask the data (RAG question answering, 2026-10-02)

`/ask` answers natural-language questions about the dataset with a language
model that calls fixed tools over `authors.sqlite`, and cites the papers it used.

- **Why tools, not plain top-k retrieval**: DBLP has only title, year, venue and
  authors (no abstracts), and many questions are aggregates ("how many...",
  "who publishes most on...") that retrieving k titles can't answer. So the
  model gets four tools (`backend/rag/tools.py`): `search_papers` (hybrid title
  search), `topic_stats` (exact counts of titles containing every query word,
  by year/venue/author/type), `find_author` and `author_profile` (reusing
  `author_index`). It never writes SQL. At most 5 tool rounds per question.
- **Retrieval** (`backend/rag/title_search.py`): FTS5 BM25 over titles
  (`build_title_index.py`, ~1 min, adds `papers_fts` to `authors.sqlite`) plus
  optional sentence-transformer vectors in FAISS (`build_title_vectors.py`),
  merged with reciprocal rank fusion. Without vectors it degrades to
  keyword-only and the page says so.
- **Providers** (`backend/rag/llm.py`): the user won't use pay-as-you-go APIs, so
  presets are free tiers (Groq, Mistral, Gemini, OpenRouter) plus Ollama and any
  OpenAI-compatible URL; one OpenAI SDK client covers all. Only providers with a
  key (or a running Ollama) are offered; the page switches per question.
  Provider errors (rate limit, bad key, unknown model) become one-line messages.
- **Citations**: every paper a tool returns gets a ref `P1, P2, ...`; the answer
  cites `[P3]`, and the `done` event lists only refs that exist. Refs the model
  invents are dropped (seen in practice: qwen2.5-coder 7B cited `[P1]`..`[P5]`
  for venues when no paper had been returned).
- **Verified** (Ollama, qwen2.5-coder:7b on CPU, 35-165 s per answer):
  transformer-titles-per-year counts matched SQL exactly and carried the
  incomplete-years note; the federated-learning-in-healthcare answer's 12
  citations all resolved to real records; "Hussein Hazimeh" listed both DBLP
  people. That model writes tool calls as text, which the agent now accepts
  (see CLAUDE.md). A free hosted 70B model (Groq) is expected to be much faster
  and better at reading results; not yet tested (no key configured).
- **Hosted providers verified (2026-10-02)**: Groq `openai/gpt-oss-120b` (8-11 s)
  and Mistral `ministral-14b-latest` (7 s) both returned the exact
  transformer-per-year counts. Lessons: (1) free-tier catalogues change --
  Groq no longer serves `llama-3.3-70b-versatile`, so `llm.py` now reads each
  provider's live `/models` list (cached 10 min, non-chat models filtered out)
  and falls back from a vanished default; (2) a free Mistral key gets the
  Ministral models only -- Small/Medium/Magistral answer 429 with
  `x-ratelimit-limit-req-minute: 0`, which is reported as "not in your plan",
  not "wait a minute"; (3) GPT-OSS cites as `【P1】`, which both the backend and
  `linkCitations` now accept.
- **Scope: DBLP data only (2026-10-03)**: the user wants Ask to answer only
  questions about the DBLP data, never from the model's own knowledge. The
  system prompt says every statement must come from tool results: no
  explaining concepts, describing papers beyond their titles, or saying who a
  person is. Three cases: a question needing data DBLP lacks (countries,
  affiliations, citations) says so in one sentence and answers the closest
  thing with the tools (e.g. top authors/venues); a concept question ("what is
  a transformer?") gets a fixed decline that suggests the DBLP version
  ("How many papers about transformers were published each year?"); anything
  else (geography, writing code, chit-chat, "ignore your instructions") gets
  the general decline. Both declines start with "I only answer questions about
  the DBLP publication data". (An earlier version of the rule let concept
  questions get a two-sentence explanation; the user asked for none.)
  **Guard in code** (`rag.agent.is_decline` / `NUDGE`): an answer that used no
  tool is accepted only if it is a decline. Prompt wording alone wasn't enough:
  Mistral ministral-14b answered the country question with invented counts
  ("Geoffrey Hinton: 187 papers", "NeurIPS: 12,456") and 0 tool calls. Now such
  an answer is retracted and the model is told once to use the tools; in 3/3
  runs Mistral then answered from real data. (A first nudge wording that also
  offered the decline let Mistral just decline.)
  Tests (Groq gpt-oss-120b, Mistral ministral-14b): concept and off-topic
  questions declined with no tool calls; prompt injection declined; "papers on
  GNNs for drug discovery" lists real titles without describing them;
  `eval.py --answers` 6/6 for both. Local qwen2.5-coder 7B declines concept
  questions too, which now matches the rule.
  Also fixed along the way: the embedding model loads from the local cache
  (`title_search.load_model`; loading by name contacted huggingface.co every
  time and, offline, retried ~25 s); "Hussein Hazimeh" covered only 0001, so
  the shared-name rule now requires listing each person first; `eval.py`'s
  checker accepts GPT-OSS's narrow no-break spaces ("12 120") and pauses
  between questions; the client retries a 429 up to 3 times; GPT-OSS sometimes
  writes `[` + zero-width space + `P1]`, which left Sources empty, so both
  citation patterns now allow zero-width characters inside the brackets.
- **Per-answer diagnostics (2026-10-09)**: every answer now shows how it was
  produced: a summary line (e.g. "hybrid search · 2 lookups · 6.1 s · 1,850
  tokens") with a collapsible Details panel listing search methods and candidate
  counts, the semantic coverage of the asked years (full / partial / none: the
  vectors cover 2024+), the time split between model and tools, tokens, citation
  checks, and whether the guard or a retract fired. Accuracy of a single answer
  can't be measured (no ground truth), so the panel quotes `rag/eval.py`'s
  test-set figures, now saved to `data/processed/eval_results.json`, and keeps
  three layers apart: data (exact queries, but title keywords only), search
  (precision@20: keyword 0.62, semantic/hybrid 0.68) and model (answer checks:
  Groq gpt-oss-120b 6/6, Mistral ministral-14b 6/6; Ollama untested). Tokens are
  reported by Groq, Mistral and Ollama (`stream_options.include_usage`, with a
  fallback for providers that reject it). What the panel exposed right away:
  (1) the embedding model's first load costs ~18 s per process (fine in the
  server after the first question; a startup warm-up would remove it);
  (2) semantic search ran and discarded everything for years it doesn't cover,
  so `hybrid` now skips it when coverage is "none" ("before 2020" question:
  22.9 s -> 4.6 s; eval scores unchanged); (3) with Ollama loaded, a simple
  count took 24 s instead of 1.2 s (RAM pressure evicts SQLite's cache);
  (4) some Groq answers list papers without citing them (0 citations), which
  is now visible per answer.
- **Search model loaded at startup (2026-10-10)**: the embedding model and
  FAISS index used to load on the first question that needed them (18-47 s on
  that question). `api.py` now starts `title_search.warm_up` in a background
  thread from FastAPI's lifespan hook, so the server answers at once (status in
  0.01 s during loading), the model is ready ~35 s later on a cold disk cache,
  and the first question took 6.1 s in total (search 3.8 s). A question arriving
  during loading waits on the loader's lock instead of loading a second copy.
  Measured again after a restart: model loaded in 16.8 s (warm disk cache); a
  question that arrived mid-load waited on the lock (search 12.9 s) and did not
  load a second copy.
  While testing this, `backend/rag/title_search.py` was overwritten on disk three
  times by something outside this session: twice with the commit-ac13b4c version
  (identical to the `.claude/worktrees/rag-slides` copy), dropping the diagnostics
  code, and once with an interleaved, corrupted mix that no longer parsed. It
  stopped once the user closed the file in their editor; the file was restored
  from git and watched for 60 s. Close or reload files open in an editor before
  changing them outside it, and check `git diff` before committing.
- **Faster answers (2026-10-10)**: measured with a throwaway benchmark
  (`.claude/bench/`, untracked): search on fixed queries with a fresh connection
  per run, the slow count queries, and five questions end to end on Groq.
  (1) `hybrid` ran the "some words" keyword query on every search although its
  results only fill a list that is short; it now runs only then
  (`keyword_any` is null in the diagnostics otherwise). Same results on every
  benchmark query; searches 0.9-2.5 s -> 0.03-0.34 s. (2) `author_index.connect`
  sets `PRAGMA mmap_size`: each request opens a new connection, so SQLite's own
  page cache always started empty. Counts 2.5-3x faster ("deep learning" by
  author 3.45 -> 1.10 s, "learning" by author 2024+ 6.6 -> 2.3 s), and first runs
  no longer spike to 5-13 s. SQLite caps the mapping at ~2 GB of the 2.8 GB file.
  (3) Asking the model to request all lookups in one turn was tried and
  reverted: rounds went up (2,2,3,3,3 -> 3,2,4,3,4) and tokens with them.
  End to end (with pauses for rate limits): 2.5-33.4 s before, 1.6-3.8 s after;
  tool time 0.1-20.8 s -> 0.0-1.0 s. Search precision unchanged (0.62 / 0.68 /
  0.68), Groq 6/6. Remaining latency is mostly the model side, and on Groq's free
  tier long waits are rate-limit retries (seen: 6 s then 30 s) once a question
  sends ~8-11k tokens; sending fewer tokens per question would cut those.
- **Vectors**: this laptop has no GPU; CPU embedding runs at ~285 titles/s
  (all 8.4M would take ~8 h), so a `--min-year 2024` subset was built:
  1,540,807 titles, ~86 min of embedding, then FAISS IVF4965,PQ48 trained in
  ~3 min (index 0.09 GB). Kill-and-resume verified (picked up at 50,000 in
  12 s). The first index attempt was stopped by Claude Code for low system
  memory during FAISS training; the training sample was then cut to 50 vectors
  per IVF list (~248k) and the re-run went straight to the index step. Older
  papers are found by keyword search only; build the full set on the GPU
  machine (`build_title_vectors.py --restart`, no `--min-year`).
- **Evaluation** (`backend/rag/eval.py`): retrieval precision@20 on ten
  paraphrased topic queries, judged by a title regex per query (an automatic
  proxy), over 2024+ papers: keyword 0.62, semantic 0.68, hybrid 0.68.
  Semantic search fixes paraphrases ("collaborative model training without
  sharing patient data" 0.15 -> 0.50, "using large language models to write
  source code" 0.00 -> 0.60); keyword wins on literal ones ("explaining the
  predictions of black-box models" 0.95 vs 0.75). **Fusion bug found by the
  eval:** plain RRF of any-word BM25 with the vectors scored 0.62, below
  semantic alone, because titles sharing one loose word ("model", "data")
  pushed out the good semantic hits. Fix (`title_search.hybrid`): keyword
  votes in the fusion only with titles containing every query word; any-word
  matches just fill the list after the fused results (that is how pre-2024
  papers, which have no vector, are still found). Variants tried on the same
  queries: down-weighting keyword to 0.5 gave 0.65; the all-words rule was
  kept because it has a reason beyond these ten queries, not just the best
  score. "teaching robots by trial and error" stays at ~0 for every method.
  `--answers` checks six aggregate questions against SQL-computed truth.

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
