"""Ask DBLP a question from the command line (same agent as the /ask page).

    python rag/ask_cli.py "How many papers mention transformers each year since 2015?"
    python rag/ask_cli.py --provider ollama --model qwen2.5:7b "Where does Hussein Hazimeh publish?"
    python rag/ask_cli.py --list          (the providers usable right now)
"""
import argparse
import os
import sys
import time

if __name__ == "__main__":  # run as a script: import from backend/ (author_index, api, rag), not backend/rag/
    sys.path[0] = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

import author_index as ai  # noqa: E402
from api import INDEX_PATH, NOT_BUILT  # noqa: E402
from rag import agent as rag_agent, llm  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("question", nargs="?")
    parser.add_argument("--provider")
    parser.add_argument("--model")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.list or not args.question:
        avail = llm.available()
        default = llm.default_provider(avail)
        for a in avail:
            print(f"{'*' if a['id'] == default else ' '} {a['id']:<11} {a['default_model']:<40} {', '.join(a['models'][:6])}")
        if not avail:
            print("No provider available: set a key in backend/.env (see .env.example) or start Ollama.")
        return

    conn = ai.connect(INDEX_PATH)
    if conn is None:
        sys.exit(NOT_BUILT)
    started = time.time()
    for event in rag_agent.answer(conn, args.question, args.provider, args.model):
        kind = event["type"]
        if kind == "token":
            print(event["text"], end="", flush=True)
        elif kind == "retract":
            print("\n  (preamble discarded)")
        elif kind == "status":
            print(f"  ... {event['text']}", flush=True)
        elif kind == "error":
            print(f"\nERROR: {event['message']}")
        elif kind == "done":
            print(f"\n\n[{event['provider']} / {event['model']}, {event['tool_calls']} tool calls, "
                  f"{time.time() - started:.1f}s]")
            for s in event["sources"]:
                print(f"  [{s['ref']}] {s['title']} ({s['venue']}, {s['year']})  https://dblp.org/rec/{s['key']}")
            for a in event["authors"]:
                print(f"  author: {a['name']} -> /author/{a['id']}")
            print_diagnostics(event["diagnostics"])


def print_diagnostics(d):
    """The same facts the Ask page shows under 'Details'."""
    first = "-" if d["first_token_seconds"] is None else f"{d['first_token_seconds']:.1f}s"
    tok = d["tokens"]
    tokens = "n/a" if tok is None else f"{tok['prompt']:,} in / {tok['completion']:,} out"
    print(f"\n  time {d['total_seconds']:.1f}s: model {d['model_seconds']:.1f}s in {d['rounds']} rounds, "
          f"tools {d['tool_seconds']:.1f}s, first text after {first} | tokens {tokens}")
    for step in d["steps"]:
        line = f"  - {step['summary']}: {step['results']} results, {step['seconds']:.2f}s"
        s = step["search"]
        if s:
            cap = s["cap"]
            n = lambda v: "not needed" if v is None else f"{v}+" if v >= cap else str(v)
            line += (f" [{'+'.join(s['methods'])}: all words {n(s['keyword_all'])}, some words "
                     f"{n(s['keyword_any'])}, by meaning {n(s['semantic'])}; semantic coverage {s['coverage']}]")
        if step["error"]:
            line += f" ERROR: {step['error']}"
        print(line)
    search, c = d["search"], d["citations"]
    if search["searches"]:
        print(f"  search: {', '.join(search['methods'])}; vectors cover {search['semantic_min_year'] or 'all years'}+, "
              f"coverage of the asked years: {search['coverage']}")
    print(f"  citations: {c['valid']} valid, {c['dropped']} made up and dropped"
          + (" | guard: answered without tools first, told to retry" if d["guard_nudged"] else "")
          + (f" | {d['retracted']} draft(s) withdrawn" if d["retracted"] else "")
          + (" | declined (out of scope)" if d["declined"] else ""))
    tested = d["tested"]
    if tested is None:
        print("  tested accuracy: not measured yet (run rag/eval.py)")
        return
    if tested["search"]:
        t = tested["search"]
        print(f"  tested: {t['method']} search precision@20 {t['precision']:.2f} on {t['queries']} test queries "
              f"({t['min_year'] or 'all years'}+, {t['date']})")
    if tested["model"]:
        t = tested["model"]
        print(f"  tested: this model {t['correct']}/{t['total']} answer checks ({t['date']})")
    else:
        print("  tested: this model not tested yet (python rag/eval.py --answers --provider ...)")
    print("  (test-set figures, not a measurement of this answer; counts are exact title-keyword matches)")


if __name__ == "__main__":
    main()
