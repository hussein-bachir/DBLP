# 📚 DBLP Research Explorer

## 📌 Project Overview

The **DBLP Research Explorer** turns the full **DBLP computer science bibliography** into an interactive analytics dashboard, a researcher search engine, and a question-answering assistant powered by **Large Language Models (LLMs)**.

It processes the complete DBLP XML dump, **8.4 million publications by 4.3 million authors**, and offers three ways to explore it:
- 📊 **Dashboard:** 11 interactive charts and a co-authorship network
- 🔎 **Researcher lookup:** find any of the 4.3M authors and open their profile
- 💬 **Ask the data:** natural-language questions answered by an LLM agent, **only from DBLP data**, with cited sources

This project was built for a Master's course at the Lebanese University.

---

# 🎯 Project Objectives

* Parse the full DBLP XML dump reliably and memory-safely
* Analyse publication trends across all years of computer science research
* Make millions of records explorable in the browser
* Let users find and tell apart researchers who share the same name
* Answer natural-language questions about the data **without hallucination**
* Measure the quality of search and answers instead of guessing

---

# 🧠 Features

## 1. 📊 Analytics Dashboard

Interactive charts covering every record from 1936 to 2025:

* Publications per year and journal vs. conference share
* Top authors and top venues
* Average team size over time
* Topic trends from title keywords
* Author productivity and co-author distributions
* **Co-authorship network** of the 150 most prolific authors, with adjustable link thresholds, author search and degree centrality

---

## 2. 🔎 Researcher Lookup

* Search **any of the 4.3M authors** by any fragment of their name, in any word order, with or without accents
* Typo-tolerant: a misspelled name still finds close matches
* Profiles show papers per year, top venues, co-authors and the full publication list, linked to dblp.org
* Helps tell apart **different people who share the same name**, using their venues and co-authors

---

## 3. 💬 Ask the Data (RAG Assistant)

A tool-calling LLM agent that answers questions such as *"How many papers about transformers were published each year?"* or *"Who publishes most on federated learning?"*

### 🔹 How it works

The model never writes SQL. It can only call four fixed tools:

| Tool | Purpose |
|-----------|------------|
| `search_papers` | Hybrid title search (keyword + semantic) |
| `topic_stats` | Exact counts by year, venue, author or type |
| `find_author` | Look up researchers by name |
| `author_profile` | Venues, co-authors and recent papers of an author |

Many questions are aggregates ("how many…", "who publishes most…") that plain top-k retrieval cannot answer, so the agent combines search with exact statistics.

---

### 🔹 Keeping answers grounded

* **Answers only from DBLP data.** Concept explanations and outside knowledge are declined.
* **A guard in code:** an answer that used no tool is retracted and the model is asked to use the tools. During testing, one model invented paper counts without calling any tool; prompt instructions alone were not enough.
* **Verified citations:** every paper a tool returns gets a reference (`[P1]`, `[P2]`, …). References the model invents are dropped.
* **Per-answer diagnostics:** search methods used, timings, tokens, citation checks, and whether the guard fired.

---

### 🔹 Hybrid search

* **Keyword search:** SQLite FTS5 (BM25) over all 8.4M titles
* **Semantic search:** `all-MiniLM-L6-v2` embeddings in a FAISS IVF-PQ index
* **Fusion:** reciprocal rank fusion of both

---

### 🔹 Works with many LLM providers

Free tiers of **Groq, Mistral, Gemini and OpenRouter**, local models through **Ollama**, or any OpenAI-compatible server. The agent also handles small local models that write tool calls as plain text, and respects providers' rate limits.

---

# 📏 Evaluation

The assistant is evaluated on a fixed test set (`backend/rag/eval.py`).

### 🔹 Retrieval quality (precision@20, 10 paraphrased topic queries)

| Method | Precision@20 |
|-----------|------------|
| Keyword (BM25) | 0.62 |
| Semantic (embeddings) | 0.68 |
| **Hybrid (final)** | **0.68** |

The evaluation exposed a real bug: a naive fusion of both methods scored **0.62**, below semantic search alone, because titles sharing a single common word pushed out good semantic matches. Fusing only titles that contain every query word fixed it.

### 🔹 Answer correctness

Six aggregate questions are checked against answers computed independently in SQL:

| Model | Correct answers |
|-----------|------------|
| Groq `gpt-oss-120b` | 6 / 6 |
| Mistral `ministral-14b` | 6 / 6 |

### 🔹 Speed

After optimisation, end-to-end answers take about **1.6–3.8 s** on Groq (previously 2.5–33 s).

---

# 🧹 Data Challenges Solved

Parsing the full dump revealed several non-obvious problems:

