"""Evaluate the Ask feature: retrieval quality, and answer correctness per model.

    python rag_eval.py                       retrieval only (no language model needed)
    python rag_eval.py --answers             also ask the default provider the aggregate questions
    python rag_eval.py --answers --provider groq --model llama-3.1-8b-instant

1. Retrieval. Each topic query is phrased the way a person would ask, often
   without the words the papers' titles use, and comes with a regular
   expression that a relevant title matches. precision@20 = the share of the
   top 20 titles that match. This is an automatic proxy (a relevant title can
   miss the pattern), so compare methods with it rather than reading it as an
   absolute score.
   Methods: keyword (BM25), semantic (vectors), hybrid (both, fused). Semantic
   and hybrid need build_title_vectors.py; with --min-year, every method is
   restricted to those years so the comparison stays fair.

2. Answers. Questions whose correct answer is computed here straight from the
   index (the same counts the tools return); an answer is correct if it states
   that value. This checks the model's tool use and reading of the results,
   not the retrieval.
"""
import argparse
import re
import sys
import time

import author_index as ai
import rag_agent
import title_search as ts
from api import INDEX_PATH, NOT_BUILT

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
        print(f"(no usable title vectors: {vec['error'] or 'run build_title_vectors.py'}; keyword only)\n")

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
    print(f"{'mean':58}" + "".join(f"{sum(s) / len(s):10.2f}" for s in scores.values()))


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


def answers(conn, provider, model):
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
        ok = error is None and any(a.lower() in text.lower() for a in accepted)
        correct += ok
        print(f"{'OK ' if ok else 'BAD'} {time.time() - started:5.1f}s {calls} calls  {question}")
        if not ok:
            print(f"      expected one of {sorted(accepted)}; got: {error or text.strip()[:300]!r}")
    print(f"\n{correct}/{len(cases)} correct ({provider} / {model})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--answers", action="store_true", help="also evaluate answers (calls the language model)")
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--min-year", type=int, help="retrieval over papers from this year on "
                                                     "(default: the vectors' own --min-year)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    conn = ai.connect(INDEX_PATH)
    if conn is None:
        sys.exit(NOT_BUILT)
    if not ts.has_bm25(conn):
        sys.exit("Title index not built yet. Run: python build_title_index.py")
    retrieval(conn, args.min_year or ts.vectors_status(conn)["min_year"])
    if args.answers:
        print()
        answers(conn, args.provider, args.model)


if __name__ == "__main__":
    main()
