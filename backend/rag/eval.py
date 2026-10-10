"""Evaluate the Ask feature: retrieval quality, and answer correctness per model.

    python rag/eval.py                       retrieval only (no language model needed)
    python rag/eval.py --answers             also ask the default provider the aggregate questions
    python rag/eval.py --answers --provider groq --model llama-3.1-8b-instant

1. Retrieval. Each topic query is phrased the way a person would ask, often
   without the words the papers' titles use, and comes with a regular
   expression that a relevant title matches. precision@20 = the share of the
   top 20 titles that match. This is an automatic proxy (a relevant title can
   miss the pattern), so compare methods with it rather than reading it as an
   absolute score.
   Methods: keyword (BM25), semantic (vectors), hybrid (both, fused). Semantic
   and hybrid need rag/build_title_vectors.py; with --min-year, every method is
   restricted to those years so the comparison stays fair.

2. Answers. Questions whose correct answer is computed here straight from the
   index (the same counts the tools return); an answer is correct if it states
   that value. This checks the model's tool use and reading of the results,
   not the retrieval.
"""
import argparse
import json
import os
import re
import sys
import time

if __name__ == "__main__":  # run as a script: import from backend/ (author_index, api, rag), not backend/rag/
    sys.path[0] = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

import author_index as ai  # noqa: E402
from api import INDEX_PATH, NOT_BUILT  # noqa: E402
from rag import agent as rag_agent, title_search as ts  # noqa: E402

K = 20

TOPICS = [
    ("collaborative model training without sharing patient data", r"federated"),
    ("using large language models to write source code",
     r"(code|program).*(generat|synthes|complet)|(generat|synthes|complet).*(code|program)"),
    ("detecting fake news on social media", r"fake news|misinformation|disinformation|rumou?r"),
    ("finding tumours in MRI scans automatically", r"(tumou?r|glioma|lesion|cancer).*(segment|detect)|(segment|detect).*(tumou?r|glioma|lesion|cancer)"),
    ("teaching robots by trial and error", r"reinforcement|reward"),
    ("neural networks on molecular graphs for drug discovery", r"molecul|drug|chemi"),
    ("protecting quantum computers from noise", r"quantum.*(error|noise|fault|decoher)|(error|noise|fault|decoher).*quantum"),
    ("explaining the predictions of black-box models", r"explain|interpretab|\bxai\b|explanation"),
    ("speech recognition for languages with little data", r"speech|asr\b|spoken"),
    ("security bugs in smart contracts", r"smart contract|solidity|ethereum"),
]


def retrieval(conn, min_year):
    filters = {"year_from": min_year} if min_year else {}
    vec = ts.vectors_status(conn)
    methods = {"keyword": lambda q: ts.bm25(conn, q, K, **filters)}
    if vec["available"]:
        methods["semantic"] = lambda q: ts.semantic(conn, q, K, **filters)
        methods["hybrid"] = lambda q: [p["id"] for p in ts.hybrid(conn, q, K, **filters)["papers"]]
    else:
        print(f"(no usable title vectors: {vec['error'] or 'run rag/build_title_vectors.py'}; keyword only)\n")

    scores = {m: [] for m in methods}
    print(f"precision@{K}" + (f", papers from {min_year} on" if min_year else ""))
    print(f"{'query':58}" + "".join(f"{m:>10}" for m in methods))
    for query, pattern in TOPICS:
        rx = re.compile(pattern, re.I)
        row = []
        for name, run in methods.items():
            ids = run(query)
            titles = [p["title"] or "" for p in ts.papers(conn, ids)]
            p = sum(bool(rx.search(t)) for t in titles) / K
            scores[name].append(p)
            row.append(p)
        print(f"{query[:57]:58}" + "".join(f"{p:10.2f}" for p in row))
    means = {name: round(sum(s) / len(s), 2) for name, s in scores.items()}
    print(f"{'mean':58}" + "".join(f"{m:10.2f}" for m in means.values()))
    return {"methods": means, "queries": len(TOPICS), "k": K, "min_year": min_year,
            "date": time.strftime("%Y-%m-%d")}


_DIGIT_SEP = re.compile(r"(?<=\d)[,.\s\u00a0\u202f\u2009'](?=\d{3})")  # thousands separators incl. (narrow) no-break and thin spaces
_SPACES = re.compile(r"[\s\u00a0\u202f\u2009]+")


