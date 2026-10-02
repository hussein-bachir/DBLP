"""Ask DBLP a question from the command line (same agent as the /ask page).

    python ask_cli.py "How many papers mention transformers each year since 2015?"
    python ask_cli.py --provider ollama --model qwen2.5:7b "Where does Hussein Hazimeh publish?"
    python ask_cli.py --list          (the providers usable right now)
"""
import argparse
import sys
import time

import author_index as ai
import llm
import rag_agent
from api import INDEX_PATH, NOT_BUILT


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


if __name__ == "__main__":
    main()
