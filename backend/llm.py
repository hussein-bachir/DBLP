"""The language models the Ask feature can use, switchable per request.

Every supported provider speaks the OpenAI chat-completions protocol (with tool
calling), so one client covers them all; a provider is just a base URL, a
default model and the environment variable holding its key. Keys and defaults
are read from the environment, and from backend/.env if present (copy
.env.example; .env is gitignored):

    LLM_PROVIDER      default provider id (else the first one available)
    GROQ_API_KEY      MISTRAL_API_KEY   GEMINI_API_KEY   OPENROUTER_API_KEY
    <ID>_MODEL        overrides a provider's default model, e.g. GROQ_MODEL
    OLLAMA_BASE_URL   default http://localhost:11434/v1 (local, no key)
    LLM_BASE_URL / LLM_API_KEY / LLM_MODEL   the "custom" provider: any other
                      OpenAI-compatible server (LM Studio, vLLM, Cerebras, ...)

Free-tier model names change; if a default stops working, set <ID>_MODEL or
type another model name in the app.
"""
import json
import os
import threading
import time
import urllib.request
from dataclasses import dataclass

from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    base_url: str
    default_model: str
    key_env: str | None      # None: no key needed (local)
    suggested: tuple = ()    # preferred models, best first, if the provider still serves them


PRESETS = (
    Provider("groq", "Groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-120b", "GROQ_API_KEY",
             ("openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile")),
    # free ("Experiment") keys get the Ministral models; Small/Medium may be capped at 0 requests/min
    Provider("mistral", "Mistral", "https://api.mistral.ai/v1", "ministral-14b-latest", "MISTRAL_API_KEY",
             ("ministral-14b-latest", "ministral-8b-latest", "mistral-small-latest", "mistral-medium-latest")),
    Provider("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/",
             "gemini-2.5-flash", "GEMINI_API_KEY", ("gemini-2.5-flash", "gemini-2.5-flash-lite")),
    Provider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1",
             "meta-llama/llama-3.3-70b-instruct:free", "OPENROUTER_API_KEY"),
    Provider("ollama", "Ollama (local)", os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
             "qwen2.5:7b", None),
)


def _custom():
    url = os.environ.get("LLM_BASE_URL")
    if not url:
        return None
    return Provider("custom", "Custom endpoint", url, os.environ.get("LLM_MODEL", ""), "LLM_API_KEY")


def providers():
    """Every configured provider (whether or not it is usable right now)."""
    custom = _custom()
    return {p.id: p for p in (*PRESETS, *([custom] if custom else []))}


def default_model(p):
    return os.environ.get(f"{p.id.upper()}_MODEL") or p.default_model


_ollama_cache = {"at": 0.0, "models": None}
_ollama_lock = threading.Lock()


def _ollama_models(p, ttl=30):
    """Installed model names if the Ollama server answers, else None. Cached for `ttl` s."""
    with _ollama_lock:
        if time.time() - _ollama_cache["at"] < ttl:
            return _ollama_cache["models"]
        root = p.base_url.rstrip("/").removesuffix("/v1")
        try:
            with urllib.request.urlopen(root + "/api/tags", timeout=0.7) as r:
                models = [m["name"] for m in json.load(r).get("models", [])]
        except (OSError, ValueError):
            models = None
        _ollama_cache.update(at=time.time(), models=models)
        return models


# Not chat models: speech, embeddings, OCR, moderation/guard models and the like.
_NOT_CHAT = ("whisper", "embed", "ocr", "tts", "moderation", "guard", "orpheus", "voxtral",
             "transcribe", "realtime", "fim", "allam", "image", "audio", "rerank")
_remote_cache = {}
_remote_lock = threading.Lock()


def _remote_models(p, ttl=600):
    """Chat model ids the provider serves now (GET /models), cached for `ttl` s; None if unknown.

    Free-tier catalogues change (Groq dropped its Llama models in 2026), so the
    picker and the default follow this list instead of trusting hard-coded names.
    """
    from openai import OpenAI, OpenAIError

    with _remote_lock:
        hit = _remote_cache.get(p.id)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        try:
            client = OpenAI(base_url=p.base_url, api_key=os.environ.get(p.key_env) or "none",
                            timeout=4, max_retries=0)
            ids = sorted(m.id for m in client.models.list())
            models = [m for m in ids if not any(word in m.lower() for word in _NOT_CHAT)]
        except OpenAIError as exc:
            print(f"{p.id}: could not list models ({type(exc).__name__}); using the presets")
            models = None
        _remote_cache[p.id] = (time.time(), models)
        return models