* **DTD entities:** loading the DTD through the streaming parser triggers a libxml2 bug, so entities are resolved manually
* **Memory-safe streaming:** the classic `parent.remove(elem)` cleanup silently stopped the parser partway through the file; replaced with `elem.clear()` and deleting previous siblings
* **Sampling bias:** the dump is not randomly ordered. An early sample showed **24% journal articles against a true 52%**, so all findings use the full parse
* **Garbled accented names:** the dump's encoding declaration caused names like *Mérouane* to appear as *MÃ©rouane* (241,638 names affected); fixed at the source
* **Truncated titles:** titles containing inline markup were cut off; 70,227 titles were repaired
* **Indexing lag:** the most recent years are incomplete in DBLP, so charts stop at 2025

---

# 🛠️ Technologies Used

| Component | Technology |
|-----------|------------|
| Data pipeline | Python, lxml, pandas, NumPy |
| Graph analysis | NetworkX |
| Search index | SQLite (FTS5, trigram index) |
| Semantic search | sentence-transformers, FAISS |
| LLM integration | OpenAI-compatible SDK (Groq, Mistral, Gemini, OpenRouter, Ollama) |
| Backend | FastAPI, Uvicorn |
| Frontend | React, TypeScript, Vite |
| Charts | ECharts |
| Data fetching | TanStack Query, zod |
| Testing | Vitest, Testing Library |

---

# 📂 Repository Structure

```text
DBLP/
│
├── pipeline/            # parse_dblp.py: streams the XML dump into a CSV
├── data/                # raw dump and processed files (large files are gitignored)
├── backend/
│   ├── api.py           # FastAPI app and /api endpoints
│   ├── server.py        # launches the API and serves the built frontend
│   ├── author_index.py  # author search and profiles
│   ├── build_author_index.py
│   ├── build_chart_data.py
│   └── rag/             # Ask the data: agent, tools, search, LLM providers, evaluation
├── frontend/            # React + TypeScript app (dashboard, profiles, Ask page)
├── analysis/            # original exploratory matplotlib scripts
├── requirements.txt
└── README.md
```

Data flows one way: `pipeline/` → `data/` → `backend/` → `frontend/`.

---

# ▶️ Setup & Installation

## 1. Clone the repository

```bash
git clone https://github.com/hussein-bachir/DBLP.git
cd DBLP
```

---

## 2. Create virtual environment (Python 3.12)

```bash
python -m venv venv
```

Activate environment:

```bash
# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate
```

---

## 3. Install dependencies

```bash
pip install -r requirements.txt
cd frontend && npm install && cd ..
```

---

## 4. Get the data

Download `dblp.xml.gz` and `dblp.dtd` from [dblp.org/xml](https://dblp.org/xml/) into `data/raw/`.

---

# ▶️ Running the Project

## 🔹 Build the data (run once, in order)

```bash
python pipeline/parse_dblp.py                 # full dump → data/processed/dblp_full.csv
python backend/build_chart_data.py            # chart data for the dashboard (~6 min)
python backend/build_author_index.py          # SQLite author index (~6 min, ~2.4 GB)
python backend/rag/build_title_index.py       # keyword search index (~1 min)
python backend/rag/build_title_vectors.py --min-year 2024   # optional: semantic search
```

Semantic vectors for all 8.4M titles take hours on CPU; use `--min-year`, or a GPU.

---

## 🔹 Configure an LLM (for Ask the data)

Copy `backend/.env.example` to `backend/.env` and add at least one free API key (Groq, Mistral, Gemini or OpenRouter), or run Ollama locally.

---

## 🔹 Start the app

```bash
cd frontend && npm run build && cd ..
python backend/server.py
```

Open **http://localhost:8000**.

---

# 🧪 Example Questions

* *How many papers about transformers were published each year?*
* *Which venues publish the most on federated learning in healthcare?*
* *Where does Hussein Hazimeh 0002 publish, and who are his co-authors?*
* *What is a transformer?* → declined: the assistant only answers from DBLP data

---

# 🚨 Challenges & Limitations

* DBLP contains **titles, years, venues and authors only**, with no abstracts, affiliations or citations
* Semantic search currently covers 2024+ titles; older papers are found by keyword search
* DBLP has not separated some people who share a common name, which can inflate their statistics
* Free LLM tiers have rate limits, so long multi-step questions can be slowed down

---

# 📚 Key Learning Outcomes

This project demonstrates:
- Building a robust pipeline over a multi-gigabyte real-world dataset
- Detecting and correcting sampling bias and data-quality issues
- Designing tool-calling LLM agents that stay grounded in data
- Combining keyword and semantic retrieval, and evaluating them honestly
- Building a full-stack data application with a typed API and tested frontend

---

# 💡 Future Improvements

* Embed all 8.4M titles on a GPU so semantic search covers every year
* Expand the evaluation set for retrieval and answers
* Shorten prompts and tool definitions to reduce tokens per question
* Add more sources (e.g. abstracts or citations) to answer richer questions

---

# 🏁 Conclusion

The DBLP Research Explorer shows how a large, imperfect real-world dataset can be turned into reliable, explorable insight. Its central idea is that an LLM assistant should be **measured and constrained**, not trusted: every answer is grounded in tools, every citation is verified, and every design choice is backed by an evaluation.
