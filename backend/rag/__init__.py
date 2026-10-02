"""Ask: questions about DBLP answered by a language model that calls fixed tools.

    title_search.py         keyword (FTS5), semantic (FAISS) and hybrid title search, topic counts
    tools.py                the tools the model may call (it never writes SQL)
    agent.py                the tool-calling loop; yields the events /api/ask streams
    llm.py                  provider presets (Groq, Mistral, Gemini, OpenRouter, Ollama, custom)
    build_title_index.py    adds the title keyword index to authors.sqlite
    build_title_vectors.py  builds the semantic index (GPU if available)
    ask_cli.py              the same agent in the terminal
    eval.py                 retrieval precision per method, answer correctness per model

Imported as `rag.<module>` with backend/ on the import path (api.py, server.py).
The scripts can be run directly from any folder, e.g. `python rag/ask_cli.py`.
API keys live in backend/.env (template: backend/.env.example).
"""