def _pick_default(p, models):
    """The model to use when none is chosen: an explicit <ID>_MODEL, else the first preferred
    model the provider still serves, else its first model."""
    wanted = os.environ.get(f"{p.id.upper()}_MODEL")
    if wanted or not models:
        return wanted or p.default_model
    return next((m for m in (p.default_model, *p.suggested) if m in models), models[0])


def available():
    """[{id, label, default_model, models}] for providers that can be used now:
    a key is set, or (Ollama) the local server answers."""
    out = []
    for p in providers().values():
        if p.id == "ollama":
            models = _ollama_models(p)
            if models is None:
                continue
            default = default_model(p)
            if models and default not in models:
                default = models[0]
            out.append({"id": p.id, "label": p.label, "default_model": default, "models": models})
        elif p.key_env and os.environ.get(p.key_env):
            served = _remote_models(p)
            default = _pick_default(p, served)
            if not default:
                continue
            # preferred models first, then everything else the provider serves
            preferred = [m for m in p.suggested if served is None or m in served]
            models = list(dict.fromkeys([default, *preferred, *(served or [])]))
            out.append({"id": p.id, "label": p.label, "default_model": default, "models": models})
    return out


def default_provider(avail=None):
    avail = available() if avail is None else avail
    ids = [a["id"] for a in avail]
    wanted = os.environ.get("LLM_PROVIDER")
    return wanted if wanted in ids else (ids[0] if ids else None)


class LLMUnavailable(Exception):
    """The requested provider can't be used (unknown, or no key / server)."""


def resolve(provider_id=None, model=None):
    """(OpenAI client, model name) for a request; raises LLMUnavailable."""
    from openai import OpenAI

    avail = {a["id"]: a for a in available()}
    provider_id = provider_id or default_provider(list(avail.values()))
    if provider_id is None:
        raise LLMUnavailable("No language model is configured. Set GROQ_API_KEY (or another provider's key) "
                             "in backend/.env, or start Ollama.")
    if provider_id not in avail:
        raise LLMUnavailable(f"Provider '{provider_id}' is not available (no API key set, or not running).")
    p = providers()[provider_id]
    api_key = os.environ.get(p.key_env) if p.key_env else "ollama"
    client = OpenAI(base_url=p.base_url, api_key=api_key or "none", timeout=90, max_retries=1)
    return client, (model or avail[provider_id]["default_model"])


def describe_error(exc):
    """A short, user-facing message for an exception raised by the OpenAI client."""
    import openai

    if isinstance(exc, openai.RateLimitError):
        headers = exc.response.headers if exc.response is not None else {}
        if headers.get("x-ratelimit-limit-req-minute") == "0":   # Mistral: model not in this key's plan
            return ("Your API key's plan doesn't include this model (its limit is 0 requests per minute). "
                    "Pick another model from the list.")
        wait = headers.get("retry-after")
        return ("The provider's free-tier rate limit was hit" +
                (f"; retry in about {wait} s." if wait else "; wait a minute and retry.") +
                " Or switch to another provider.")
    if isinstance(exc, openai.AuthenticationError):
        return "The provider rejected the API key. Check it in backend/.env."
    if isinstance(exc, openai.NotFoundError):
        return "The provider doesn't know that model name. Pick another model."
    if isinstance(exc, openai.APITimeoutError):   # a subclass of APIConnectionError: check it first
        return "The provider took too long to answer. Try again or switch provider."
    if isinstance(exc, openai.APIConnectionError):
        return "Couldn't reach the provider (for Ollama: is `ollama serve` running?)."
    if isinstance(exc, openai.BadRequestError):
        return f"The provider refused the request (does this model support tool calling?): {_detail(exc)}"
    if isinstance(exc, openai.APIStatusError):
        return f"The provider returned an error ({exc.status_code}): {_detail(exc)}"
    return f"Unexpected error from the language model: {exc}"


def _detail(exc):
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        err = body.get("error", body)
        msg = err.get("message") if isinstance(err, dict) else err
        if msg:
            return str(msg)[:300]
    return str(exc)[:300]