def _plain(text):
    """Lower-case, thousands separators removed ("12 120" -> "12120"), other spaces made plain.

    GPT-OSS writes narrow no-break spaces both in numbers and between names ("Dusit Niyato").
    """
    return _SPACES.sub(" ", _DIGIT_SEP.sub("", text)).lower()


def _num(n):
    return {str(n), f"{n:,}"}


def answer_cases(conn):
    """(question, accepted strings) with the truth computed from the index."""
    def count(query, **kw):
        return ts.topic_stats(conn, query, "type", **kw)["total"]

    def top(query, group_by):
        return ts.topic_stats(conn, query, group_by, limit=1)["groups"][0]["key"]

    hazimeh = next(r for r in ai.search(conn, "Hussein Hazimeh")["results"] if r["name"].endswith("0002"))
    venue = top("graph neural network", "venue")
    venue_names = {venue, venue.split("/")[1]} | ({"arXiv", "CoRR"} if venue == "journals/corr" else set())
    return [
        ("How many papers have the word 'transformer' in their title in 2023?",
         _num(count("transformer", year_from=2023, year_to=2023))),
        ("How many papers with 'federated learning' in the title were published in 2022?",
         _num(count("federated learning", year_from=2022, year_to=2022))),
        ("Which venue has the most papers with 'graph neural network' in the title?", venue_names),
        ("Who has the most papers with 'federated learning' in the title?",
         {ai._SUFFIX.sub("", top("federated learning", "author"))}),
        ("How many papers does Hussein Hazimeh 0002 have in DBLP?", _num(hazimeh["n_papers"])),
        ("How many journal articles in total were published in 2020?",
         _num(next(g["count"] for g in ts.topic_stats(conn, "", "type", year_from=2020, year_to=2020)["groups"]
                   if g["key"] == "article"))),
    ]


def answers(conn, provider, model, pause):
    correct = 0
    cases = answer_cases(conn)
    for question, accepted in cases:
        started = time.time()
        text, error, calls = "", None, 0
        for event in rag_agent.answer(conn, question, provider, model):
            if event["type"] == "token":
                text += event["text"]
            elif event["type"] == "retract":
                text = ""
            elif event["type"] == "error":
                error = event["message"]
            elif event["type"] == "done":
                calls = event["tool_calls"]
                provider, model = event["provider"], event["model"]
        ok = error is None and any(_plain(a) in _plain(text) for a in accepted)
        correct += ok
        print(f"{'OK ' if ok else 'BAD'} {time.time() - started:5.1f}s {calls} calls  {question}")
        if not ok:
            print(f"      expected one of {sorted(accepted)}; got: {error or text.strip()[:300]!r}")
        time.sleep(pause)   # free tiers limit tokens per minute
    print(f"\n{correct}/{len(cases)} correct ({provider} / {model})")
    return f"{provider}/{model}", {"correct": correct, "total": len(cases), "date": time.strftime("%Y-%m-%d")}


def save_results(retrieval_scores, answer_scores=None):
    """Write the figures the Ask page shows under each answer (rag.agent.tested_figures).

    Answer scores are kept per provider/model, so evaluating one model keeps the others'.
    """
    try:
        with open(rag_agent.EVAL_RESULTS, encoding="utf-8") as f:
            results = json.load(f)
    except (OSError, ValueError):
        results = {}
    results["retrieval"] = retrieval_scores
    if answer_scores:
        results.setdefault("answers", {})[answer_scores[0]] = answer_scores[1]
    tmp = rag_agent.EVAL_RESULTS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    os.replace(tmp, rag_agent.EVAL_RESULTS)
    print(f"\nsaved to {os.path.abspath(rag_agent.EVAL_RESULTS)} (shown under each answer on the Ask page)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--answers", action="store_true", help="also evaluate answers (calls the language model)")
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--pause", type=float, default=8, help="seconds between answer questions (rate limits)")
    parser.add_argument("--min-year", type=int, help="retrieval over papers from this year on "
                                                     "(default: the vectors' own --min-year)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    conn = ai.connect(INDEX_PATH)
    if conn is None:
        sys.exit(NOT_BUILT)
    if not ts.has_bm25(conn):
        sys.exit("Title index not built yet. Run: python rag/build_title_index.py")
    retrieval_scores = retrieval(conn, args.min_year or ts.vectors_status(conn)["min_year"])
    answer_scores = None
    if args.answers:
        print()
        answer_scores = answers(conn, args.provider, args.model, args.pause)
    save_results(retrieval_scores, answer_scores)


if __name__ == "__main__":
    main()
